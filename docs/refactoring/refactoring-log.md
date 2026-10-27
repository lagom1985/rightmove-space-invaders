# Refactoring log

## 2026-10-24: organise `src/` by layer

- **Level**: RPP L3 (responsibilities / module organisation).
- **Scope**: project. **Method**: move (`git mv`, so history follows the files).
- **Behaviour**: unchanged. The only edits are file locations, import specifiers and path mentions in docs and comments.
- **Commit**: `refactor: organise src into game, sound, view, platform and theme`.

### Why

`src/` held 12 files in one flat folder. The architecture brief (`docs/product/architecture/brief.md`) describes ports and adapters, with the rules as the core and the canvas, the DOM status mirror, the keyboard, storage and sound as adapters around it. The folder layout did not show that. A reader could not tell the core from the adapters without opening files, and the one rule that matters ("game rules never import browser adapters") could not be checked by looking at paths.

### What moved where

| Before | After | Layer |
|---|---|---|
| `src/main.js` | `src/main.js` (unchanged) | Composition root; `index.html` still loads it |
| `src/config.js` | `src/game/config.js` | Rules and state |
| `src/events.js` | `src/game/events.js` | Rules and state |
| `src/game.js` | `src/game/game.js` | Rules and state |
| `src/shields.js` | `src/game/shields.js` | Rules and state |
| `src/sound.js` | `src/sound/director.js` (renamed) | Sound policy |
| `src/synth.js` | `src/sound/synth.js` | Sound adapter (Web Audio) |
| `src/render.js` | `src/view/render.js` | Canvas adapter |
| `src/status.js` | `src/view/status.js` | DOM status mirror |
| `src/input.js` | `src/platform/input.js` | Keyboard adapter |
| `src/storage.js` | `src/platform/storage.js` | `localStorage` adapter |
| `src/theme.js` | `src/theme/theme.js` | Data (hurdles, colours, art, sound recipes) |
| `src/style.css`, `src/icons/` | unchanged | Static assets; `index.html` paths unchanged |

`sound.js` became `director.js` because `sound/sound.js` would repeat itself and the module is the sound director.

### Paths updated

- **Production**: the import specifiers in `src/main.js`, `src/game/game.js`, `src/view/render.js`, `src/view/status.js`, `src/sound/director.js`, `src/sound/synth.js` and `src/theme/theme.js`, plus three path mentions in code comments (`src/events.js`, `src/sound.js` and `src/synth.js`).
- **Tests (import paths only, 30 lines in 19 files)**: all 13 `tests/unit/*.spec.js` files that import from `src/`, `tests/unit/support/fresh-game.js` and `fake-audio.js`, the acceptance steps `domain-types.js`, `game-driver.js` and `director-harness.js`, and `fixtures/synth-host.html` (`/src/synth.js` to `/src/sound/synth.js`). No assertion, step or scenario was touched.
- **Living docs**: `README.md` ("How it's built"), `CLAUDE.md`, `docs/product/architecture/brief.md` (components table, diagram labels, ports, layout note), `docs/product/outcomes/registry.yaml` (six `artifact:` paths) and `docs/product/journeys/play-a-session.yaml` (two `src/events.js` mentions).
- **Historical records left as they were**: the ADRs, `docs/evolution/`, the wave records under `docs/feature/`. `docs/feature/rightmove-invaders-sound/feature-delta.md` got one note at the top saying the paths below are as they were at the time.
- **Scripts and config**: `index.html`, `scripts/build.mjs`, `scripts/serve.mjs`, `playwright.config.js` and `netlify.toml` needed no change (see below).

### Build and serve with nested folders

- `scripts/build.mjs` copies `src/` with `cp(..., { recursive: true })` and lists the result with `readdir(..., { recursive: true })`, so the nested tree is copied and printed as is.
- `scripts/serve.mjs` resolves any path under the repo root, so `/src/game/game.js` is served like the old flat paths.
- `netlify.toml` header rule `/src/*` matches nested paths (the splat covers sub-folders).
- Verified: `npm run build` passed its 46 unit and in-memory tests and wrote 16 files to `dist/` (`index.html` plus the nested `src/` tree). `dist/` served over HTTP returns 200 for all 16 files, and the game loads from it in Chromium with no page errors or failed requests. The full suite (`npx bddgen && npx playwright test`) passed: 148 tests in Chromium, Firefox and WebKit, run once after the whole batch.

### Dependency-direction check

Rule: `game/` imports nothing from `sound/`, `view/` or `platform/`, apart from the existing accepted exception `game/game.js` to `platform/storage.js` (best score).

