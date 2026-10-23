# SPIKE Decisions: rightmove-invaders

No DISCUSS artifacts existed. The brief came straight from the user: a Space Invaders-style browser game, keyboard only, desktop web only, themed around Rightmove. Decisions below were made with the user on 2026-10-23.

## Concept
- **"Make the Right Move": Home Defenders.** The player is a house-hunter's map pin defending against home-buying hurdles: Gazumper (£300), Stamp Duty (£200), Rate Rise (£150), Broken Chain (£100) and Damp (£50).
- Shields are pairs of terraced houses that crumble. The bonus ship is a "Dream Home" you save for £500–£3,000.
- Score is "deposit saved". Levels climb the property ladder: Studio flat → Terrace → Semi-detached → Detached → Country pile → Forever home.
- Controls: ←/→ or A/D move, Space fire, P/Esc pause, Enter start. Touch-only or narrow screens get a "needs a keyboard" screen.

## Assumption Tested
- Can a zero-dependency Canvas2D loop hold 60fps with 55 invaders, bullets, particles and pixel-eroding house shields, with responsive keyboard move + fire? Budget: p95 frame < 16.7 ms, frame-rate independent movement.

## Probe Verdict
- **WORKS**: worst p95 work per frame was 4 ms (Firefox, stress run). Chromium with its CPU slowed 4× managed 1.7 ms. Input reaches the screen on the next frame in Chromium, Firefox and WebKit. See [findings.md](findings.md).

## Promotion Decision
- **PROMOTE** (user, 2026-10-23). The mechanism is proven, and the probe already plays like the intended game, so it is worth building on rather than rewriting.
- The code will move out of the temporary session folder into a folder the user picks, then be refactored into the walking skeleton there.

## Walking Skeleton
- Driving adapter: the browser page, played with keyboard events (Playwright `page.keyboard`).
- Slice: title → Enter → move/fire → hit scored → game over → best score saved to `localStorage` and shown on the title screen.
- Acceptance test: `tests/acceptance/rightmove-invaders/walking-skeleton.feature` (one `@walking_skeleton @driving_port` scenario).
- Commit: _pending_
- Demo command: _pending_

## Design Implications
- No engine. Vanilla Canvas2D + ES modules, served as static files.
- Core loop = fixed 120 Hz simulation steps + rAF rendering + `dt` clamp + latched key presses. This also lets tests step the game deterministically.
- Shields = byte grids cached to offscreen canvases and repainted only on damage. Bullets sweep cells to avoid tunnelling.
- Theme (names, colours, values, pixel art) is plain data, separate from game logic. Swap in official brand values from the Rightmove brand kit.
- The game needs a test seam that skips randomness and timing (seeded RNG, injectable clock) so the acceptance test is not flaky.

## Constraints Discovered
- Taps shorter than one frame must be latched or they are lost.
- `preventDefault` on Space/arrows (page scroll), but never on Cmd/Ctrl combos.
- Clear held keys and pause on `blur`; clamp `dt` after hidden tabs.
- `localStorage` access must be guarded.
- Use the Rightmove name only with brand-team sign-off if this goes beyond internal use; all artwork is original.
- Still open: sound (unlock audio on Enter), reduced-motion and colour-blind-safe palette, remappable keys, a check on real 120 Hz and low-end hardware.
