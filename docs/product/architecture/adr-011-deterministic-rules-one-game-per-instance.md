# ADR-011: Deterministic game rules, one game per instance, shared by the browser and the function

**Status**: Proposed (rightmove-invaders-replay-verified-scores, DESIGN, 2026-10-26; revised after the first review cycle), awaiting the user's approval · **Feature**: rightmove-invaders-replay-verified-scores · **Amends**: ADR-006 (its Context, layering rule 5 and the ceiling)

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
- **Gameplay chance from the game's seed**: the new pure module `game/chance.js` (sfc32 over a 128-bit seed of 32 hex characters, imports nothing) makes every gameplay draw.
  - **The seed's lifecycle**: `createGame` draws nothing. `startGame` calls `newSeed()` once, creates the chance from that seed, emits `gameStarted { seed }`, and only then sets up the first wave, whose Dream Home timer is the game's first draw. A chance is never shared between games, so game 2 doesn't depend on how many draws game 1 made.
  - `main.js` draws the seed from `Math.random`, which the browser test drivers already make reproducible; the replay passes the session's seed.
  - Erosion compares squared distances, which decides every cell as `Math.hypot` did for the radii in use (2.2 and 2.8, both at least 1.2); a unit test checks all 49 cells for both.
- **Cosmetics apart**: the particles move to `game/particles.js`, the one module in `game/` allowed `Math.random`, `Math.cos` and `Math.sin`. Particles never touch the gameplay, and a game created with `particles: false` makes none.
- **The record**: the new pure module `game/record.js` (imports nothing) holds `RULES_VERSION`, `MAX_GAME_STEPS` (60 minutes), the control bits (left, right, fire), the compact `keys` encoding, `createRecorder()` and `readRecord()`, which bounds everything the replay will meet.
  - Step *k* (from 0) is the *k*-th `update` call after `startGame`. In every recorded call, whatever the state, `update` reads the controls once, through `heldControls`, which `movePlayer` uses too. The call that ends the game is the last one recorded.
  - `gameStarted` carries the seed, and `initialsEntered` carries the record. The record never carries the seed: the session does.
- **The replay**: the new module `game/replay.js` creates a game with the session's seed and no particles, presses Enter, steps through the record, and returns `{ over, steps, deposit }`. It never throws on a record `readRecord` accepted (a unit property).
- **Layering**, amending ADR-006 and enforced by `tests/unit/layering.spec.js`:
  - Rule 5 becomes: `netlify/**` imports from `src/` only `src/game/high-scores.js`, `src/game/record.js` and `src/game/replay.js`.
  - Rule 7 (new): `game/chance.js` and `game/record.js` import nothing.
  - Rule 8 (new), **the determinism scan**, an allowlist over `src/game/` (except `particles.js`) and `src/theme/`: every `Math` must be followed by `.` and one of `floor`, `ceil`, `round`, `trunc`, `abs`, `min`, `max`, `sign` or `imul`, so a bare `Math` (destructuring, an alias, `Math['random']`, `globalThis.Math`) fails; and `**`, `Date`, `performance` and `crypto` don't appear. Like the import scan, it reads text, so it can over-report but never miss.
- **A gameplay change is deliberate**: a corpus of games recorded in Chromium, Firefox and WebKit (`tests/fixtures/recorded-games/`, recorded on demand by a browser spec that keeps the body of the signing it intercepts) replays in the `unit` project, and so in the build gate. The build fails when a recorded game replays to another deposit or step, until `RULES_VERSION` is raised and the corpus re-recorded. The function refuses a record of another version (`rules-changed`, ADR-010).
- **The ceiling** (`MAX_PLAUSIBLE_SCORE` in `high-scores.js`) becomes £500,000 in the change that makes the function replay (ADR-010).

## Alternatives considered
- **Keep the singleton, and add a `reset()` for the replay**: smaller, but every new piece of module state would have to remember to reset, and the console's `import()` would still reach the live game.
- **Extract a simulation core** (`createSimulation`, without the table, the entry or the settings) for the function alone: a smaller server surface, but `g` would split into two objects that the views both read, and the diff would be larger. Revisit if the function's import ever grows uncomfortable.
- **Patch `Math.random` globally during a replay** (the tests' trick): not safe when requests interleave, it leaks into the particles, and the browser game would stay unseeded.
- **Fixed-point or integer physics**: unnecessary, because IEEE doubles with the four operations agree across engines (probe).
- **A PRNG library**: a dependency for about ten lines.
- **Keep the module state and import the module afresh for each check** (`?copy=n`, the unit tests' trick): Netlify's bundler inlines one copy, and it leaks a module per request.
- **A blocklist of `Math` functions for the scan**: it would miss the functions it forgot to list and every aliased form; the allowlist can't.

## Consequences
- **One rules module serves the browser and the function**, with no duplicated rules. The function's bundle grows from one file of `src/` (3.5 KB) to the rules, the shields, the theme data and the config: about 35 KB of source.
- **Every gameplay change needs a `RULES_VERSION` bump** and a re-recorded corpus, and the build gate catches a change that a recorded game reaches. **A change no recorded game reaches is not caught**, for example a rare Dream Home path: its author adds a recorded game that reaches it. The bump refuses signings from pages loaded before the deploy (ADR-010).
- **Tests**:
  - The unit and tier-B harnesses keep their shape: `loadFreshGame()` returns `{ ...module, ...createGame({ newSeed }) }`, with the seed drawn from `Math.random`, so `withDeterministicChance` still fixes each game.
  - The browser drivers keep their seeded `Math.random`, but each game's random sequence changes, so DISTILL re-checks their choreography.
- **Enabling commits**: the change lands as four commits that keep the suite green, before any behaviour changes:
  1. seeded chance and squared distances;
  2. `createGame`;
  3. the recorder and the layering rules;
  4. the recorded-games corpus.
- **ADR-006's Context sentence** ("`game.js` can't be imported server side") no longer holds, and rule 5 widens to three modules.
