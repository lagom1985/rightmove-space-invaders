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
