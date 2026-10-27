# Evolution: rightmove-invaders-replay-verified-scores

**Feature**: replay-verified scores for the shared high-score table of *Make the Right Move* · **Delivered**: 2026-10-27 on branch `rightmove-invaders-replay-verified-scores` (from `eeec237`, the DELIVER roadmap, to `9977b14`) · **Status**: slices 01 and 02 released on 2026-10-27, by PR #8 (merge `8305208`) and PR #9 (merge `babe1db`), each after its preview gate, and checked in production the same day. Slice 03 is complete on the branch and not pushed: its pull request and preview run (`--slice 03`, about 20 minutes) wait for the user's OK · **Full record**: [feature-delta.md](../feature/rightmove-invaders-replay-verified-scores/feature-delta.md)

## Summary

The shared table no longer trusts the deposit a browser claims. Each game asks the table's server for a **session** as it starts, records the controls held at each simulation step, and signs with its session and that **record**. The function **replays** the game and saves the deposit the replay reaches. A deposit typed into a `curl`, or changed on its way from the page, never reaches the table.

| Slice | What a forger meets | Released |
|---|---|---|
| 01 A session for every game | No signing without a session the table sealed; one row per game; sessions last 2 hours | PR #8, `8305208` |
| 02 The table replays the game | A deposit the game didn't reach, a record that isn't one or runs past an hour, a claim over £500,000: refused | PR #9, `babe1db` |
| 03 No faster than the clock | A game signed sooner than it lasted after its session, less 10 s: `too-fast`; a record of other rules: `rules-changed`, unplayed | Not pushed |

- **Sessions**: `POST /api/sessions` takes exactly `{ seed }`, the game's own 128 bits, and answers with an HMAC-signed session and the table, which replaces the refresh at every game start. The secret is `SCORES_SESSION_SECRET`, one value for production and another for previews. A row's id is now its game id, so a game has one row. The table client's `sign` waits for its game's session and fails unsent if it fails.
- **The same game everywhere**: every gameplay draw comes from the game's seed (`chance.js`, sfc32), the particles live apart, and erosion compares squared distances. `createGame` makes one game per instance, and the page exposes none to the console. Six recorded games, 1.5 to 15.4 minutes, replay to their deposits in Node, Chromium, Firefox and WebKit, in every build.
- **The record**: compact text, about 2 characters a change, read strictly, so a game has one encoding. The signing's cap is 128 KB, enough for 60 minutes at human pace.
- **Nothing new for players**: every refused signing ends "Couldn't confirm ALX's signing.", as before. The reason goes to the function's log, which carries fixed reasons only, plus `steps` and `replayMs` where a replay ran. The release note tells players to reload a page left open across an update.
- **What still gets through** (D16, ADR-012): a program that plays well, in real time or by searching offline. It is still held to the rules, to its game's length in real time, to one row per game, to the session's 2 hours, to the rate limit and to £500,000.
- **How**: new pure modules `game/chance.js`, `particles.js`, `record.js` and `replay.js`, and `netlify/scores/sessions.mjs`. Layering rule 5 was amended, and rules 8 and 9 (the determinism scan) are new. No new dependency.

The work was 25 roadmap steps in 3 slices, all on 2026-10-27, with two releases mid-DELIVER, then a refactor and one review revision. 780 tests are green: 163 unit, 206 in-memory, and 137 each in Chromium, Firefox and WebKit. The feature's share is its 40 scenarios (63 in-memory runs and 14 per engine) and 67 new unit tests. The build gate (`npm run build`) passes 369 in about 20 s.

## Business context

**The trigger was an incident.** On 2026-10-26 a player put deposits of about £9,999,950 on the production table, with a `curl` and from the browser console. The owner deleted the 3 forged rows (S0), and the [RCA](../analysis/root-cause-analysis-forged-high-scores.md) traced them to ADR-007's accepted risk: the table saved any well-formed claim. There was no DISCOVER or DIVERGE. DISCUSS wrote 6 stories in 3 slices for `casual-arcade-player`, with a new job, J-TABLE-TRUST ("every row was really played"), and J-TABLE-SIGN kept intact. A probe on a patched copy of the rules showed that a seeded game replays identically in Node and three engines, at about 50 ms for 10 minutes on a laptop.

