# RED classification: rightmove-invaders-leaderboard (DISTILL, 2026-10-24, final correction round)

Command: `PORT=4174 CI=1 RUN_PENDING=1 npx playwright test --project=chromium --project=in-memory .features-gen/tests/e2e/rightmove-invaders-leaderboard`, against the committed skeleton plus the Mandate 7 scaffolds (`src/game/high-scores.js`; `createTablePort` and the pure helpers in `netlify/functions/scores.mjs`; the table functions and `snapshot()` in `src/game/game.js`).

**Result: 65 runs (33 in-memory, 32 Chromium). 55 RED, all correct. 10 green. 0 `IMPORT_ERROR` / `FIXTURE_BROKEN` / `SETUP_FAILURE` / `WRONG_ASSERTION`.**

| Class | Runs |
|---|---|
| `MISSING_FUNCTIONALITY`, scaffold throw (`__SCAFFOLD__: not yet implemented`) | 31 |
| `MISSING_FUNCTIONALITY`, assertion on behaviour the skeleton lacks | 21 |
| `MISSING_DATA` (a data gap: the owner-reviewed word list is empty; the failure stays loud) | 3 |
| Green (guards, below) | 10 |

The Givens no longer assert the outcome text under test (review H3). A Given waits for the network, not for words, so a run now fails in the step that checks the behaviour, with three exceptions that fail while arranging because the arrangement needs the behaviour (marked "in the Given" below).

Chromium only for the browser scenarios: the engines share one driver, and all of them also passed in Firefox and WebKit against a throwaway implementation (feature-delta, "DELIVER handoff").

## Server (project in-memory, `@server`): 30 runs, 29 RED, 1 data gap

| Scenario (runs) | Reason | Class |
|---|---|---|
| M1 An empty high-score table is read as empty, and everyone sees it at most 15 seconds old (1) | scaffold: `createTablePort` | MISSING_FUNCTIONALITY |
| M1 The table shows the best ten signatures … (1) | scaffold | MISSING_FUNCTIONALITY |
| M1 Stray entries that aren't signatures are ignored … (1) | scaffold | MISSING_FUNCTIONALITY |
| M1 A reader is told the table failed … (1) | scaffold | MISSING_FUNCTIONALITY |
| M2 A valid signature is saved, and the answer shows where it ranks (1) | scaffold | MISSING_FUNCTIONALITY |
| M2 Signing twice … makes two rows (1) | scaffold, in the Given that saves the first | MISSING_FUNCTIONALITY |
| M2 The table accepts the signature … (3) | scaffold | MISSING_FUNCTIONALITY |
| M2 The table refuses … and saves nothing (9) | scaffold | MISSING_FUNCTIONALITY |
| M2 Initials on the word filter are refused by the table too (1) | `DATA GAP`: `BLOCKED_INITIALS` is empty, so there is no initials example | MISSING_DATA |
| M2 Asking the table to … is refused (2) | scaffold | MISSING_FUNCTIONALITY |
| M2 A signature that would land on an existing row … (1) | scaffold, in the Given that saves the first | MISSING_FUNCTIONALITY |
| M2 A signature the table fails to save … (1) | scaffold | MISSING_FUNCTIONALITY |
| M2 A signature saved just before the table can't be looked at … (1) | scaffold | MISSING_FUNCTIONALITY |
| M2 A new row the table can't file … (1) | scaffold | MISSING_FUNCTIONALITY |
| M3 With … scores already kept, a new signing tidies away … (3) | scaffold | MISSING_FUNCTIONALITY |
| M3 A signing is still saved and answered when tidying up fails (1) | scaffold | MISSING_FUNCTIONALITY |
| M3 However many signatures arrive at once … (property) (1) | scaffold, as the property's counterexample | MISSING_FUNCTIONALITY |

## In-memory rules (Tier B, project in-memory, `@in-memory`): 3 runs, 2 RED, 1 data gap

| Scenario | Reason | Class |
|---|---|---|
| M8 Whatever order the table's answers arrive in … (property) | `DATA GAP`: the property now demands the owner-reviewed word list before it runs (its refusal witness is no longer skipped when the list is empty); with a list it reaches `snapshot()`, a scaffold | MISSING_DATA |
| M8 A game that ends before the table has ever answered … | scaffold: `snapshot()`, in the Given | MISSING_FUNCTIONALITY |
| M8 The answer to a signing I have since replaced … | scaffold, in the Given that signs | MISSING_FUNCTIONALITY |

With a word list in place (the throwaway run), the property passes against DESIGN-following rules with every witness reached, the refusal included.

## Browser (chromium): 32 runs, 22 RED and 10 green (the green ones are listed below)

