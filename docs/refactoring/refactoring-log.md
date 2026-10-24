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