DESIGN chose server replay (ADR-012, superseding ADR-007's risk) and deterministic rules with one game per instance (ADR-013). DEVOPS set one secret per deploy context, measured that both paths share one rate-limit counter, and specified the smoke steps S1–S13 and a gate per slice. DISTILL wrote 40 scenarios (77 runs) and tested them against a throwaway slice-03 build with 29 broken variants. The KPIs are K20–K25: forgeries refused, honest games replayed, a long game verified in time, honest players never refused unexplained, no forged row, sessions back quickly.

## Key decisions

| Decision | Why | Record |
|---|---|---|
| The function replays each game and saves the deposit it reaches; a different claim is `replay-mismatch` (D1) | The only real proof, and the rules already ran without browser APIs | [ADR-012](../product/architecture/adr-012-the-table-replays-every-game.md) (user) |
| The game picks its seed; a session, an HMAC over seed and issue time, is asked for as it starts (D2, D3, DDD-R1, R2) | No store footprint; the frame never waits; one request per game start, as before | ADR-012 (user) |
| One row per game: the row id is the game id, the key format unchanged (D7, DDD-R4) | No second key family; the rows already on the table stay | ADR-004 as amended |
| Deterministic rules, one game per instance, the determinism scan (DDD-R6, R7, R13) | The function needs a fresh game per check, the same in every engine | [ADR-013](../product/architecture/adr-013-deterministic-rules-one-game-per-instance.md) |
| The record as compact text, its reader strict (DDD-R5, clarified in DELIVER) | About 2 characters a change; one encoding per game | ADR-013 |
| No game faster than the clock, compared in integers, 10 s allowance; a lenient clock for local test boards only (D8, DDD-R11, E6) | A game computed offline costs its own length in real time | ADR-012 |
| The ceiling rises to £500,000, checked on the claim before any replay (D14, DDD-R16) | A 60-minute game can pass £250,000; a refusal costs no replay | DESIGN (user) |
| **D21 re-baselined** after slice 02's preview missed it: K10's p95 under 1,750 ms, the 10-minute replay's under 650 ms, K22 recorded, not gated | Netlify runs the replay 7 to 10 times slower than the probe's laptop; a game near 60 minutes may end saved but unconfirmed, accepted | D21 (user, 2026-10-27) |
| Released slice by slice, each behind its preview gate; rollback never a remedy for a fault in the defence | Each slice closes holes; rolling back reopens them | DEVOPS |
| Accepted residual risk: a program that plays well (D16) | Ruling it out needs anti-bot measures far beyond this project | ADR-012 (user) |
| **DELIVER amendments**: 25 steps; narrow test edits outside a step's files, authorised by the orchestrator; stand-ins for older slices' deploys; the smoke test's runs need `--slice` | The roadmap review and the adversarial review | [Changed assumptions](../feature/rightmove-invaders-replay-verified-scores/feature-delta.md#wave-deliver--ref-changed-assumptions) |

## Work completed

| Slice | Steps | Commits | What landed |
|---|---|---|---|
| 01 A session for every game | 01-01 to 01-11 | `94017ff`..`8b8c7e4` | The signer and the token rule; the walking skeleton with flip 1 (no signing without a session) and the local server's secret and test route; the session request; the seed; the seal; one row per game; the 2 hours; the browser's session and its wait; smoke steps S1–S6b; the allow-list, `.env*` and the owner's secret guide (33 runs) |
| — | Release | `8305208` | PR #8, after its gate on deploy-preview-8: all pass (K25 p95 523 ms, K10 p95 792 ms, one counter for both paths). P1, P2 and the owner's game in production |
| 02 The table replays the game | 02-01 to 02-09 | `4caf647`..`66e8125` | E2 seeded chance; E3 one game per instance; K24's baseline (`13921dd`); E4 the record and the replay; E5 six recorded games; flip 2, the replay on every signing with £500,000; records that end elsewhere, malformed ones, long ones; smoke steps S7–S10 (29 runs) |
| — | Release | `babe1db` | PR #9, after D21's re-baseline (`dc1983e`, here `06b8ca5`) and the burst run on a throwaway preview (K11: 0 lost). P1, P2 and the owner's game, which replayed 5,299 steps in production |
| 03 No faster than the clock | 03-01 to 03-05 | `ffb6865`..`6bcbd9b` | E6 and the clock check; honest games never too fast; `rules-changed`; smoke steps S11–S13; the close-out (8 runs) |
| — | Refactor, review | `02a4428`, `9977b14` | L1–L6: one handler shape, one way to sign in the smoke test. The revision R1–R6: worked examples of the winner rule, the table client tested on its own contract, `newSeed` required at once, a comment, the entry's 10 s pinned, `--slice` required |

The 25 steps ran from 09:51 to 18:18 UTC (the execution log), and the whole of DELIVER, from the roadmap (09:44) to the revision (19:37), in about 10 hours. Each step logged RED, GREEN and COMMIT; the 78 events include 02-05's blocked first GREEN, 02-07's failed first GREEN, and 03-05's RED skipped as docs only. The DES integrity check passed: all 25 steps have complete DES traces. The execution log was left untracked through the steps, for the finalize commit.

## Lessons learned

1. **Measure a CPU-bound step on the target platform before setting its budget.** D21's first budget missed on slice 02's preview. Five whys:
   - *Why did it miss?* The replay is CPU-bound, and Netlify ran it at about 5 µs a step, 7 to 10 times slower than the probe's M4 Pro (about 0.7 µs).
   - *Why wasn't that known?* DISCUSS and DESIGN extrapolated from a laptop. DEVOPS listed Netlify's CPU as unmeasured, and its headroom argument was about the 60 s limit, not the p95.
   - *Why did it reach a merge gate?* The first real measurement was planned for slice 02's preview, by when the replay was built and slice 01 was live.
   - *Why so late?* The one Netlify probe (`config.path`) measured routing; the replay's probe ran only locally.
   - *Root cause, and what to repeat*: a budget set on one machine's CPU for a step that runs on another's. When a step is CPU-bound and the platform's CPU is unmeasured, time it there in a SPIKE, on a throwaway preview as DEVOPS did for `config.path`, before setting the budget. Time a fresh instance apart: production's first replay ran at about 53 µs a step.
2. **Release slice by slice, each behind its preview gate.** Two releases landed mid-DELIVER, each checked in production the same day. The D21 miss held one pull request, not the feature: slice 01's defence was already live, and slice 03 was built while the user decided.
3. **Ask, don't improvise, when a step needs a file outside its list.** 02-05's crafter stopped (`BLOCKED_BY_DEPENDENCY`) rather than edit two specs. The orchestrator authorised narrow edits, and the review checked them with `git show` (no assertion removed). Seven steps widened their files this way, each recorded.
4. **Keep an older slice's smoke tests honest with a stand-in of its deploy.** Once the function moved on to slice 03, the slice-01 and slice-02 runs' unit tests ran against stand-ins (the real signer; the real dispatch with an `Infinity` allowance), so each slice's run stayed testable against the deploy it was written for.
5. **Fix an open pull request in a worktree of its own.** PR #8 and PR #9 stayed open while the feature branch carried the next slice. Their fixes went in separate worktrees and were cherry-picked back: the D21 re-baseline is `dc1983e` on PR #9 and `06b8ca5` here.
6. **Seal a test secret exactly as the roots do.** 01-01's crafter found that sealing with the secret's base64 text, not its decoded 32 bytes, would let S4's "a 200 fails the run" probe pass on a deploy whose secret is the public value. The harnesses and the smoke script now decode it first.
7. **Check a guard's expectation against its driver's timing.** DISTILL expected M8's real-time outline to fail with a zero allowance, but its driver signs about 7 s after the game's length; M3's "at once" row catches a held start only with timing on its side. Both guards still bite what they were written for (a browser's clock; a held start, through the other rows).
8. **An order between checks needs a test of the order.** Moving `rules-changed` after the reader passed M9 but failed the unit property (03-03). The order lives in the unit test.

