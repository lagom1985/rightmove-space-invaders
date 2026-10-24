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
