# Quality metrics

Measured on `src/**/*.js` before and after the 2026-10-24 reorganisation (see `refactoring-log.md`). Imports are counted per module as `import ... from '<relative path>'` lines; fan-out is the number of modules a file imports, fan-in the number of `src/` modules that import it. Tests are not counted.

## Files per folder

| Folder | Before | After |
|---|---|---|
| `src/` (root, JavaScript) | 12 | 1 (`main.js`) |
| `src/game/` | n/a | 4 (`config`, `events`, `game`, `shields`) |
| `src/sound/` | n/a | 2 (`director`, `synth`) |
| `src/view/` | n/a | 2 (`render`, `status`) |
| `src/platform/` | n/a | 2 (`input`, `storage`) |
| `src/theme/` | n/a | 1 (`theme`) |
| Largest folder | 12 | 4 |

`style.css` and `icons/` stay at the `src/` root in both layouts.

## Import fan-out and fan-in per module

| Module (before) | Out | In | Module (after) | Out | In |
|---|---|---|---|---|---|
| `config.js` | 0 | 4 | `game/config.js` | 0 | 4 |
| `events.js` | 0 | 5 | `game/events.js` | 0 | 5 |
| `game.js` | 5 | 2 | `game/game.js` | 5 | 2 |
| `shields.js` | 1 | 2 | `game/shields.js` | 1 | 2 |
| `input.js` | 0 | 1 | `platform/input.js` | 0 | 1 |
| `main.js` | 9 | 0 | `main.js` | 9 | 0 |
| `render.js` | 4 | 1 | `view/render.js` | 4 | 1 |
| `sound.js` | 1 | 1 | `sound/director.js` | 1 | 1 |
| `status.js` | 1 | 1 | `view/status.js` | 1 | 1 |
| `storage.js` | 0 | 2 | `platform/storage.js` | 0 | 2 |
| `synth.js` | 2 | 1 | `sound/synth.js` | 2 | 1 |
| `theme.js` | 1 | 4 | `theme/theme.js` | 1 | 4 |

- **Max fan-out**: 9 (`main.js`) before and after. That is expected for the composition root.
- **Max fan-in**: 5 (`events.js` / `game/events.js`) before and after.
- **Total import edges**: 24 before and after. A move changes where files live, not who imports whom.

## Cross-layer imports (edges between different folders)

| | Before | After |
|---|---|---|
| Edges between folders | 0 (one folder, so layers were invisible) | 20 |
| of which from `main.js` (composition root) | not separable | 9 |
| of which between layers | not separable | 11 |

Between-layer edges after the move, grouped:

| From | To | Edges |
|---|---|---|
| `game/` | `theme/` | 1 (`game.js` to `theme.js`) |
| `game/` | `platform/` | 1 (`game.js` to `storage.js`, accepted exception) |
| `game/` | `sound/`, `view/` | 0 |
| `sound/` | `game/` | 2 (`events.js`) |
| `sound/` | `theme/` | 1 (`synth.js` to `theme.js`) |
| `view/` | `game/` | 3 (`config.js`, `shields.js`, `game.js`) |
| `view/` | `theme/` | 2 |
| `theme/` | `game/` | 1 (`theme.js` to `events.js`) |
| `platform/` | anything | 0 |

The layers the brief calls adapters (`sound/`, `view/`, `platform/`) depend on `game/` and `theme/` and never on each other. `game/` depends on adapters only through the one accepted `platform/storage.js` import. The `game/` and `theme/` folders depend on each other (see the log).

## Other checks

- Unresolved import specifiers in `src/`: 0.
- Test lines changed: 30, all import specifiers (19 files); no assertions, steps or scenarios changed.
- Behaviour: unchanged. Full suite 148 passed (run once, after the batch); `npm run build` passed (46 unit and in-memory tests) and `dist/` contains the same 16 files in the new tree.

---

## Second pass, 2026-10-24: sound recipes, best-score store, synth and renderer split

Measured on `src/**/*.js` before (commit `9ab6841`) and after (see `refactoring-log.md`). Function lengths run from the `function` line to its closing brace, comments and blank lines included; nested functions count toward the function that holds them. Tests are not counted.

### Lines per module

