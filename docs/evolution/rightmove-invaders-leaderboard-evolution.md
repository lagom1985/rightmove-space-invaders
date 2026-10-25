# Evolution: rightmove-invaders-leaderboard

**Feature**: a shared high-score table for *Make the Right Move* · **Delivered**: 2026-10-25 on branch `worktree-leaderboard-spike` (from `4f9d64f`, the DELIVER roadmap, to `2c53e96`), pushed to origin and not merged to `main` · **Status**: DELIVER complete. The PO's manual checks (D10) and the DEVOPS go/no-go on a deploy preview (K10–K14) are still owed before the merge · **Full record**: [feature-delta.md](../feature/rightmove-invaders-leaderboard/feature-delta.md)

## Summary

The game now has an arcade high-score table that everyone who plays shares. It is kept in Netlify Blobs behind one Netlify Function. The local best deposit in `localStorage` stays as it was.

- **Signing**: a deposit that makes the top 10 is asked for three initials: Up and Down change the letter, and Enter takes it. A deposit that misses the table, or a game that ends with no deposit, is never asked. Initials on a 16-word filter are refused in the game ("Those initials aren't allowed. Change a letter.") and by the server.
- **The outcome**: "Signing FAB…" until the table answers, then "Signed FAB, #3.", "The table filled up before FAB arrived." or "Couldn't confirm FAB's signing.". The last one covers a not-OK answer, an answer of the wrong shape, a dropped connection, and no answer within 5 s.
  - Each outcome is announced once, even when it arrives during the next game.
  - The confirmed row is marked (green on the canvas, `aria-current` in the page) until the next signing, or until the row leaves the table.
  - A signing is never retried, and Enter never waits for the server.
- **The table**: read on page load, refreshed in the background at every game start, and taken from every signing's answer.
  - Rows apply in the order the server listed them (`listedAt`), so a late copy can't roll the table back.
  - Until a table has loaded once, game over says "High-score table unavailable." and the game plays on. After that, a failed refresh keeps the last good table.
- **The Score API** (`/api/scores`, `netlify/functions/scores.mjs`):
  - one empty blob per score, written only if new. The table comes from a listing of well-formed keys. Each signing prunes at most min(5, n − 20) keys ranked 11th or lower, on a best-effort basis.
  - a restricted store port (`list`, `putIfNew`, `remove`, for well-formed keys only), so the handler can touch nothing else
  - only the published production deploy writes the production table. Previews and older production deploys get stores of their own.
  - JSON errors (415, 413, 400, 405, 503, 500), a successful GET cached for 15 s at the CDN, and a rate limit of 10 requests a minute per IP
  - one log line per request with a fixed reason: never the initials, a key or an error message
- **Local and release tooling**: `npm start` and every test run the real function and the real Blobs client on the vendor's emulator, with one table per `test-board` cookie. The emulator's directory is deleted on exit. `scripts/smoke-leaderboard.mjs` is the DEVOPS preview smoke test, behind a write guard. It is written and unit-tested, but it has not run on Netlify yet.

The work was 12 roadmap steps across 8 milestones, all on 2026-10-25. 326 tests are green: 72 unit, 56 in-memory, and 66 each in Chromium, Firefox and WebKit. The leaderboard's share is its 44 scenarios (64 runs), its walking skeleton in three browsers and 49 unit tests. The build gate (`npm run build`, the unit and in-memory projects) passes 128. The hard KPIs K10–K14 are measurements on Netlify and haven't run yet. The local twins of K11, K12 and K14 are green in every build.

## Business context

**There was no DISCUSS wave.** The brief came straight from the user on 2026-10-24: "save the score in Netlify Blobs; when a player finishes, ask for their name, then show the list like every arcade". Decided with the user before DESIGN: 3 arcade initials, a top 10 shared by everyone, initials asked only for a qualifying deposit, and the local best kept ([SPIKE wave decisions](../feature/rightmove-invaders-leaderboard/spike/wave-decisions.md)).