Check: `grep -nE "from '\.\./" src/game/*.js` lists every import that leaves `game/`:

```
src/game/game.js:2:import { COLORS, HURDLES, PIN_ART, DREAM_ART, DREAM_BONUSES, pounds } from '../theme/theme.js';
src/game/game.js:4:import { loadBest, saveBest } from '../platform/storage.js';
```

- **`game/` to `sound/` or `view/`**: none.
- **`game/` to `platform/`**: only `game/game.js` to `platform/storage.js`. This is the pre-existing, accepted exception (ADR-001 and the brief); not new, not removed.
- **No browser APIs in `game/`**: a grep for `window`, `document`, `localStorage`, `navigator`, `AudioContext` and `requestAnimationFrame` finds only words in comments and in data.
- **Unresolved imports**: none (every specifier in `src/` resolves to a file).

Two observations for later, neither changed here because this was a move-only refactor:

1. `game/game.js` imports `theme/theme.js` (hurdle values, colours and art are data the rules read). That is allowed by the rule above but makes `game/` depend on `theme/`.
2. `theme/theme.js` imports `game/events.js` (the `Sound` names the recipes are keyed by). Together with 1 this is a folder-level cycle between `game/` and `theme/`. At file level there is no cycle (`game.js` to `theme.js` to `events.js`, which imports nothing). If it needs to go, moving `events.js` out of `game/` into a neutral place, or giving `theme/` its own copy of the sound names, would break it; both are design decisions, not moves.

### Left as they were (flagged)

Five mentions of old paths remain in tests, all in comments or fixture text rather than import paths. The brief for this change was to touch only import paths in tests, so they are stale but harmless:

- `tests/unit/support/fresh-game.js:3` (comment: `src/game.js`)
- `tests/e2e/rightmove-invaders-sound/acceptance/steps/director-harness.js:6` (comment: `src/sound.js`)
- `tests/e2e/rightmove-invaders-sound/acceptance/steps/game-driver.js:81` (comment: `src/synth.js`)
- `tests/e2e/rightmove-invaders-sound/acceptance/steps/domain-types.js:2` (comment: `src/events.js`)
- `tests/e2e/rightmove-invaders-sound/acceptance/fixtures/synth-host.html:8` (page text: `src/synth.js`)

## 2026-10-24: move sound recipes to `sound/`, inject the best-score store, split the synth and the renderer

- **Level**: RPP L1 to L3 (readability, complexity, responsibilities). **Scope**: project `src/`.
- **Method**: planned in cascade order (L3, L2, L1), applied as one batch, suite run once at the end.
- **Behaviour**: unchanged. Gameplay, difficulty and the public surface of every module are as before; `game.js` keeps its module-level state `g` (out of scope).
- **Commit**: `refactor: move sound recipes to sound/, inject best-score store, split synth and renderer`.

### What was done

| # | Item | Result |
|---|---|---|
| 1 | Break the `game/` and `theme/` cycle | Done. The sound data (`hitPitch`, `MARCH_NOTES`, `partsOf`, `BUS_LEVELS`, `MUSIC`, `SOUND_RECIPES` and the private helpers `marchPitch`, `midiHz`, `CHORDS`, `BARS`) moved from `theme/theme.js` to the new `sound/recipes.js`. `theme/theme.js` now has no imports (125 to 42 lines). The synth imports its defaults from `./recipes.js`. |
| 2 | Remove `game/game.js` to `platform/storage.js` | Done. `game.js` exports `applyBestStore(store)` with `store = { load() -> score, save(score) }`; until it is called the rules use a store that keeps nothing (`g.best` is 0). `main.js` calls `applyBestStore({ load: loadBest, save: saveBest })` right after `applySettings`, before the first frame. The best score is still read once before play and saved at the same point as before (in `gameOver`, only on a new best). No test needed more than an import path, so the item went ahead. |
| 3 | Split `createSynth` (253 lines) | Done, public surface unchanged (see below). |
| 4 | Split `createRenderer` (133 lines) | Done: one named function per element (see below). |
| 5 | L1 names | A few magic numbers named (see below). |

### Synth split (`sound/`)

`createSynth({ recipes, createContext, now, setInterval, clearInterval }) -> { unlock, perform, diagnostics }` is unchanged, as are the journal entries `{ seq, sound, detail, t, at }`, the voice cap of 8, the frozen `window.makeTheRightMove.audio` and every scheduled time.