| Module | Before | After |
|---|---|---|
| `main.js` | 73 | 76 |
| `game/config.js` | 7 | 7 |
| `game/events.js` | 22 | 22 |
| `game/game.js` | 302 | 315 |
| `game/shields.js` | 61 | 61 |
| `platform/input.js` | 31 | 31 |
| `platform/storage.js` | 33 | 33 |
| `sound/director.js` | 114 | 114 |
| `sound/synth.js` | 307 | 139 |
| `sound/voices.js` | n/a | 127 |
| `sound/effects.js` | n/a | 48 |
| `sound/music.js` | n/a | 49 |
| `sound/journal.js` | n/a | 20 |
| `sound/recipes.js` | n/a | 84 |
| `theme/theme.js` | 125 | 42 |
| `view/render.js` | 151 | 213 |
| `view/status.js` | 57 | 57 |
| **Total** | **1283** | **1438** |

- **Largest module**: `synth.js` at 307 before, `game.js` at 315 after (untouched apart from the store and four named constants). The synth's header contract is 40 of its 139 lines.
- **Total grew by 155 lines**: module headers, `ctx` and builder passed as parameters, and one function with its own header per element. Nothing was added to behaviour.

### Function lengths

| Function | Before | After |
|---|---|---|
| `createSynth` | 253 | 89 |
| `createRenderer` | 133 | 45 |
| `createVoiceBuilder` (new, in `voices.js`) | n/a | 66 |
| `createMusic` (new) | n/a | 37 |
| `createEffects` (new) | n/a | 35 |
| `createStatus`, `createKeyboard` (not touched) | 48, 26 | 48, 26 |

- **Longest function in `src/`**: 253 before, 89 after.
- **Longest function that is not a factory**: 32 before (`render.js` `draw`), 23 after (`game.js` `update`, not touched). In the code touched here the longest is `startSiren` at 21 and the renderer's `draw` at 20.
- **Named functions in `src/`**: 90 before, 110 after.
- **Factories still over 30 lines**: `createSynth`, `createVoiceBuilder`, `createStatus`, `createRenderer`, `createMusic` and `createEffects`. Each is a closure over private state, made of the small functions above; none has a body that does more than one job.

### Import edges

| | Before | After |
|---|---|---|
| File-level import edges in `src/` | 24 | 31 |
| of which between folders | 20 | 18 |
| of which inside one folder | 4 (`game/`) | 13 (4 in `game/`, 9 in `sound/`) |
| Folder-level cycles | 1 (`game/` and `theme/`) | 0 |
| Modules with no imports | 4 (`config`, `events`, `input`, `storage`) | 6 (those four, `theme`, `journal`) |

The 9 edges inside `sound/` are `synth` to `recipes`, `voices`, `effects`, `music` and `journal`; `effects` to `voices`; `music` to `recipes` and `voices`; `voices` to `recipes`.

Edges between folders (from, to, count):

| From | To | Before | After |
|---|---|---|---|
| `main.js` | `game/` | 3 | 3 |
| `main.js` | `platform/` | 2 | 2 |
| `main.js` | `sound/` | 2 | 2 |
| `main.js` | `view/` | 2 | 2 |
| `game/` | `theme/` | 1 | 1 |
| `game/` | `platform/` | 1 (`game.js` to `storage.js`) | 0 |
| `sound/` | `game/` | 2 | 3 (`synth`, `director` and `recipes` to `events`) |
| `sound/` | `theme/` | 1 (`synth.js`) | 0 |
| `theme/` | `game/` | 1 (`theme.js` to `events.js`) | 0 |
| `view/` | `game/` | 3 | 3 |
| `view/` | `theme/` | 2 | 2 |
| **Total** | | **20** | **18** |

Fan-in and fan-out of the modules whose edges changed:

| Module | Out before | Out after | In before | In after |
|---|---|---|---|---|
| `game/game.js` | 5 | 4 | 2 | 2 |
| `platform/storage.js` | 0 | 0 | 2 | 1 (`main.js`) |
| `sound/synth.js` | 2 | 6 | 1 | 1 |
| `sound/recipes.js` | n/a | 1 | n/a | 3 (`synth`, `voices`, `music`) |
| `theme/theme.js` | 1 | 0 | 4 | 3 |

### Layer rules

| Rule | Before | After |
|---|---|---|
| `game/` imports only `game/` and `theme/` | one exception (`platform/storage.js`) | holds |
| `theme/` imports nothing | one import (`game/events.js`) | holds |
| `sound/`, `view/` and `platform/` do not import each other | holds | holds |

### Other checks

- Unresolved import specifiers in `src/`: 0.
- Test lines changed: 10 added and 8 removed in 8 files, all import specifiers.
- Behaviour: unchanged. Full suite 148 passed (run once, after the batch); `npm run build` passed (46 unit and in-memory tests) with 21 files in `dist/`. A differential run of the synth against the previous commit (32,000 graph comparisons) and canvas hashes of 9 scenes were identical.