No persona, job, journey step or story was written for the table. The product SSOT's `casual-arcade-player` persona and `play-a-session` journey are unchanged. In their place:
- **The SPIKE** answered the one risky question first: can a Netlify Function keep a top 10 in Blobs without losing a score when 20 players submit at once? Yes, with one blob key per score: 0 lost across 50 rounds of 20, and none lost at 50 or 100 players. The obvious single `top10` blob lost scores in every round ([findings](../feature/rightmove-invaders-leaderboard/spike/findings.md)).
- **The acceptance criteria** come from DESIGN's rules operations, signing lifecycle and table status. Each scenario carries outcome and decision ids (`@OUT-n @DDD-n`) in place of story ids.
- **The definition of done** is DISTILL's "Done when" list plus DESIGN's constraints ([DoD check](../feature/rightmove-invaders-leaderboard/feature-delta.md#wave-deliver--ref-dod-check)).

## Key decisions

| Decision | Why | Record |
|---|---|---|
| 3 arcade initials, one top 10 for everyone, only a qualifying deposit is asked, the local best stays | What players expect from an arcade | SPIKE (user) |
| A Netlify Function over Netlify Blobs, one empty blob key per score, the table from a strong listing of well-formed keys, best-effort pruning of exactly k = min(5, n − 20) (DDD-1) | No signature is lost under concurrency, by construction and with no coordination; a single blob lost scores in every round | [ADR-004](../product/architecture/adr-004-high-score-table-function-over-blobs.md) |
| The store is chosen by deploy context: the site store only when `context === 'production'` and `published === true` (DDD-2, amended in DEVOPS) | Previews and older production deploys never write the real table, and a rollback makes the newly published deploy the writer | [ADR-005](../product/architecture/adr-005-table-store-by-deploy-context.md) |
| One pure module of rules shared by the browser and the function, `src/game/high-scores.js` (DDD-3) | One validity rule on both sides of the wire | [ADR-006](../product/architecture/adr-006-shared-high-score-rules.md) |
| A restricted table-store port built by the composition roots; GET gets `list` alone (DDD-4) | The handler can't touch anything but score keys | DESIGN |
| 415, 413 and 400 checks, a word filter, 10 requests per 60 s per IP and domain, a successful GET cached for 15 s; forged scores accepted; no fallback switch (DDD-5, DDD-6) | Proportionate for a public fan game on the legacy Free plan, which bills every request | [ADR-007](../product/architecture/adr-007-proportionate-abuse-controls.md) |
| The table is probed, never awaited. A signing is pending, then confirmed, off-table or unconfirmed, and is kept across games. Rows apply in `listedAt` order. The table is unavailable only while none has ever loaded (DDD-7…12) | The game never waits on the network and never claims more than it knows | [ADR-008](../product/architecture/adr-008-table-probed-never-awaited.md) |
| Structured logs with fixed reasons, and a catch-all so that nothing escapes the handler (DDD-17) | Enough to diagnose, with nothing about the player | DESIGN, DEVOPS |
| Legacy Free; atomic deploys with instant rollback; a zero-code kill switch; a daily usage check; hard KPIs K10–K14 on a preview before the merge | One owner and no on-call. At 100% of the quota, Netlify pauses every site on the account | [DEVOPS](../feature/rightmove-invaders-leaderboard/feature-delta.md#wave-devops--ref-wave-decisions-summary) |
| A failed refresh keeps the last good table (user, DESIGN) | Once a table has loaded, one failed refresh neither hides it nor stops a player who makes it from signing | [ADR-008](../product/architecture/adr-008-table-probed-never-awaited.md) |
| The 16-word filter: ASS, COK, CUM, DIK, FAG, FCK, FUC, FUK, KKK, NAZ, NGR, NIG, PIS, SEX, SHT, TIT (user, DELIVER) | Short and public (it ships to the browser), and reviewed by the owner | Step 02-02 |
| **DELIVER amendments**: the client rejects an OK answer of the wrong shape (review M1); refused methods come first (m2); `src/view/messages.js` holds the wording both views show | Review findings and the refactor | [Changed assumptions](../feature/rightmove-invaders-leaderboard/feature-delta.md#wave-deliver--ref-changed-assumptions) |

## Work completed

| Milestone | Step | Commit | What landed |
|---|---|---|---|
| 1 Reading the table | 01-01 | `1d3b70d` | The change that can't be split: `handleScores(request, port, options)` behind `createTablePort`, with the Netlify entry and `scripts/serve.mjs` building the port in the same commit. `chooseStore` (the 12 ADR-005 cases), `config` (the path and the rate limit), the DDD-6 headers and the `scores.read` log line |
| | 01-02 | `fc6a183` | Ranked reads and ignored strays (both passed as soon as they were enabled); the catch-all; log-leak properties over every console method; the import-scan layering test. `scripts/serve.mjs` logs a fixed reason and deletes its emulator directory on exit, SIGINT and SIGTERM, even when `npm start` delivers the signal twice. Playwright now stops the web server with SIGTERM |
| 2 Signing the table | 02-01 | `8952f9b` | `isValidSignature` (shape only); 415, the 1,024-byte read cap (413, with `Content-Length` never trusted) and 400; the accept and refuse outlines |
| | 02-02 | `f91dc92` | The 16-word filter (`isAllowedInitials`) and 400 `initials-not-allowed`; 405 with `Allow`; 503 `not-saved` for an existing key; 500 for `put-failed`, `list-failed` and a refused key |
| 3 No signature lost | 03-01 | `2d3c6e8` | `planPrune` (k = min(5, n − 20)) replaces the skeleton's fixed delete-5. Removal is best effort (`prune-failed`), but a port refusal stays a 500 |
| | 03-02 | `6f5be2d`, fix `2674324` | The OUT-9 property, K11's local twin (it passed as soon as it was enabled); `scripts/smoke-leaderboard.mjs` with its four modes and the write guard as the pure `decidePost`; `.netlify/` ignored. The fix cycle came after 04-01: a branch-name generator could build the punycode label `xn--<site>`, which the URL parser rejects |
| 4 Who is asked | 04-01 | `2a13edd` | `makesTheTable`; the table state `{ status, rows }` and the `listedAt` rule in `game.js`; `snapshot()`; the page-load wiring in `main.js`; the `data-hud="initials"` field |
| 5 Signing outcomes | 05-01 | `3760fa4` | The signing lifecycle (`signingAnswered`, `signingFailed` and the settled notice); the 5000 ms timeout through `AbortController` on injected timers; each outcome announced once, and `aria-current`; the canvas signing line. The last `__SCAFFOLD__` left `src` |
| | 05-02 | `14fece5` | The initials field and its cadence (one update per change); the word-filter refusal in the game |
| 6 The game plays without the table | 06-01 | `e478b5d` | A background refresh on every `gameStarted`; "High-score table unavailable." at game over, and nothing while the table is unknown |
| 7 Late answers | 07-01 | `2f0e529` | All five scenarios passed as soon as they were enabled; a unit property that answers reach a paused game at once (DDD-11) |
| 8 Rules in any order | 08-01 | `b0da992` | The two rules examples and the model-based property, all green as soon as they were enabled; the `table` fixture carries the tripled timeout; README and `CLAUDE.md` name the table |

After the steps came:
- the L1–L6 refactor, with three test hardenings: `0d436be`.
  - It extracted `src/view/messages.js` (accepted by the orchestrator) and shared one emulator lifecycle across the Score API unit files.
  - It gave the game's original walking skeleton `@timeout:90000`, and weighted Tier B's commands so that every witness state is reached for any seed.
  - No assertion changed.
- the review revision: `78e0a0f` (see Issues encountered)
- the word-filter generator fix: `2c53e96`

A DES execution-log commit follows each step's commit. The roadmap is `4f9d64f`. The earlier waves are SPIKE `2e108db`, DESIGN `ed0eddb`, DEVOPS `e7e9f49` and DISTILL `dec465a`. The DES integrity check passed: all 12 steps have complete RED, GREEN and COMMIT traces, plus the one 03-02 fix cycle.

## Lessons learned

1. **A generator must respect every rule upstream of the one under test.** All three build-gate flakes were generators drawing inputs that the code rightly refuses, not bugs in the code.
   - A branch named `xn` built a punycode host that the URL parser rejects (about 1 run in 300).
   - Signings that were expected to be saved drew initials from the word filter (about 0.7% of runs in `scores-log-leak`, about 2% in `scores-handler`).

   Each was fixed in its generator, using the production rule (`isAllowedInitials`, no `xn` label), and no assertion was weakened. DISTILL had planned for timing flakes in the build gate; the real ones were in the inputs, and only rotating the seed finds them before Netlify's build does.
2. **Proving upstream that a test can fail paid off.** DISTILL caught 17 broken handler variants and 6 broken rules variants with throwaway implementations before the handoff. So when M1's ranking and strays, the OUT-9 property, all five M7 scenarios and all three M8 checks passed as soon as they were enabled, they were already known to be able to fail. DELIVER needed no planned break-it checks (compare the sound feature's first lesson).
3. **An OK answer isn't always a valid answer.** A 200 with a malformed body reached the rules and froze the game (review M1). The client now checks the shape it promises, and treats anything else as a failure. This is the sound feature's "adapters must fail closed" again, this time at the network edge.
4. **Confirm a vendor's fact in its reference, and guard what the reference leaves out.** `published_deploy.id` is confirmed in Netlify's OpenAPI `getSite`. The id's format isn't documented, so the write guard accepts only 24 hex digits and refuses anything else (review M2).
5. **A signal can arrive twice.** `npm start` relays a group signal, so `scripts/serve.mjs` received SIGINT twice and exited before its cleanup ran. It now keeps listening while it stops. Only a test that checks the directory is gone, through `npm start` itself, could show this.
6. **Put a test budget where every slow scenario passes.** The tripled timeout sat on the `game` fixture, which the leaderboard's walking skeleton doesn't use, so the skeleton timed out in WebKit under load. The budget moved to the `table` fixture, which both use, and the game's original skeleton got its own `@timeout:90000`.
7. **A witness state that only some seeds reach is a coverage hole.** Tier B reached "a replaced signing settled" only for some seeds. A weighted command that plays another signed game now reaches it for any seed (FC_SEED 1–500 checked).
8. **Stop processes by what you started, not by name.** A crafter's `pkill -f serve.mjs` may have stopped another checkout's local server. `PORT` keeps side-by-side suites apart only while nothing kills processes by pattern.
9. **The roadmap's splits held.** Milestones 2 and 5, flagged for a sizing review, became two steps each. The 01-01 change that couldn't be split (the handler's new signature together with both roots) kept the walking skeleton green throughout.

## Issues encountered

- **Adversarial review: approved with changes** (0 blockers, 2 majors, 7 minors). Fixed in `78e0a0f`:
  - M1: a 200 with a malformed body froze the game. The client now rejects it, and the signing settles as unconfirmed (`malformed-answers.spec.js`).
  - M2: Netlify's `published_deploy.id` was confirmed against the OpenAPI `getSite`, a fixture test pins it, and the guard fails closed on any other shape.
  - m2: the Netlify entry refuses methods other than GET and POST before it opens a store.
  - m3: `scripts/serve.mjs` answers at its edges: 400 for a path that doesn't decode, 405 for TRACE and CONNECT, and the body streamed to the handler, whose 1 KB cap is the read limit.
  - m4: `snapshot()` is documented as the rules' read model for tests.
  - m6: the DDD-18 unit pair: a duplicate key forced by the clock and the id source, and `listedAt` read after the listing.
  - m7: `PLAY_AGAIN_SENTENCE` lives in `messages.js`.
- **Accepted residuals**:
  - m1: the rules keep one settled slot, so if two outcomes settle within one frame, one announcement can be lost.
  - m5: the unused state-delta predicates stay, as the predicate library.
- **Roadmap review**: conditionally approved (0 blockers, 1 high, 7 low). The orchestrator applied the fixes before step 01-01.
- **Three flaky generators in the build gate** (lesson 1): `2674324` and `2c53e96`.
- **The double signal to `scripts/serve.mjs`** under `npm start` (lesson 5): the emulator's temp directory was never deleted. Fixed in 01-02.
- **Walking-skeleton timeouts in WebKit under load** (lesson 6): `b0da992` and `0d436be`.
- **Tier B witness coverage depended on the seed** (lesson 7): `0d436be`.
- **Interruptions**: API rate limits and a permission-classifier outage stopped agents mid-step. They resumed.
- **`pkill -f serve.mjs`** (lesson 8): it may have stopped another checkout's local server.
- **Mutation testing**: disabled under the project's strategy (`CLAUDE.md`).
- **Not verified by DELIVER**: anything on Netlify (latency, real Blobs under concurrency, the rate limit, the CDN cache, the deploy context and the bundle), and the canvas (manual, D10).

## Still owed before the merge to `main`

- **The PO's manual checks (D10)**: the compact game-over layout; the signing, refusal and unavailable lines; the green confirmed row; the title's attract table.
- **The DEVOPS go/no-go** (the commands are in the feature-delta's [DELIVER pre-requisites](../feature/rightmove-invaders-leaderboard/feature-delta.md#wave-deliver--ref-pre-requisites)):
  - the preview smoke run, K10–K14. It needs a pull request and its deploy preview, plus a throwaway preview without the rate limit for the K11 burst run.
  - the account's Blobs limits, checked and recorded
  - the list of live function hostnames, starting with the smoke-test previews, and with a branch deploy of `worktree-leaderboard-spike` if the push made one
  - the kill switch, armed on the merge day before the merge is pushed
  - the user's decision on moving the game to a Netlify team of its own
- **Optional cleanup**: the old `make-the-right-move-blobs-*` directories in the OS temp folder, left by local servers before 01-02.

## Links

- Delivery record: [feature-delta.md](../feature/rightmove-invaders-leaderboard/feature-delta.md) (SPIKE pointers, DESIGN through DELIVER), [SPIKE findings](../feature/rightmove-invaders-leaderboard/spike/findings.md), [SPIKE wave decisions](../feature/rightmove-invaders-leaderboard/spike/wave-decisions.md), [DEVOPS upstream changes](../feature/rightmove-invaders-leaderboard/devops/upstream-changes.md), [environments.yaml](../feature/rightmove-invaders-leaderboard/environments.yaml), [RED classification](../feature/rightmove-invaders-leaderboard/distill/red-classification.md), [roadmap](../feature/rightmove-invaders-leaderboard/deliver/roadmap.json), [execution log](../feature/rightmove-invaders-leaderboard/deliver/execution-log.json)
- Architecture SSOT: [brief](../product/architecture/brief.md), [ADR-004](../product/architecture/adr-004-high-score-table-function-over-blobs.md), [ADR-005](../product/architecture/adr-005-table-store-by-deploy-context.md), [ADR-006](../product/architecture/adr-006-shared-high-score-rules.md), [ADR-007](../product/architecture/adr-007-proportionate-abuse-controls.md), [ADR-008](../product/architecture/adr-008-table-probed-never-awaited.md)
- Product SSOT: [outcomes registry](../product/outcomes/registry.yaml) (OUT-7 to OUT-14), [KPI contracts](../product/kpi-contracts.yaml) (K10 to K15, with the measured local baselines)
- Test policy: [ATDD infrastructure policy](../architecture/atdd-infrastructure-policy.md), with this feature's rows: the table service and the rules on their own (driving); the high-score table (driven, real); the network faults through `page.route`, the server clock, ids and logger, and the store failures (fakes); and the deviations from the mandates
- Code and tests: [acceptance suite](../../tests/e2e/rightmove-invaders-leaderboard/acceptance/), [unit specs](../../tests/unit/), [Score API](../../netlify/functions/scores.mjs), [shared rules](../../src/game/high-scores.js), [smoke test](../../scripts/smoke-leaderboard.mjs)
- **Nothing was migrated** to other permanent directories. The feature has no `design/` or `discuss/` folder, so no file matches the finalize destination map: the ADRs and the architecture already live in `docs/product/architecture/`, and the walking skeleton is a `.feature` file under `tests/`. The delivery history stays in `docs/feature/rightmove-invaders-leaderboard/`.
