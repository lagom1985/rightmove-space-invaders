# ADR-011: Deterministic game rules, one game per instance, shared by the browser and the function

**Status**: Proposed (rightmove-invaders-replay-verified-scores, DESIGN, 2026-10-26), awaiting the user's approval · **Feature**: rightmove-invaders-replay-verified-scores · **Amends**: ADR-006 (its Context, and layering rule 5)

## Context
ADR-010 has the function replay each signed game. That needs three things the rules don't have:
- **The same game everywhere.** Every gameplay random draw is `Math.random` (enemy fire, the Dream Home, shield erosion), and erosion calls `Math.hypot`, which ECMAScript leaves implementation-approximated.
- **A fresh game per check.** The rules are one module-level state, `g`, with an outbox, a notice counter, the signings on their way and a best-score store beside it. ADR-006 says why the function couldn't import them: "it holds the module-level game state `g`". The same singleton is what the console's `import()` reached in the RCA's Vector B.
- **A record of what the player did**, by simulation step.

A probe (2026-10-26) showed that a copy of the rules, seeded and without `Math.hypot`, replays identically in Node, Chromium, Firefox and WebKit, and plays the same games as before.

## Decision
- **One game per instance**: `game.js` exports `createGame({ newSeed, particles = true })`, which returns the game: `{ g, update, handlePresses, pause, takeEvents, applySettings, applyBestStore, tableAnswered, tableFailed, signingAnswered, signingFailed, snapshot, canPlayAgain, invaderX, invaderY }`.
  - Everything that is module-level state today moves into the closure. The chance and the recorder live there too, outside `g`, so `g` stays plain data.
  - The pure functions and constants stay module exports.
  - `main.js` creates the one browser game and exports nothing, so the console's `import()` finds no live game. This is defence in depth: ADR-010's replay is the guarantee.
  - `render.js` receives the game instead of importing `g`.
- **Gameplay chance from the game's seed**: the new pure module `game/chance.js` (sfc32 over a 128-bit seed of 32 hex characters, imports nothing) makes every gameplay draw. At each start the game takes a seed from `newSeed()`: `main.js` draws it from `Math.random`, which the browser test drivers already make reproducible, and the replay passes the session's seed. Erosion compares squared distances.
- **Cosmetics apart**: the particles move to `game/particles.js`, the one module in `game/` allowed `Math.random`, `Math.cos` and `Math.sin`. Particles never touch the gameplay, and a game created with `particles: false` makes none.
- **The record**: the new pure module `game/record.js` (imports nothing) holds `RULES_VERSION`, `MAX_GAME_STEPS` (60 minutes), the control bits (left, right, fire), the compact `keys` encoding, `createRecorder()` and `readRecord()`.
  - From `startGame` to the step that ends the game, `update` records the controls as `movePlayer` reads them, through one function, `heldControls`.
  - `gameStarted` carries the seed, and `initialsEntered` carries the record.
- **The replay**: the new module `game/replay.js` creates a game with the session's seed and no particles, presses Enter, steps through the record, and returns `{ over, steps, deposit }`.
- **Layering**, amending ADR-006 and enforced by `tests/unit/layering.spec.js`:
  - Rule 5 becomes: `netlify/**` imports from `src/` only `src/game/high-scores.js`, `src/game/record.js` and `src/game/replay.js`.
  - Rule 7 (new): `game/chance.js` and `game/record.js` import nothing.
  - Rule 8 (new), **the determinism scan**: no file in `src/game/` except `particles.js` mentions `Math.random`, `Math.hypot`, `Math.sin`, `Math.cos`, `Math.tan`, `Math.atan2`, `Math.exp`, `Math.log`, `Math.pow`, `**`, `Date` or `performance`. Like the import scan, it reads text, so it can over-report but never miss.
- **A gameplay change is deliberate**: a corpus of games recorded in Chromium, Firefox and WebKit replays in the `unit` project, and so in the build gate. It fails on any change to the gameplay until `RULES_VERSION` is raised and the corpus re-recorded. The function refuses a record of another version (`rules-changed`, ADR-010).

## Alternatives considered
- **Keep the singleton, and add a `reset()` for the replay**: smaller, but every new piece of module state would have to remember to reset, and the console's `import()` would still reach the live game.
- **Extract a simulation core** (`createSimulation`, without the table, the entry or the settings) for the function alone: a smaller server surface, but `g` would split into two objects that the views both read, and the diff would be larger. Revisit if the function's import ever grows uncomfortable.
- **Patch `Math.random` globally during a replay** (the tests' trick): not safe when requests interleave, it leaks into the particles, and the browser game would stay unseeded.
- **Fixed-point or integer physics**: unnecessary, because IEEE doubles with the four operations agree across engines (probe).
- **A PRNG library**: a dependency for about ten lines.
- **Keep the module state and import the module afresh for each check** (`?copy=n`, the unit tests' trick): Netlify's bundler inlines one copy, and it leaks a module per request.

## Consequences
- **One rules module serves the browser and the function**, with no duplicated rules. The function's bundle grows from one file of `src/` (3.5 KB) to the rules, the shields, the theme data and the config: about 35 KB of source.
- **Every gameplay change needs a `RULES_VERSION` bump** and a re-recorded corpus. The build gate enforces it, and the bump refuses signings from pages loaded before the deploy (ADR-010).
- **Tests**:
  - The unit and tier-B harnesses keep their shape: `loadFreshGame()` returns `{ ...module, ...createGame({ newSeed }) }`, with the seed drawn from `Math.random`, so `withDeterministicChance` still fixes each game.
  - The browser drivers keep their seeded `Math.random`, but each game's random sequence changes, so DISTILL re-checks their choreography.
- **Precursor commits**: the change lands as three commits that keep the suite green, before any behaviour changes:
  1. seeded chance and squared distances;
  2. `createGame`;
  3. the recorder.
- **ADR-006's Context sentence** ("`game.js` can't be imported server side") no longer holds, and rule 5 widens to three modules.
