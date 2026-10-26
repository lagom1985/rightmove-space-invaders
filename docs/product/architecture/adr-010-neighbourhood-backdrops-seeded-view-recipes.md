# ADR-010: Neighbourhood backdrops: palette data in the theme, seeded recipes in the view, built once per rung change, with a fail-safe

**Status**: Accepted (DESIGN, 2026-10-26; approved by the user) · **Feature**: rightmove-invaders-level-backdrops · Built on the walking skeleton (`83a83fb`), which shipped the palettes, the recipes, a lazy cache of two and the crossfade. This ADR fixes their shape, and adds the plan, the painting on a given context and the fail-safe.

## Context
Every wave used to have the same backdrop. The user chose, in SPIKE ([findings](../../feature/rightmove-invaders-level-backdrops/spike/findings.md)), to give each rung of the property ladder its own place:
- a neighbourhood map, drawn faintly like a property search map;
- a time-of-day palette;
- a skyline of that rung's homes.

The next rung's place fades in during the 2.4 s "Wave cleared!" banner, and from Forever home onwards the backdrop stays on Forever home.

The forces:
- **Layering**: `theme/` is data and imports nothing. `game/` must not learn about backdrops. The views read `g`.
- **Cost**: a backdrop takes 1–2 ms to build at 2× in most cases. Country pile takes **7 ms in Firefox**, close to a 120 Hz frame (spike).
- **The seeded tests**: they replace `Math.random` with a seeded generator and play the same game in every engine. Any drawing that used `Math.random` would change that game.
- **No test reads the canvas** (waiver D10).
- **The canvas can fail**: an offscreen canvas at device resolution can fail to allocate (canvas memory limits, a lost GPU). A throw inside `draw()` skips `main.js`'s `requestAnimationFrame(frame)` and freezes the game.

## Decision
- **The theme holds what each rung is**: `NEIGHBOURHOODS` in `src/theme/theme.js`, in the ladder's order, each with its `name`, its `look` and a palette of nine colours. `neighbourhood(level)` clamps at the last entry, as `ladderName` does. A unit check keeps `LADDER` and `NEIGHBOURHOODS` the same length.
- **The view holds how each rung is drawn**: `src/view/backdrop.js` has one map recipe and one skyline recipe per `look`.
  - **Palette only**: a recipe draws only with its palette's colours, plus `COLORS.green` for the ground line. So the legibility rule on palette data (ADR-011) covers every pixel.
  - **Painted on a given context**: the recipes paint on a 2D context they are handed. Building a backdrop only creates the canvas, at `k` device pixels to a unit, and hands over its context.
  - **Seeded**: each rung draws with its own mulberry32 generator, seeded by its index. A backdrop never calls `Math.random`.
  - **Imports**: `backdrop.js` imports only from `src/theme/` and `src/game/config.js`. This is the seventh layering rule, added to the import scan by DISTILL or DELIVER. A backdrop can never read `g`.
- **The crossfade is a pure plan**: `backdropPlan({ level, state, banner })` returns `{ here, next, mix }`.
  - `next` is set only while the wave is cleared below Forever home, with mix = 1 − banner / BANNER_TIME, clamped to [0, 1].
  - `render.js`'s `drawBackdrop` only applies the plan. The rules hold no view state, and `game/` doesn't change.
- **Built once per rung change**: a backdrop is built lazily, the first time it is drawn. A cache of at most two keeps the current rung and the next, the least recently drawn going first, and a resize drops them.
  - Builds happen only on the title's first frame, on the first "Wave cleared!" frame (the pin can't move, the bolts have just been cleared, and the fade starts at 0), on the first frame of a new game started from a higher rung, and after a resize.
  - Never per frame.
- **Fail-safe**: a build that fails (a null context, or a throw) marks that rung as failed. The screen is filled with its palette's `bg`, the build isn't retried until the next rescale, and nothing reaches the loop. The first build, on the title, is the probe. A failure degrades the backdrop, and the game always starts.

## Alternatives considered
- **Shape data in the theme**, like the hurdles' pixel art: the city map alone is about 860 seeded rectangles. With no build step, that means hand-written coordinate tables plus an interpreter in the view, and the seeded variety is lost.
- **Recipe functions in the theme**: the import scan would allow it, because they import nothing. But the theme would then hold drawing code, against "theme is data".
- **Image files**: one file per device scale, no seeded detail, and an asset pipeline this project doesn't have.
- **Building ahead at wave start**: it moves the cost into a frame where the player is playing.
- **`requestIdleCallback`**: a synchronous 7 ms build still blocks inside it, Playwright's fake clock fakes it, and Safari support would need checking.
- **An `OffscreenCanvas` in a Worker**: a new module type, for one build per wave.
- **A fade state in `g`**: view state in the rules.
- **No fail-safe, or a try/catch around `draw()` in `main.js`**: the first freezes the game over decoration, and the second would hide every rendering bug.

## Consequences
- **Positive**:
  - `game/` is untouched, and the theme stays data.
  - Every backdrop is identical on every build and in every engine, and the seeded game is left alone.
  - The fade, the recipes' calls and colours, and the cache, fail-safe included, can all be unit-checked without a browser, on a recording context.
  - Nothing new runs every frame except one extra `drawImage` during the 2.4 s fade (2.8 ms headless at 2×, spike).
- **Negative**:
  - A resize during the fade rebuilds both backdrops, about 9 ms in Firefox at 2×, on each frame while the window is dragged. Accepted.
  - Two device-resolution canvases are held at once (about 25 MB each on a 4K screen at 3×).
  - A rung whose build failed shows a flat background, silently, until the next resize.
  - Whether a skyline reads, Terrace's busy streets with bolts in motion, and the fade's cost on real hardware are checked by hand (D10), not by tests.