## Issues encountered

- **D21's first budget missed** on deploy-preview-9 (lesson 1): K10's p95 1,459 ms against 1,250, the replay's 523 ms against 165, K22's game 1,299 ms (about 5 s scaled, against 1 s). The run exited 1 on S8. The user re-baselined D21, and PR #9 waited; the same figures pass the revised budget, so S8 was not re-run.
- **K11 needs a preview without the rate limit**: the burst ran on a throwaway, draft PR #10, closed and its branch deleted. Its deploy stays callable, without a limit, until the owner deletes it.
- **Adversarial review: NEEDS_REVISION** (1 blocker, 3 high, 5 medium, 8 low), with no blocker in production code. B1 (no contract-shape declarations) went to DISTILL as an upstream issue. One revision pass, `9977b14` (R1–R6); M2 was accepted in writing; M3, M4 and L5 became the rows clarified in DELIVER; H2 and H3 were answered with evidence in the record.
- **Roadmap review**: conditionally approved (0 blockers, 1 high, 9 low), the conditions applied.
- **02-05 blocked** on two specs outside its files (lesson 3), and 02-07's first GREEN failed until the strict reader's three rules held.
- **03-02's guards-bite criterion** wasn't met as written (lesson 7).
- **The Retirement list** missed `score-keys.spec.js` at flip 2, and listed it at flip 1.
- **Mutation testing**: disabled under the project's strategy (`CLAUDE.md`), and skipped.
- **Not verified by DELIVER**: slice 03 on a preview; K22 after slice 03; Safari on a real Mac; the unpublished check (U1–U3).