| Module | Job | Lines |
|---|---|---|
| `synth.js` | Lifecycle (locked, running, suspended, unavailable), cue routing, fail-safe, diagnostics; keeps the long header contract | 139 (was 307) |
| `voices.js` | `createVoiceBuilder(context)`: buses, one voice from a recipe, the shared noise buffer, the siren; `track(list, voice)` | 127 |
| `effects.js` | `createEffects({ builder, bus })`: effect voices with the cap of 8 (oldest cut first), the loops, `voices` and `peakVoices` | 48 |
| `music.js` | `createMusic({ builder, bus, setInterval, clearInterval, guard })`: the tune and its look-ahead scheduler | 49 |
| `journal.js` | `createJournal(now)`: the last 100 sounds and their frozen snapshot | 20 |
| `recipes.js` | Data only | 84 |

`createSynth` is now 89 lines (comments and blank lines included) and holds nine named functions of at most 14 lines each, plus the operations table and the diagnostics. `effects` and `music` exist once the audio context is open, so the diagnostics read them with `?.` and give `0` / `'stopped'` before that, exactly as before.

### Renderer split (`view/render.js`)

`createRenderer` went from 133 to 45 lines. It now builds the sprites, owns `resize` and a 20-line `draw`. The per-element code is module-level functions that take the 2D context: `drawShields`, `drawFormation`, `drawDreamHome`, `drawPlayer`, `drawShot`, `drawBolts`, `drawParticles`, `drawFloatingTexts`, `drawLives`, `drawHud`, `drawTitle`, `drawWaveCleared`, `drawGameOver`, `drawPaused`, plus `drawBackground` (split into `drawMapGrid`, `drawRoads`, `drawRiver`), `createShieldCache`, `blit` and `text`. Draw order and canvas state are as before (including the single `globalAlpha = 1` reset after the particles and floating texts). The file grew from 151 to 213 lines because `ctx` is now passed explicitly and each function has its own header.

### L1 names

- `game/game.js`: `EDGE_MARGIN` (16, shared by the pin and the formation), `FORMATION_STRIDE` (9) and `FORMATION_DROP` (18), `CEILING` (64, top of the playfield).
- `view/render.js`: `MAP_BLOCK` (48) and `ROADS`.
- `main.js`: `MIN_DESKTOP_WIDTH` (640).
- Other numbers in `game.js` were left alone: they are tuning values with one use each, and naming them would be churn.

### Tests

Only import specifiers changed, in 8 files (10 lines added, 8 removed): `fanfare-length`, `music-level`, `synth-fail-safe`, `synth-mix`, `synth-suspended` and `synth-voice-cap` now import `SOUND_RECIPES`, `partsOf`, `BUS_LEVELS` or `MUSIC` from `src/sound/recipes.js`; `hit-pitch` and `synth-hit-pitch` split one import into `HURDLES` from `theme.js` and `hitPitch` from `recipes.js`. No assertion, step, scenario or fixture changed. `fixtures/synth-host.html` and the step files needed nothing (they import `sound/synth.js`, `game/` and `theme/pounds`, which did not move).

### Verification

- `npx bddgen && npx playwright test`: **148 passed** (Chromium, Firefox, WebKit), run once after the batch.
- `npm run build`: passed (46 unit and in-memory tests); `dist/` has 21 files, the 16 from before plus `sound/recipes.js`, `voices.js`, `effects.js`, `music.js` and `journal.js`.
- Extra checks, run on throwaway copies of the previous commit and the new tree (nothing added to the repo):
  - **Synth differential**: 400 random sequences of 80 steps (all cue operations, bogus ones, clock jumps, timer ticks, context suspend/resume, a broken audio graph), recorded on the unit tests' fake audio. After every step the whole node graph (kinds, wiring, every parameter call with its time and value, starts and stops), the noise buffer, the timers and the diagnostics were identical between old and new: 32,000 comparisons. A deliberate 0.1 ms change to the music step made 238 sequences fail, so the check does bite.
  - **Renderer and game**: the same seeded game on Playwright's paused fake clock in Chromium, old against new: SHA-256 of the canvas identical in 9 screenshots (title, play, firing, paused, paused with sound and music off, mid-game, game over), and the audio diagnostics identical, including journal `at` times. Best score saved identically (2550).

### Dependency-direction check

Rule: `game/` imports only from `game/` and `theme/`; `theme/` imports nothing.

```
src/game/game.js:2:import { COLORS, HURDLES, PIN_ART, DREAM_ART, DREAM_BONUSES, pounds } from '../theme/theme.js';
```

