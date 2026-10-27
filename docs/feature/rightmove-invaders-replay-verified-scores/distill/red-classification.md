# RED classification: rightmove-invaders-replay-verified-scores (DISTILL, 2026-10-26, re-run 2026-10-27 after the review)

Commands: `CI=1 RUN_PENDING=1 npx playwright test --project=in-memory .features-gen/tests/e2e/rightmove-invaders-replay-verified-scores`, then the same with `--project=chromium`, on the feature branch at `026f81d` plus this wave's scaffolds and drivers, with `TABLE_PROTOCOL` at `BARE`. The scaffolds: `src/game/record.js`, `src/game/replay.js` and `netlify/scores/sessions.mjs` (new), and the new exports `handleSessions` (`netlify/functions/scores.mjs`) and `createGame` (`src/game/game.js`).

**Result: 77 runs (63 in-memory, 14 Chromium). 70 RED, every one for the right reason; 7 green, run as guards. 0 `IMPORT_ERROR` / `FIXTURE_BROKEN` / `SETUP_FAILURE` / `WRONG_ASSERTION`.**

| Class | Runs |
|---|---|
| `MISSING_FUNCTIONALITY`, scaffold throw (`__SCAFFOLD__: … not yet implemented`) | 59 |
| `MISSING_FUNCTIONALITY`, assertion on behaviour the code lacks | 6 |
| `MISSING_FUNCTIONALITY`, no recorded games yet (E5) | 5 |
| Green today, taken off `@pending` as guards (below) | 7 |

## Browser (Chromium): 14 runs, 7 RED, 7 guards

| Scenario (runs) | Reason | Class |
|---|---|---|
| M3 Typed initials sign the table through the game's own session (1) | "the table never answered this game's session request": the game asks for none yet | MISSING_FUNCTIONALITY |
| M3 Starting a game asks the table's server once (1) | the request at the start is today's refresh (a read), not a session request | MISSING_FUNCTIONALITY |
| M3 A game whose session request can't be reached / never answers (2) | "Signed ALX, #4.", not "Couldn't confirm": the signing needs no session yet | MISSING_FUNCTIONALITY |
| M5 A deposit changed on its way to the table is refused (1) | "Signed HAX, #1.": today's table saves £249,950 | MISSING_FUNCTIONALITY |
| M5 The console line of the 2026-10-26 forgery can't reach the game in play (1) | the module loaded, and exports the game in play (the line then ran and set the deposit) | MISSING_FUNCTIONALITY |
| M6 Every recorded game plays back as it was recorded, in this browser (1) | no recorded games (E5) | MISSING_FUNCTIONALITY |
| M3 The game starts at once while the table answers its session request … (4) | green: no session request yet, so nothing can hold the start | guard, run now |
| M3 Two house-hunters on one table each sign a game of their own (1) | green: two pages sign two rows | guard, run now |
| M8 The browser's clock plays no part (2) | green: no clock check yet; a real-time game signs | guard, run now |

The 7 guards then passed in Firefox and WebKit too (24 of 24 runs with the leaderboard's skeleton), and run in every `npm test` from now on.

Chromium only for the RED run: the engines share one driver. Against a throwaway build of DESIGN's slice 03, all 14 browser runs passed in Chromium, Firefox and WebKit, except the console-line scenario, which the throwaway fails by its own shortcut (feature-delta, "DELIVER handoff").

## Server and in memory (project in-memory): 63 runs, all RED

| Scenario (runs) | Reason | Class |
|---|---|---|
| Skeleton: The owner's table turns away a signing that no game asked for (1) | scaffold: `createSessionSigner` (the harness builds the roots' signer before the request) | MISSING_FUNCTIONALITY |
| M1 A game that starts gets its session and the table (1) | scaffold: `createSessionSigner` | MISSING_FUNCTIONALITY |
| M1 A request for a session with … is refused (7) | scaffold: `createSessionSigner` | MISSING_FUNCTIONALITY |
| M1 Asking for a session any other way (1) | scaffold: `createSessionSigner` | MISSING_FUNCTIONALITY |
| M1 When the table can't be looked at, no session (1) | scaffold: `createSessionSigner` | MISSING_FUNCTIONALITY |
| M1 Without its secret, the table issues no session (1) | scaffold: `handleSessions` (no signer is built: the table has none) | MISSING_FUNCTIONALITY |
| M1 Without its secret, the table saves no signing (1) | scaffold: `createSessionSigner`, in the Given that gives Alex's game a session | MISSING_FUNCTIONALITY |
| M2 A session the table didn't seal (6) | scaffold: `createSessionSigner`, in the Given | MISSING_FUNCTIONALITY |
| M2 A game has one row on the table (2) | scaffold: `createSessionSigner`, in the Given that signs the first | MISSING_FUNCTIONALITY |
| M2 However many signings of one game arrive at once (property) (1) | scaffold: `createSessionSigner`, as the property's counterexample | MISSING_FUNCTIONALITY |
| M2 A refused attempt doesn't use up the session (1) | scaffold: `createSessionSigner`, in the Given | MISSING_FUNCTIONALITY |
| M2 A game saved just before the table couldn't be looked at (1) | scaffold: `createSessionSigner`, in the Given | MISSING_FUNCTIONALITY |
| M2 A session lasts 2 hours (5) | scaffold: `createSessionSigner`, in the Given | MISSING_FUNCTIONALITY |
| M4 An honest game's deposit … (1), A record made up by hand (1) | scaffold: `createSessionSigner` | MISSING_FUNCTIONALITY |
| M4 A deposit the game didn't play to (3), A record that … (2), A record whose … (7), The ceiling (2) | scaffold: `createGame` (the game is played in Node before its signing) | MISSING_FUNCTIONALITY |
| M6 The table saves every recorded game … (1), A recorded game that now ends … is refused by the table (2) | no recorded games: the corpus is E5's | MISSING_FUNCTIONALITY |
| M7 The longest recorded game signs (1) | no recorded games (E5) | MISSING_FUNCTIONALITY |
| M7 A record of … standing still (2), The largest record a human could make … is read and played back (1), A signing of … (2), The table stops reading … soon after its limit (1) | scaffold: `createSessionSigner` | MISSING_FUNCTIONALITY |
| M8 A 20-minute game signed a minute after its session (1) | scaffold: `createSessionSigner` | MISSING_FUNCTIONALITY |
| M8 … even when the request asks for the local server's lenient clock (1), Signed as long after its session as the game lasted, less … (2), An honest game is never too fast (3) | scaffold: `createGame` | MISSING_FUNCTIONALITY |
| M9 A record from other rules (1) | scaffold: `createGame` | MISSING_FUNCTIONALITY |

**Why most fail in a Given**: a Given that gives a game a session, or plays a game in Node, needs the very code DELIVER builds, so the run stops at the first scaffold. That is the right reason: nothing past it can exist yet. That the steps after the scaffold are right is shown by the throwaway build: all of them passed against it, and 29 broken variants of it were each caught by the scenario that names the rule ([test-the-tests.md](test-the-tests.md)).

**Five fail on data rather than a scaffold**: the recorded-games corpus is made in E5 (`node scripts/record-corpus.mjs`), so until then the scenarios that read it fail loudly, naming the command.
