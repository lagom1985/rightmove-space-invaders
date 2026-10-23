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
- Driving adapter: the browser page, played with real keyboard events (Playwright `page.keyboard`).
- Driven adapters: Canvas2D (screen), a DOM status mirror (screen readers; it is also what the test reads), and `localStorage` (best score). Nothing is mocked.
- Slice: title → Enter → Space hits the Damp hurdle (£50) → the player stands still until the hurdles win → game over → reload → the title shows a best deposit of £50.
- Acceptance test: [walking-skeleton.feature](../../../../tests/e2e/rightmove-invaders/acceptance/walking-skeleton.feature). One `@walking_skeleton @driving_port` scenario, run in Chromium, Firefox and WebKit. It took about 30 s for 15 runs (5 per engine) with no failures. It fails if saving the best score breaks, and it fails if quick key taps get dropped again.
- Commit: `feat(rightmove-invaders): walking skeleton — playable wave with remembered best deposit`
- Demo command: `npm start`, then open http://localhost:4173. Run the test with `npm test`.
- Code: `src/` ES modules, no runtime dependencies: `main` (loop), `game` (rules and state), `render`, `input`, `shields`, `status`, `storage`, `theme`, `config`.

## Design Implications
- No engine. Vanilla Canvas2D + ES modules, served as static files.
- Core loop = fixed 120 Hz simulation steps + rAF rendering + `dt` clamp + latched key presses. This also lets tests step the game deterministically.
- Shields = byte grids cached to offscreen canvases and repainted only on damage. Bullets sweep cells to avoid tunnelling.
- Theme (names, colours, values, pixel art) is plain data, separate from game logic. Swap in official brand values from the Rightmove brand kit.
- The test doesn't need a test-only hook in the game. Playwright's fake clock fast-forwards `requestAnimationFrame` and timers, and the scenario is built so randomness can't change the outcome. More scenarios that depend on random enemy fire will need a seeded RNG.
- Canvas pixels can't be asserted on, so the HUD and big moments are mirrored into a visually hidden DOM status region. That serves screen-reader users and is what tests read. Keep it in step with any new on-canvas text.

## Constraints Discovered
- Taps shorter than one frame must be latched or they are lost.
- `preventDefault` on Space/arrows (page scroll), but never on Cmd/Ctrl combos.
- Clear held keys and pause on `blur`; clamp `dt` after hidden tabs.
- `localStorage` access must be guarded.
- Use the Rightmove name only with brand-team sign-off if this goes beyond internal use; all artwork is original.
- ES modules don't load from `file://`, so the game has to be served (`scripts/serve.mjs`, no dependencies).
- Still open: sound (unlock audio on Enter), reduced-motion and colour-blind-safe palette, remappable keys, a check on real 120 Hz and low-end hardware.