That is the only import that leaves `game/`. `grep -c "^import" src/theme/theme.js` gives 0. No browser API is used in `game/` (the only grep hit is a comment in `config.js`). The folder cycle is gone and so is the storage exception.

### Left as they were (flagged)

Test comments and a test title still say "theme" for the sound data. The brief was to change import paths only in tests, so they are stale but harmless:

- `tests/unit/hit-pitch.spec.js:7` (comment: `hitPitch in theme.js`)
- `tests/unit/music-level.spec.js:6-7` and the title of its test (the namespace import is still named `theme`)
- `tests/unit/synth-mix.spec.js:8` (comment: "the numbers in the theme")

Earlier flagged stale comments from the folder move (`fresh-game.js`, `director-harness.js`, `game-driver.js`, `domain-types.js`, `synth-host.html`) are also still there.

## 2026-10-27: replay-verified scores, one shape for both handlers and one way to sign in the smoke test

- **Level**: RPP L1 to L4 (readability, complexity, responsibilities, abstractions); L5 and L6 looked at, nothing to change. **Scope**: the production files `rightmove-invaders-replay-verified-scores` changed in DELIVER (`git diff 01b710b..HEAD`), plus the four items DELIVER left.
- **Method**: planned in cascade order (L1 to L6), applied as one batch, suite run once at the end.
- **Behaviour**: unchanged. The Score API gives the same answers, statuses, reasons and log lines, with the Signing checks in the same order and the clock read the same number of times; the smoke test sends the same requests, in the same order, with the same bodies, and prints the same summary fields; the local server serves the same routes with the same headers. `src/game/` plays as before: `game.js`, `chance.js`, `replay.js`, `shields.js` and `particles.js` are untouched, `record.js` and `high-scores.js` changed in comments only, and `RULES_VERSION` is still 1. No export was added, removed or renamed; no file was added.
- **Commit**: `refactor(rightmove-invaders-replay-verified-scores): one handler shape for the Score API, one way to sign and to ask for a session in the smoke test (L1-L6)`.

### What was done

