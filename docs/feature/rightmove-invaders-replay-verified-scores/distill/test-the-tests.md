# Test the tests: rightmove-invaders-replay-verified-scores (DISTILL, 2026-10-26, revised 2026-10-27)

Since the review, milestone 6's recorded games in Node are signed through the table rather than replayed directly, and the race property checks that the signing sent ahead is the row shown. Both were run again against the throwaway build: every scenario of this feature passed.

DISTILL wrote a throwaway build of DESIGN's slice 03 in its scratchpad, never committed:
- seeded chance, `createGame` with the recorder, `record.js` and `replay.js`;
- the session signer and the Signing checks table;
- one row per game;
- `/api/sessions`, `POST /__test/rows` and the lenient clock in `scripts/serve.mjs`;
- `startSession` and the wiring in `main.js`.

Every scenario of this feature passed against it, except the console-line one, which it was built to fail (it kept the game in play exported). Then each variant below was made, one at a time, and the scenarios were run again. **Each variant was caught by the scenario named.**

**For DELIVER**: apply each variant to the real code, one at a time, once the code it touches exists. The scenario named must fail; undo the change. A variant no scenario catches is a gap to report, not to accept.

## The Score API (`netlify/functions/scores.mjs`), project in-memory

| # | Variant | Caught by |
|---|---|---|
| S1 | A signing with no session isn't refused (check 6 removed) | The walking skeleton |
| S2 | Any session verifies (check 9 removed) | M2 "A session the table didn't seal" ×6 |
| S3 | Sessions never expire (check 10 removed) | M2 "A session lasts 2 hours", 2 h 1 min |
| S4 | A session from the future is accepted (C8 removed) | M2 "A session lasts 2 hours", 11 seconds before |
| S5 | A game signs twice: the listing's other keys of the game are ignored | M2 "A game has one row" ×2; "A game saved just before the table couldn't be looked at" |
| S6 | The ranking ignores games: every key is a row | M2 "A game has one row" ×2 (the reading taken while it was refused) |
| S7 | A refused signing leaves its key behind | M2 "A game has one row" ×2 |
| S8 | The replayed deposit isn't compared with the claim | M4 "A deposit the game didn't play to" ×3, the ceiling at £500,000 |
| S9 | Game over at the record's last step isn't required | M4 "A record that stops a step before / goes on a step after" |
| S10 | The rules version isn't checked (check 12 removed) | M9 |
| S11 | No hour limit (check 13 removed) | M7 "60 minutes and one step" |
| S12 | No clock check (check 14 removed) | M8 "A 20-minute game signed a minute after", the 11-second margin |
| S13 | An allowance of 11 s instead of 10 | M8 the 11-second margin |
| S14 | The ceiling checked after the replay | M4 the ceiling, £500,050 (it must never be replayed) |
| S15 | The seed in the log line | M4 "A deposit the game didn't play to" (and every log check since the review) |
| S16 | No `steps` or `replayMs` on a line that replayed | M4, M7 (11 scenarios) |
| S17 | A session answered without the table's rows | M1 "A game that starts gets its session and the table" |
| S18 | A session issued though the table couldn't be looked at | M1 "When the table can't be looked at" |
| S19 | Any seed accepted | M1 "A request for a session with …" (capitals, one character short) |
| S20 | The signing's cap stays 1 KB | M7 the longest game, the largest human record, 128 KB |
| S21 | No secret, still signs (check 2 removed) | M1 "Without its secret, the table saves no signing" |

## The record reader (`src/game/record.js`), project in-memory

| # | Variant | Caught by |
|---|---|---|
| R1 | Two changes at one step accepted | M4 "A record whose changes come twice at the same moment" |
| R2 | The first change may come after the start | M4 "A record whose first change comes after the game's start" |
| R3 | A change at the record's last step accepted | M4 "A record whose last change comes at or after the end it gives" |
| R4 | No rules version needed | M4 "A record whose rules aren't named" |

## The browser's wiring (`src/main.js`, `src/platform/leaderboard.js`), Chromium

| # | Variant | Caught by |
|---|---|---|
| B1 | The signing is sent carrying no session (it doesn't wait for one) | M3 "Typed initials sign the table through the game's own session" and "Two house-hunters" (refused, so not confirmed), "can't be reached" (sent at all). The wait itself, for a session still on its way, is DELIVER's unit test of the table client: no browser scenario can meet it |
| B2 | Two session requests per game start | M3 "Starting a game asks the table's server once". The two trouble rows failed too, but only because the driver answers a second session request at once, which gives the game a session |
| B3 | The start is held until the session arrives | M3 "The game starts at once …" (the guards) and 6 more M3 runs |
| B4 | The signing is sent though its session failed | M3 "A game whose session request can't be reached / never answers" |

## Not caught by a scenario

| Variant | Why | Where it is caught |
|---|---|---|
| The clock check in floating point (`steps × STEP × 1000`, C2) | It refuses an honest game only at 787 particular step counts, which no scenario's game is likely to land on | DELIVER's unit test of the clock check over every step count |
| The browser's clock read by the clock check | Nothing in the signing carries the browser's time today, so there is nothing to break short of adding it | M8's real-time outline, if a time were ever added (DELIVER: show it bites after slice 03) |
| The function honouring `test-clock=lenient` | Added after the review, so not run against the throwaway (whose function ignores cookies, and passed) | M8 "even when the request asks for the local server's lenient clock" |