## Still open

- **Slice 03's release, with the user's OK** (the feature delta's [Pre-requisites](../feature/rightmove-invaders-replay-verified-scores/feature-delta.md#wave-deliver--ref-pre-requisites)):
  1. Push the branch and open slice 03's pull request: 8 commits ahead of `main`, plus the record, and it merges cleanly.
  2. Run `--slice 03` on its preview: S11–S13, about 20 minutes. The owner reads S13's `replayMs` for D21's 650 ms.
  3. DoD 8 on that preview, Safari on a real Mac included, and the PO's check.
  4. Merge, then P1–P3 and the owner's game the same day. K23's 30 days run from this release.
- **The owner**:
  - publish the release note, which covers all three releases;
  - delete `deploy-preview-6`'s deploy, and `deploy-preview-10`'s, which has no rate limit;
  - close PR #5, whose docs landed with PR #8;
  - run the unpublished check (U1–U3) once;
  - K23's daily and K24's weekly readings, for 30 days;
  - K22's re-run after slice 03, which has no smoke entry point yet: S7 doesn't wait its game's length.
- **For DISTILL**: `@contract-shape` tags on this feature's scenarios; S13's row to name `clock-check.spec.js`; M8's guard row; review L6's step for M3's "at once" row; `red-classification.md`'s stale reason for M2.
- **Follow-up**: `tests/unit/malformed-answers.spec.js` still drives a copy of `main.js`'s hand-over (review M1).

## Links

- Delivery record: [feature-delta.md](../feature/rightmove-invaders-replay-verified-scores/feature-delta.md) (DISCUSS through DELIVER), the [slice briefs](../feature/rightmove-invaders-replay-verified-scores/slices/), [probe findings](../feature/rightmove-invaders-replay-verified-scores/probe/findings.md), [test the tests](../feature/rightmove-invaders-replay-verified-scores/distill/test-the-tests.md), [RED classification](../feature/rightmove-invaders-replay-verified-scores/distill/red-classification.md), [roadmap](../feature/rightmove-invaders-replay-verified-scores/deliver/roadmap.json), [execution log](../feature/rightmove-invaders-replay-verified-scores/deliver/execution-log.json), [release note](../feature/rightmove-invaders-replay-verified-scores/release-note.md), [environments](../feature/rightmove-invaders-replay-verified-scores/environments.yaml)
- Architecture SSOT: [brief](../product/architecture/brief.md), [ADR-012](../product/architecture/adr-012-the-table-replays-every-game.md), [ADR-013](../product/architecture/adr-013-deterministic-rules-one-game-per-instance.md), and ADR-004 to ADR-008 as amended; the trigger: the [RCA](../analysis/root-cause-analysis-forged-high-scores.md)
- Product SSOT: [jobs](../product/jobs.yaml) (J-TABLE-TRUST), [persona](../product/personas/casual-arcade-player.yaml), [journey](../product/journeys/play-a-session.yaml), [KPI contracts](../product/kpi-contracts.yaml) (K20–K25, and K10–K14 re-run), [outcomes registry](../product/outcomes/registry.yaml) (OUT-20 to OUT-23)
- Test policy: [ATDD infrastructure policy](../architecture/atdd-infrastructure-policy.md)
- Code and tests: [acceptance suite](../../tests/e2e/rightmove-invaders-replay-verified-scores/acceptance/), [Score API](../../netlify/functions/scores.mjs), [session signer](../../netlify/scores/sessions.mjs), [record](../../src/game/record.js), [replay](../../src/game/replay.js), [recorded games](../../tests/fixtures/recorded-games/), [smoke test](../../scripts/smoke-leaderboard.mjs)
- **Nothing was migrated** to other permanent directories. The feature has no `design/` or `discuss/` folder; its `distill/` holds `test-the-tests.md` and `red-classification.md`, which the finalize destination map doesn't cover. ADR-012, ADR-013 and the architecture already live in `docs/product/architecture/`, and the walking skeleton is a `.feature` file under `tests/`. The delivery history stays in `docs/feature/rightmove-invaders-replay-verified-scores/`.