| File | Transformation | RPP |
|---|---|---|
| `netlify/functions/scores.mjs` | `handlerOf(served, serve)`: `handleScores` and `handleSessions` were one wrapper written twice (a journal, a try, 500 `unexpected` under the path's error event), and `route` and `issue` both opened with the same method check. One factory now holds that policy, and the two exports are `handlerOf(SCORES, route)` and `handlerOf(SESSIONS, issue)`, called as before with `(request, port, options)` | L3, L4 |
| | `refuse(logLine, error, { event, headers, fields })`: a parameter object in place of three trailing positional defaults, so no caller passes `NEVER_KEPT` only to reach the event (4 such calls, now 0) | L2 |
| | The Signing checks table names every row: its five inline functions became `hasAllowedInitials`, `isSealed`, `notFromTheFuture`, `notExpired` and `claimIsPlausible`, and each row carries its number in DESIGN's table (6 to 16). Same predicates, same order | L1 |
| | `isObject` and `hasExactly(value, fields)`, shared by the signing's and the session request's shape checks (the object test was written 3 times). `isSeedRequest` reads `hasExactly(body, ['seed'])`, which for a parsed JSON body is what `keys.length === 1 && hasOwn('seed')` was | L2 |
| | `refuseBeforeTheTable`: one guard and one journal, not a journal in each branch; `whereOf(scope, deploy)` names where the Netlify entry says the table is kept | L2 |
| | The comment that `saving` and `passOnRefusal` both carried is said once | L1 |
| `scripts/smoke-leaderboard.mjs` | `sendSigning(run, body, options)`: the one way a step signs, in place of the curried `signAt(run)(body)` (8 uses) and 9 direct `run.client.post(scoresAt(run.target), …)` | L1, L2 |
| | `sessionAskedFor(run, seed, options)` -> `{ answer, session }`: asking for a session and taking it out of its answer, with the seed passed once (`sessionFor` was called in 16 places, now in 3, the helper's included) | L2 |
| | `gameSigning(run, game, session, i)`: the i-th signing of a game made in Node, in place of 7 of the 8 copies of `run.slice.signing(claimOf(game, i), session, game.record)` (S12's, which signs another record, stays) | L2 |
| | `unchangedIds(before, after)`: whether two listings show the same ids, null when one never came, for `settleTestRoute`, `settleNothingKept` and S11's `noRowWritten` | L2 |
| | `briefOf(answer)`: `{ status, error }` as a summary shows an answer (4 inline copies, now 1; the summaries' key order is kept) | L1 |
| | `floodsApart(run, record, floods)`: the over-limit floods, each after a 61 s wait, for the leaderboard's run and slice 01's | L2 |
| | S4 reads session B out of its answer once, not twice | L1 |
| `scripts/serve.mjs` | The request listener asks `putsRow` once, with a guard clause for files | L2 |
| | `JSON_NO_STORE`, the headers of the root's own JSON answers (the test route's and its 500), written once | L1 |
| `src/game/record.js` | The header said game-too-long is "the signing's next check" after the reader. Since 03-03 the signing checks rules-changed (row 12) before `readRecord` (row 12b) and game-too-long (row 13) after it: the comment now says that the reader judges neither the rules version nor the length, and which check does, on which side. It also says the function reads with it, as the replay does | L1 |
| `src/game/high-scores.js` | The header said only the browser runs `game.js`'s use of `makesTheTable`; the function's replays run it too, with no table, so they never ask for initials | L1 |

### Items DELIVER left

1. **`tests/unit/scores-handler.spec.js`, "any record readRecord refuses is invalid-record"**: its `fc.jsonValue` arm could draw an object naming a safe-integer `rules` other than `RULES_VERSION`, which row 12 answers `rules-changed`. The arm's filter now also drops such a value (`namesOtherRules`), and the comment above says why. Its assertions are as they were. The rules-changed property, which reuses the same generator and then sets `rules` itself, is unaffected.
2. **`tests/e2e/rightmove-invaders-leaderboard/acceptance/steps/parameter-types.js`**: the `stretched past 1 KB` alternative of the `{signature}` type, and its 1,025-byte branch, are gone; its comment says what "stretched to 1 KB" still is. No `.feature` used it (`grep`: the only "stretched past 1 KB" left is the session request's `its seed stretched past 1 KB`, another type in another file); `npx bddgen` generates every scenario and `npx bddgen export --unused-steps` lists none.
3. **`src/game/record.js`'s header**: made true (above).
4. **Duplication in `scores.mjs` and `smoke-leaderboard.mjs`**: reduced as above, without changing an answer, a log line or a step's outcome.

### Left as they were

- **`src/game/game.js`, `chance.js`, `replay.js`, `shields.js`, `particles.js`**: the six recorded games must replay to their deposit and step, and no draw may move. Nothing in them was worth that risk; the one-letter names are the house idiom in the game code.
- **`src/main.js`, `src/platform/leaderboard.js`, `src/view/render.js`, `netlify/scores/sessions.mjs`**: already small and plain after DELIVER; nothing to do.
- **No new module.** The Signing checks, or the smoke test's slice steps, could live in modules of their own, but DESIGN's component table has neither, and each file still reads in sections.
- **"Exactly these fields"** is also checked in `sessions.mjs` (`isSession`), `record.js` (`hasItsFieldsAlone`) and `high-scores.js` (`hasExactlyTheFields`). Two of those must import nothing (rules 3 and 8), so one shared helper would need a module of its own.
- **The 32-hex seed pattern** is in `scores.mjs` and `sessions.mjs`: DDD-R1's request and DDD-R2's session, two rules that agree today.
- **`replay.js` and the smoke test's `firstStepsOf`** both walk a record's changes step by step. A shared walker in `record.js` would sit on the replay's hot path (D21's budget) to save four lines.
- **The smoke test's expectation tables** (`FORGERIES`, `REFUSED`, `CLOCK_CHECKED`) have three shapes because the steps check three different things: one answer each, a forgery with its answer, and alternatives.
- **The secret check in the three slice runs** (record the step, then a 500 stops the run) is three lines each around one shared message; a helper would not make it shorter.
- **`failedLocally` in `serve.mjs`** maps a path to its error event, as `scores.mjs`'s `PATHS` does; exporting `PATHS` for one line would widen the function's surface.

### Verification

- `npm run build`: passed, 364 tests (158 unit, 206 in-memory), 18.5 s wall time against the 30 s budget, 29 files in `dist/`.
- `PORT=4185 CI=1 npm test`, run once after the batch: **775 passed** in 19.0 minutes (158 unit, 206 in-memory, 137 in each of Chromium, Firefox and WebKit), none failed, flaky or skipped.
- `node --check scripts/smoke-leaderboard.mjs`: passes. `npx bddgen export --unused-steps`: 0.
- The layering rules, the token rule and rule 9 (`tests/unit/layering.spec.js`) are green; the six recorded games replay to their deposit and step in Node and in the three browsers (M6).
