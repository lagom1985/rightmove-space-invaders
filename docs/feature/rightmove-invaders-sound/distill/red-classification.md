# RED classification: rightmove-invaders-sound (revision 3)

Run on 2026-10-23 with `RUN_PENDING=1 npx playwright test` against the revision-3 scaffolds (`src/sound.js`, `src/synth.js`).

| Run | Tests | Passed | Failed |
|---|---|---|---|
| Full suite (before the two US-07 scenarios were added) | 113 = 23 in-memory + 29 browser examples × 3 + the game's walking skeleton × 3 | 3 (the game's walking skeleton) | 110 |
| Targeted: the two added US-07 scenarios (`-g "N switches the music off\|Music still starts on"`) | 12 = 4 browser examples × 3 | 0 | 12 |
| **Current total** | **125** = 23 + 33 × 3 + 3 | **3** | **122** |

**Verdict: every failure is MISSING_FUNCTIONALITY.** No IMPORT_ERROR, FIXTURE_BROKEN, SETUP_FAILURE, WRONG_ASSERTION or OBSERVABLE_NOT_AT_PORT. No sound scenario passes before implementation.

| Failure message | Count | Why it is the right reason |
|---|---|---|
| `Not yet implemented -- RED scaffold` | 23 (all in-memory; the 4 properties report it as fast-check's root cause) | The director doesn't exist yet |
| `the game has no sound system to check` | 15 | `window.makeTheRightMove.audio` doesn't exist yet. Silence checks refuse to pass without it |
| `expected to hear shot / N × shot / march / shield-hit / home-lost / doorbell / game-over` | 27 | No sound is started yet (including the positive controls in the M silence scenarios) |
| `expected the formation to march N steps` | 12 | No beat notes yet (four-note beat, respawn, window, tab) |
| `expected "running"` / `"unavailable"` | 9 | The synth scaffold throws (host page); the game has no diagnostics yet (two fallbacks) |
| `[data-hud="sound"]` / `[data-hud="music"]` not found or wrong text | 24 + 12 | The HUD fields and toggles don't exist yet |

**Test-the-tests** (the satisfiable and discriminating checks, separate from RED): a throwaway policy-table director passed all 23 in-memory scenarios, and four broken variants were each caught. See the feature delta's "Test-the-tests evidence".

**DELIVER condition**: enable the walking skeleton first, and re-run `RUN_PENDING=1` before enabling each next scenario, to confirm it still fails only for MISSING_FUNCTIONALITY.
