# ADR-010: Neighbourhood backdrops: palette data in the theme, seeded recipes in the view, a store of two built only when needed, with a fail-safe

**Status**: Accepted (DESIGN, 2026-10-26; approved by the user) · Revised 2026-10-26 after the Final Wave Review Gate, by the user's decisions:
- `BANNER_TIME` moves to `src/game/config.js` and is re-exported by `game.js`;
- the drawing shell moves into `backdrop.js` as `showBackdrop`, with a composition table;
- the store's `get` is renamed `canvasFor`;
- `rescale` returns at once on an unchanged scale;
- `backdrop.js` references no DOM global;
- the build triggers are stated exactly, and the resize wiring is checked by hand only.

**Implemented** in DELIVER, 2026-10-26, on branch `rightmove-invaders-level-backdrops` (`23c1a2b` → `060dc37`), not yet merged to `main`. As built: `BANNER_TIME` in `src/game/config.js` (`e943084`); in `src/view/backdrop.js`, `backdropPlan` (`fe1279e`, `d445204`), `paintBackdrop(context, place)` (`46882b0`), the store `createBackdropCache` with its scale rule and fail-safe (`366b1b4`, `7f3ccba`, `6cfa346`, `ef4878b`) and the shell `showBackdrop` (`366b1b4`), which `render.js` only calls. Two additions from the review (`060dc37`): the store holds at most `MAX_HELD` (2), and releases a canvas it drops by sizing it 0 by 0. Forever home's cottage moved clear of the houses (DDD-B11). No decision changed in DELIVER. The pixels, the resize wiring and the cost on real hardware are checked by hand (the feature delta's DoD 9).

**Feature**: rightmove-invaders-level-backdrops · Built on the walking skeleton (`83a83fb`), which shipped the palettes, the recipes, a lazy cache of two and the crossfade. This ADR fixes their shape, and adds the plan, the painting on a given context, the shell and the fail-safe.

## Context
Every wave used to have the same backdrop. The user chose, in SPIKE ([findings](../../feature/rightmove-invaders-level-backdrops/spike/findings.md)), to give each rung of the property ladder its own place:
- a neighbourhood map, drawn faintly like a property search map;
- a time-of-day palette;
- a skyline of that rung's homes.

The next rung's place fades in during the 2.4 s "Wave cleared!" banner, and from Forever home onwards the backdrop stays on Forever home.

The forces:
- **Layering**: `theme/` is data and imports nothing. `game/` must not learn about backdrops. The views read `g`. `BANNER_TIME`, which the fade needs, was declared in `game.js`.
- **Cost**: a backdrop takes 1–2 ms to build at 2× in most cases. Country pile takes **7 ms in Firefox**, close to a 120 Hz frame (spike).
- **The seeded tests**: they replace `Math.random` with a seeded generator and play the same game in every engine. Any drawing that used `Math.random` would change that game.
- **No test reads the canvas** (waiver D10).
- **The canvas can fail**: an offscreen canvas at device resolution can fail to allocate (canvas memory limits, a lost GPU). A throw inside `draw()` skips `main.js`'s `requestAnimationFrame(frame)` and freezes the game.
- **No telemetry**: the game has no client telemetry, so a failure in the field is visible only to the eye.

## Decision
- **The theme holds what each rung is**: `NEIGHBOURHOODS` in `src/theme/theme.js`, in the ladder's order, each with its `name`, its `look` and a palette of nine colours. `neighbourhood(level)` clamps at the last entry, as `ladderName` does. A check keeps `LADDER` and `NEIGHBOURHOODS` the same length.
- **The view holds how each rung is drawn**: `src/view/backdrop.js` has one map recipe and one skyline recipe per `look`.
  - **Palette only**: a recipe draws only with its palette's colours, plus `COLORS.green` for the ground line. So the legibility rule on palette data (ADR-011) covers every pixel but the 2 px green ground line, the game's ground on every backdrop, as before this feature.
  - **Painted on a given context**: `paintBackdrop(context, neighbourhood)` paints in game units, with no transform.
  - **Seeded**: each rung draws with its own mulberry32 generator, seeded by its index. A backdrop never calls `Math.random`. The game's two other private generators, the white noise in `sound/voices.js` and the test init script's, stay separate: sharing five lines across `view/` and `sound/` would need a module both import.
  - **Imports**: `backdrop.js` imports only from `src/theme/` and `src/game/config.js`. This is the seventh layering rule, enforced by the import scan, so a backdrop can never read `g`.
  - **No DOM global**: `backdrop.js` references none. Its canvases come only from the factory `render.js` injects, and DELIVER checks this with a grep.
