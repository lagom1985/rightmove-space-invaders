# ADR-000: Vanilla Canvas2D with a fixed-step loop, no game engine

**Status**: Accepted (recorded retroactively, 2026-10-23) · **Source**: spike `docs/feature/rightmove-invaders/spike/`

## Context
A desktop-only, keyboard-only arcade game. The spike measured a zero-dependency Canvas2D loop at p95 ≤ 4 ms of work per frame under stress in Chromium, Firefox and WebKit, against a 16.7 ms budget.

## Decision
- Render with Canvas2D from plain ES modules served as static files. No engine, no bundler, no runtime dependencies.
- Simulate in fixed 120 Hz steps with an accumulator, clamping a frame's elapsed time to 250 ms. Render once per `requestAnimationFrame`.
- Latch key presses until a simulation step has seen them.

## Alternatives considered
- **Phaser 3**: a large engine (size not measured; roughly 1 MB) with features this game doesn't use; it would hide the loop we want to control.
- **Variable-step simulation**: speed would depend on the display's refresh rate, and it's harder to test deterministically.

## Consequences
- Behaviour is identical at 60, 100 and 120 Hz, and tests can fast-forward with Playwright's fake clock.
- Anything time-based (including sound) should follow simulation steps, not display frames.