| Scenario (runs) | Reason | Class |
|---|---|---|
| M4 A deposit is asked for initials while the table has room (1) | assertion: no `data-hud="initials"` field | MISSING_FUNCTIONALITY |
| M5 My signing shows as pending until the table answers (1) | assertion: the game says `Signed FAB. Press Enter…`, never `Signing FAB…` | MISSING_FUNCTIONALITY |
| M5 The table confirms my signing and marks my row (1) | assertion: never `Signed FAB, #1.` | MISSING_FUNCTIONALITY |
| M5 The table filled up before my signing arrived (1) | assertion: never `The table filled up before FAB arrived.` | MISSING_FUNCTIONALITY |
| M5 When the high-score table … I am told my signing couldn't be confirmed (2) | assertion: never `Couldn't confirm FAB's signing.` | MISSING_FUNCTIONALITY |
| M5 A signing with no answer after 4.9 seconds is still pending (1) | assertion: never `Signing FAB…` | MISSING_FUNCTIONALITY |
| M5 A signing with no answer after 5 seconds is given up (1) | assertion: never `Couldn't confirm FAB's signing.` | MISSING_FUNCTIONALITY |
| M5 Initials on the word filter are refused, and I can change a letter (1) | `DATA GAP`: `BLOCKED_INITIALS` is empty | MISSING_DATA |
| M5 The initials field tells me the letters … (1) | assertion: no initials field | MISSING_FUNCTIONALITY |
| M5 Up pressed 3 times … (2) | assertion: no initials field | MISSING_FUNCTIONALITY |
| M6 When the high-score table can't be reached, the game says so … (1) | assertion: never `High-score table unavailable.` | MISSING_FUNCTIONALITY |
| M6 The table is refreshed when a game starts (1) | assertion: the skeleton loads only at page load, so it still asks for initials | MISSING_FUNCTIONALITY |
| M6 A failed refresh keeps the last good table … (1) | assertion: `the game never asked the table for a refresh` (review H1: it was vacuously green before) | MISSING_FUNCTIONALITY |
| M6 A first load that never answers … (1) | assertion: never `High-score table unavailable.` (the skeleton has no timeout) | MISSING_FUNCTIONALITY |
| M6 A refresh that never answers … (1) | assertion: `the game never asked the table for a refresh` | MISSING_FUNCTIONALITY |
| M7 A signing confirmed during my next game is still announced, once (1) | assertion: never `Signed FAB, #1.` | MISSING_FUNCTIONALITY |
| M7 My confirmed row stays marked on the next game-over screen … (1) | assertion: no row marked `aria-current` | MISSING_FUNCTIONALITY |
| M7 An older copy of the table that arrives late … (1) | in the Given: `the refresh for the new game never reached the table` (DDD-7's refresh is missing) | MISSING_FUNCTIONALITY |
| M7 A newer signing moves my mark … (1) | assertion: no row marked `aria-current` | MISSING_FUNCTIONALITY |
| M7 My row loses its mark when newer signings push it off the table (1) | assertion: `FAB is still on the table` (no refresh at game start) | MISSING_FUNCTIONALITY |

## Already green (10 runs)

| Scenario | Why it runs now |
|---|---|
| Walking skeleton (inherited) | Green by design; DELIVER keeps it compatible (feature-delta, "WS strategy") |
| M4 A deposit that doesn't beat a 10th row of £100 / £50 (2 runs) | Skeleton behaviour that no DELIVER step changes: a regression guard |
| M4 A game that ends without a deposit … (1) | Same |
| M6 The title screen shows no high-score table while it can't be reached (1) | Same |
| M5 A signing that was dropped is sent exactly once, never retried (1) | The skeleton sends once; DELIVER must not add a retry (ADR-008). **New in this round** |
| M5 Enter starts a new game when my signing is on its way / confirmed / off the table / unconfirmed (4) | Enter never waits on the table. With the Givens no longer asserting the outcome text (H3), these pass against the skeleton, so they are un-pended as regression guards for the lifecycle DELIVER adds. They are **not** RED-driving. **Changed in this round** |

Final round: the M2 "declared length" row moved to a DELIVER unit test (one run fewer), and the M8 property became a loud data gap instead of skipping its refusal witness. Earlier round, compared with the first classification (55 RED, 6 green): the 11 browser runs whose Givens asserted outcome text now fail in the Then (6 of them), fail in the Given because the arrangement needs DDD-7's refresh (1), or are green guards (the Enter outline ×4); "A failed refresh keeps the last good table" went from vacuously green to RED; the two new hang scenarios and the two new browser scenarios ("a newer signing moves my mark", "sent exactly once") are added; the word-filter runs are marked as a data gap.

## Test-the-tests (satisfiability and discrimination)

Throwaway implementations in the session scratchpad (never committed; every touched file was restored and checked by checksum):
- `@server`: 30 of 30 runs pass against a handler that follows DESIGN's handler delta, and 17 broken variants are each caught (re-run in the final round).
- Tier B: 3 of 3 pass against rules that follow DESIGN's rules operations, with every witness state reached, and 6 broken variants are each caught (re-run in the final round).
- Browser: the 32 browser runs passed in all three engines against a minimal browser side; after the two driver fixes, M5 and M7 passed again in all three engines; after the final round's driver change, all 32 passed again in Chromium.
