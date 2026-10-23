# SPIKE Findings: rightmove-invaders

**Date**: 2026-10-23
**Probe question**: Can a zero-dependency Canvas2D game loop hold 60fps with 55 invaders, bullets, particles and pixel-eroding house shields, with responsive keyboard move + fire?
**Budget**: p95 frame < 16.7 ms (60fps on a mid-range laptop), movement frame-rate independent.
**Probe code**: single `index.html` (~480 lines, no dependencies) in the session scratchpad, `spike_rightmove_invaders/`.

## Verdict

**WORKS.** Every engine stayed far inside the 16.7 ms budget, including Chromium with its CPU slowed 4×. The worst p95 was 4 ms of work per frame (Firefox, stress run). There were no page errors in any engine.

## Results

Measured on an Apple M4 Pro with Playwright 1.62 (headless Chromium, Firefox and WebKit). Each run was 20 s of autoplay after a 2 s warm-up. "Work" is CPU time per frame (input + simulation + draw calls). "Interval" is the time between `requestAnimationFrame` callbacks. Headless Chromium and Firefox ran at 120 Hz and WebKit at 60 Hz. Firefox and WebKit round timers to 1 ms, so their work figures are coarse.

| Engine | Run | Frames | Interval p50 / p95 / max (ms) | Work p50 / p95 / max (ms) | Frames > 20 ms | Load at end |
|---|---|---|---|---|---|---|
| Chromium | normal play | 2,401 | 8.3 / 8.7 / 9.4 | 0.1 / 0.2 / 0.8 | 0 | 19 particles, 2 bullets |
| Chromium | stress | 2,388 | 8.4 / 8.9 / 19.1 | 0.6 / 0.8 / 1.3 | 0 | 2,976 particles, 38 bullets |
| Chromium | stress, CPU 4× slower | 2,400 | 8.3 / 9.2 / 9.4 | 1.2 / 1.7 / 2.4 | 0 | 3,176 particles, 37 bullets |
| Firefox | normal play | 2,402 | 8.3 / 8.9 / 22.4 | 1 / 3 / 6 | 1 | 26 particles, 1 bullet |
| Firefox | stress | 2,402 | 8.3 / 8.8 / 13.5 | 2 / 4 / 7 | 0 | 3,075 particles, 39 bullets |
| WebKit (Safari) | normal play | 1,200 | 17 / 17 / 25 | 1 / 1 / 3 | 1 | 5 particles, 3 bullets |
| WebKit (Safari) | stress | 1,200 | 17 / 17 / 18 | 2 / 3 / 4 | 0 | 2,781 particles, 40 bullets |

**Keyboard**, sent as real key events through each browser's input pipeline:

| Engine | Instant tap moves player | Instant Space tap fires | Key event → frame drawn p50 / p95 (ms) |
|---|---|---|---|
| Chromium | yes (5.5 px) | yes | 6.5 / 8.5 |
| Firefox | yes (5.5 px) | yes | 7 / 16 |
| WebKit | yes (2.8 px) | yes | 8 / 15 |

Input always reaches the screen on the next frame. Holding move and fire together works in all three engines. In the in-app browser (Chromium, about 100 Hz), real key presses measured 2.3 ms p50 and 7.7 ms p95.

**Shield erosion works as intended.** After 20 s of stress, cells left per shield were around 322 / 37 / 5 / 107 out of 322. The houses crumble progressively and believably, see [stress-chromium.png](stress-chromium.png). The raw numbers are in [probe-results.json](probe-results.json).

**Headroom**: Even the stress scene (≈3,000 particles, 40 bullets) uses about 10% of a 60 Hz frame on a 4×-slowed CPU, so lower-end office laptops should be comfortable. Not yet checked on real low-end hardware or a physical 120 Hz display.

## What the probe contains

- Fixed-timestep simulation (120 Hz steps, accumulator, `dt` clamped to 250 ms) decoupled from `requestAnimationFrame` rendering, so movement speed is identical on 60/100/120 Hz displays.
- 5 × 11 formation of five "hurdle" types (Gazumper, Stamp Duty, Rate Rise, Broken Chain, Damp), two-frame pixel-art animation, march speed rising as the formation thins.
- Four destructible shields drawn as pairs of terraced houses with lit windows, a door and a ginnel. Each is a 24 × 18 `Uint8Array` (one byte per 3 × 3 px cell), cached to an offscreen canvas and repainted only when damaged. Bullets sweep the cells along their path, so fast shots can't tunnel through.
- "Dream Home" bonus ship, player map-pin with a house cut-out, enemy zig-zag bolts, particles, floating score text.
- HUD: deposit saved (£ score), property ladder (level), best (localStorage).
- Desktop gate: `(hover: none) and (pointer: coarse)` or width < 640 px shows a "needs a keyboard" screen.
- Measurement hooks: `?bot` autoplays (invincible), `?stress` adds ~2,000 ambient particles, 12× explosion particles and up to 40 enemy bullets; `window.__probe.report()` returns frame-interval, work-per-frame and input-latency percentiles.

## Edge cases discovered

1. **Sub-frame key taps were dropped.** Reading only "is the key held now" missed a keydown + keyup that both landed between two simulation steps; the player never moved and quick Space taps never fired. Fixed in the probe by latching new presses until one simulation step has seen them (`unseen` / `releaseAfterStep`). The real build needs the same.
2. **Space and arrow keys scroll the page** unless `preventDefault()` is called on keydown. Cmd/Ctrl combos must be left alone so browser shortcuts still work.
3. **Stuck keys on focus loss.** If the window loses focus while a key is held, the keyup never arrives. The probe clears held keys on `blur` and auto-pauses.
4. **Hidden tabs stop `requestAnimationFrame`.** On return, the first `dt` can be many seconds; clamping it to 250 ms stops the simulation from jumping ahead (and from a "spiral of death" of catch-up steps).
5. **Long synchronous script evaluation blocks frames** in the in-app browser, so long-running measurements have to run in a separate headless browser rather than in a page script.
6. **`localStorage` can throw** (private mode, blocked storage), so the high score read/write is wrapped and falls back to 0.
7. **Font loading.** The pixel font (Press Start 2P, Google Fonts) loads asynchronously. Because the canvas is redrawn every frame, text simply switches from the fallback font once it arrives. No loading gate is needed, but a self-hosted copy would avoid depending on a third party.

## Design implications

- **No game engine needed.** Vanilla Canvas2D + ES modules covers it. Phaser or similar would add ~1 MB for features this game doesn't use.
- **Keep the fixed-step + latched-input pattern** as the core of the game loop. It is what makes behaviour identical across refresh rates and makes the game testable: a test can step the simulation deterministically.
- **Shields as byte grids + offscreen cache** is cheap. Repaint only on damage.
- **Theme is data.** Hurdle names, colours, values and pixel art are plain arrays, so copy/brand changes don't touch logic. Brand colours used here (`#00deb6` green, `#262637` navy) are approximations to be replaced from the official Rightmove brand kit.
- **Brand/IP**: no Rightmove logo or Taito artwork is used; all sprites are original. Using the Rightmove name outside an internal context needs brand-team sign-off.
- **Not yet covered**: sound (Web Audio needs a user gesture first; Enter on the title screen is a natural unlock point), accessibility (reduced-motion setting, remappable keys, colour-blind-safe hurdle palette), 120 Hz real-hardware check, gamepad.