- **`BANNER_TIME` moves to `src/game/config.js`**, next to `STEP` and `MAX_FRAME`. `game.js` imports it and re-exports it, so every existing import keeps working. This is the only change to `src/game/`.
- **The crossfade is a pure plan**: `backdropPlan({ level, state, banner })` returns `{ here, next, mix }`. `next` is set only while the wave is cleared below Forever home, with mix = 1 − banner / BANNER_TIME, clamped to [0, 1]. The rules hold no view state.
- **The shell lives in `backdrop.js` too**: `showBackdrop(context, plan, canvasFor)`, handed the store's `canvasFor` alone, so it can't rescale the store.
  - It asks `canvasFor` for `here`, and for `next` whenever the plan names one, even at a mix of 0.
  - It draws `here` at full strength and `next` at `globalAlpha = mix`, then restores `globalAlpha` to the value it found.
  - A rung whose canvas is null is filled with its palette's `bg`, at the same alpha, so `drawImage` never gets null. The feature delta's composition table lists all six cases: `here` ok or failed, × `next` none, ok or failed.
  - Drawing a canvas that was built is assumed not to throw.
  - `render.js` only calls it, with the frame read from `g`.
- **The store**: `createBackdropCache(createCanvas)` → `{ rescale(k), canvasFor(neighbourhood) }`. A backdrop it holds is never rebuilt at its scale; a rung dropped from the two is built again when next needed. `canvasFor` is build-on-first-ask: asking builds a missing backdrop, moves it to most recent, and marks a failed build.
  - A backdrop is built lazily, the first time it is asked for, and the store keeps at most two built canvases, the least recently asked-for going first.
  - `rescale` to a new scale drops them, along with every failed mark. To the same scale, it returns at once.
  - Builds happen on four triggers only: the title's first frame; the first "Wave cleared!" frame (the pin can't move, the bolts have just been cleared, and the fade starts at 0); the first frame of a new game started from a higher rung (Studio flat, ≤ 2 ms); and the first frame after a change of scale, which can fall in play.
- **Fail-safe**: a build that fails (a null context, or a throw) marks that rung as failed, and `canvasFor` returns null for it.
  - The shell then fills the palette's `bg`. The rung isn't retried until the next change of scale, and nothing is thrown or logged.
  - Failed marks don't count towards the two and are never evicted.
  - The first build, on the title, is the probe. A failure degrades the backdrop, and the game always starts.

## Alternatives considered
- **One shared map, recoloured per rung**: the cheapest. But the concept the user chose in SPIKE is a distinct place per rung, with its own streets and skyline.
- **Shape data in the theme**, like the hurdles' pixel art: the city map alone is about 860 seeded rectangles. With no build step, that means hand-written coordinate tables plus an interpreter in the view, and the seeded variety is lost.
- **Recipe functions in the theme**: the import scan would allow it, because they import nothing. But the theme would then hold drawing code, against "theme is data".
- **Image files**: one file per device scale, no seeded detail, and an asset pipeline this project doesn't have.
- **Building ahead at wave start**: it moves the cost into a frame where the player is playing.
- **`requestIdleCallback`**: a synchronous 7 ms build still blocks inside it, Playwright's fake clock fakes it, and Safari support would need checking.
- **An `OffscreenCanvas` in a Worker**: a new module type, for one build per wave.
- **Debouncing a resize**: more state and a timer in the view, for a rare edge whose cost is one hitch per change of scale.
- **A fade state in `g`**: view state in the rules.
- **The shell staying in `render.js`**: its six cases could only be checked by eye.
- **`BANNER_TIME` kept in `game.js`**: importing it from there breaks the seventh rule. A copy of 2.4 in `backdrop.js` makes two sources of truth. Passing it into the plan changes the plan's argument.
- **No fail-safe, or a try/catch around `draw()` in `main.js`**: the first freezes the game over decoration, and the second would hide every rendering bug.

## Consequences
- **Positive**:
  - `game/` changes by one constant moved, with no change in behaviour, and the theme stays data.
  - Every backdrop is identical on every build and in every engine, and the seeded game is left alone.
  - The fade, the shell's composition, the recipes' calls and colours, and the store, fail-safe included, can all be checked in memory without a browser, on a recording context and a canvas factory stand-in.
  - Nothing new runs every frame except one extra `drawImage` during the 2.4 s fade (2.8 ms headless at 2×, spike).
- **Negative**:
  - A resize during play rebuilds `here` on each change of scale while the window is dragged, up to 7 ms in Firefox at 2×. During the fade it rebuilds both, about 9 ms. Accepted.
  - The wiring from window `resize` to `renderer.resize()` to `rescale` has no automated check. It is checked by hand, as a recorded gap.
  - Two device-resolution canvases are held at once (about 25 MB each on a 4K screen at 3×).
  - A rung whose build failed shows a flat background, silently, until the next change of scale. With no telemetry, only tests and the eye can see it.
  - Whether a skyline reads, Terrace's busy streets with bolts in motion, the fade's cost on real hardware, and everything the canvas must not change are checked by hand (D10), not by tests.
