# ADR-006: High-score rules shared by the browser and the function in one pure module

**Status**: Accepted (user, 2026-10-24, revision 2) · **Feature**: rightmove-invaders-leaderboard

## Context
The browser decides whether a deposit makes the table (and so whether to ask for initials). The function decides whether a signature is valid and where it ranks. In the walking skeleton each side declares its own table size, initials format, £50 step and maximum. If they drift apart, the game asks for initials that the server then rejects, or refuses initials that the server would accept.

Three constraints shape where shared code can go:
- The browser only receives `index.html` and `src/` (`scripts/build.mjs`), with no bundler.
- Netlify bundles functions from the repository and follows relative imports.
- `src/game/game.js` can't be imported server side: it holds the module-level game state `g` and imports theme, shields and config.

## Decision
- **New pure module `src/game/high-scores.js`.** It imports nothing and holds:
  - the table size (10), the initials alphabet (A–Z) and length (3), the score step (£50) and the maximum (£9,999,999)
  - signature validity as two questions (clarified in DISTILL): `isValidSignature` is shape only (exactly `{ initials, score }`, three letters A–Z, a positive multiple of £50 up to the maximum), and `isAllowedInitials` is the word filter. The browser needs both; the function maps a bad shape to 400 `invalid-signature` and blocked initials to 400 `initials-not-allowed`
  - the 3-letter word filter
  - the qualification rule `makesTheTable(table state, deposit)`. It is true only when the table state's status is `available`, the deposit is above 0, and there are fewer than 10 rows or the deposit is above the 10th row's (a tie misses).
- **Who uses what**: `src/game/game.js` uses all of it. `netlify/functions/scores.mjs` uses the table size and signature validity, word filter included. Only the browser uses `makesTheTable`: the server ranks every valid signature and never decides qualification (ADR-008).
- **The server-only parts stay in the function file** as pure functions (the plan-value pattern): the key codec, ranking from keys, the choice of keys to prune, and `chooseStore` (ADR-005). Only the handler performs effects, through the restricted store port (ADR-004). If that code grows, it moves to a folder outside `netlify/functions/`, because every top-level file there becomes a function.
- **Five layering rules**, enforced by a hand-rolled import-scan unit test in the `unit` project (and so in the build gate):
  1. `game/` imports only from `game/` and `theme/`.
  2. `theme/` imports nothing.
  3. `game/high-scores.js` imports nothing.
  4. `src/**` never imports `netlify/**` or `@netlify/*`.
  5. `netlify/**` imports only `src/game/high-scores.js` from `src/`.

  The scan must recognise every import form used in ES modules: `import … from '…'`, bare `import '…'`, `export … from '…'` and dynamic `import('…')`.

## Alternatives considered
- **Duplicated constants** (the skeleton): no build risk, but the browser and the server drift apart, and nothing catches it.
- **Separate handler, codec and store-port files under a `netlify/scores/` folder**: the cleanest split, but more files for about 100 lines. Kept for when the code grows.
- **Putting the constants in `src/game/config.js`**: it would mix canvas geometry with table rules, and the function would carry the geometry.
- **A module outside `src/`** (for example `shared/`): the browser could not load it, because only `src/` is published.
- **dependency-cruiser for the layering rules**: well maintained (MIT), but a sizeable devDependency for five rules. Adopt it if the rules grow, or if the hand-rolled scan starts missing import forms.

## Consequences
- One rule for signature validity on both sides of the wire: the game never sends initials that the server would refuse for size, step or word filter.
- One qualification rule in the browser that knows the table's status: no prompt while the table is unknown or unavailable.
- The score step is stated in the rules module, not derived from the theme. A unit test checks that every hurdle value and Dream Home bonus is a multiple of it.
- The function's bundle includes one file from `src/`. That the Netlify bundler follows the relative import is verified by the DEVOPS smoke test.
- `high-scores.js` is published to the browser like the rest of `src/`. Its word filter is therefore public, which is acceptable.
