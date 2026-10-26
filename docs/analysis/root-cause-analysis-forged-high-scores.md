# Root cause analysis: forged scores on the shared high-score table

**Date**: 2026-10-26 · **Method**: Toyota 5 Whys, multi-causal, evidence required (`/nw-root-why`) · **Base**: `main` at `4772b1b`

## Problem statement
A player put absurd scores on the shared high-score table (`/api/scores`, ADR-004) without earning them in the game. The table is meant to show the deposits players really saved.

## What a real score looks like
Every number below comes from `src/game/game.js` and `src/theme/theme.js`:
- A wave is 5 rows of 11 hurdles worth £300, £200, £150, £100 and £50, so clearing one is worth at most **£8,800**.
- A Dream Home adds £500, £1,000, £1,500 or £3,000. It appears at most every 12 to 28 seconds, and only while more than 6 hurdles are alive.
- £9,999,950 would therefore take more than 1,000 cleared waves. The server's ceiling, `MAX_SCORE = 9_999_999`, is the width of the key's 7-digit score field (ADR-004). It says nothing about what the game can produce.

## Reproduction (local, `npm start`, Blobs emulator)
**Vector A: a direct POST, no game played.**
```
curl -X POST localhost:4174/api/scores -H 'content-type: application/json' -d '{"initials":"HAX","score":9999950}'
-> 200 {"scores":[{"initials":"HAX","score":9999950,...}], ...}
```
Every score that is a multiple of £50 up to £9,999,950 is accepted. Only `9999999` was refused (`invalid-signature`, not a multiple of £50).

**Vector B: tampering in the browser console during a game.**
```js
const m = await import('/src/game/game.js');   // the same module instance the game is running
m.g.score = 4242400; m.g.lives = 99;
```
The HUD showed "Deposit saved £4,242,400" and "Homes left 99" at once. At game over, `makesTheTable` asks for initials, and the game's own client signs `g.score` (`game.js:248`, then `main.js:45`). The request is indistinguishable from an honest one.

## 5 Whys

### Why 1: why does the table show scores nobody earned?
Because the function stored `{ initials, score }` rows that no game produced.
- Evidence: Vector A, Vector B.

### Why 2: why did the function store them?
- **Branch A (trust)**: a signing's only evidence is the claimed score, and the function accepts any well-formed claim. `isValidSignature` checks only the shape: 3 letters, and a positive multiple of £50 up to `MAX_SCORE` (`high-scores.js:22`).
- **Branch B (bounds)**: the upper bound is the storage format's limit, not the game's. Nothing compares a score with how long it was played for, or with what a wave can be worth.
- **Branch C (detection)**: nothing flags an implausible signing. The log records `scores.signed ok` with a key count and nothing more (DDD-17), so a 7-digit score passes silently.

### Why 3: why is the claimed score the only evidence?
- **Branch A**: the score is computed only in the browser (client authority). The server never sees the game, only what the game says its result was. There is no session, no seed and no record of inputs.
- **Branch B**: no plausibility rule exists, because without a session the server has no elapsed time to compare a score against.
- **Branch C**: the only response is reactive. The owner deletes rows by hand (the moderation guide in DEVOPS), after someone notices them.

### Why 4: why can't the browser's claim be trusted?
Everything in the browser is under the player's control:
- **The endpoint is public and self-describing.** The network tab shows the POST and its two-field body, and `curl` can replay it (Branch A).
- **The live game state is reachable from the console.** `g` is an exported, mutable module-level object (`game.js:42`). ES modules are served unbundled at stable URLs, and `import()` of the same URL returns the same instance (Vector B).
- Neither is a bug. The design intends both: no bundler (CLAUDE.md), and the rules in one state object.

### Why 5: why was this left open?
Because it was a **recorded, accepted risk**. ADR-007 says: "Accepted risk: made-up scores from a script". The rate limit "protects cost and the pruning loop, not honesty", and "one forger can still fill the top 10". The trigger to revisit the ADR is forging "happening more than occasionally".

ADR-007 rejected the two real defences as disproportionate:
- **A signed game token with an elapsed-time check**: "Little real gain for this audience".
- **Server-side replay of recorded inputs**: "the only real proof, but it means running the whole game on the server. Far beyond a fan game".

The second premise is weaker than ADR-007 assumed. The rules already have the property that replay needs:
- `src/game/` uses no browser API (CLAUDE.md, the layering test).
- The simulation runs in fixed steps of 1/120 s (`config.js`, ADR-000), so the same inputs at the same step indexes give the same game.
- What stands between today's code and a deterministic replay is listed below (S3), and it is a few contained changes, not a rewrite.

## Root causes
| # | Root cause | Kind |
|---|---|---|
| RC1 | The server accepts the client's claimed score as the only evidence. There is no proof of play: no session, no seed, no inputs. | Design decision (ADR-007) |
| RC2 | The validation bounds come from the key format (£9,999,999), not from what the game can produce, and are not tied to time played. | Missing rule |
| RC3 | The live game state is an exported, mutable singleton that the console can reach with `import()`. The legitimate client then signs whatever it holds. | Contributing (it only matters while RC1 holds) |
| RC4 | Nothing detects or flags an implausible signing, so the "more than occasionally" trigger has no measurement behind it. | Missing feedback loop |

## Countermeasures
Ordered by cost. Each line names the root causes it closes.

**S0. Clean the table now** (no code). Delete the forged rows' keys from the production store, as the DEVOPS moderation guide describes (`docs/feature/rightmove-invaders-leaderboard/`). **Done** (owner, 2026-10-26).

**S1. Plausibility ceiling** (RC2 in part; hours). Add `MAX_PLAUSIBLE_SCORE` to `high-scores.js`, so both sides of the wire share it (ADR-006). The function refuses anything above it with 400 `implausible-score` and logs the reason, which also covers RC4.
- The value is the owner's call. It must sit above any human run: £250,000 is about 28 perfect waves.
- **Result**: absurd scores become impossible. Plausible forgeries still pass.
- **Done** (2026-10-26, user): the ceiling is £250,000. ADR-006, ADR-007, OUT-8, OUT-10 and the brief are amended.

**S2. Server-issued game session** (RC1 in part, RC2; days). When a game starts, the function issues a session: an id, `startedAt` and a seed, either signed with an HMAC secret from the Netlify environment or kept as a blob. A signing must carry a session that hasn't been used yet. The function refuses a score above `R × elapsed seconds`, with R calibrated from a measured perfect-aim bot in the in-memory test harness.
- **Result**: no score without a session, and no high score without the matching time spent. A patient forger can still wait and then claim a plausible score.

**S3. Deterministic replay: the server computes the score** (RC1, RC3; one nWave feature). The client sends its input log, and the function replays it and ranks the score the replay produces. The claimed score is ignored, so Vector A and Vector B both stop working. The changes:
1. **The session's seed drives every gameplay random draw.** Today these call `Math.random`: enemy fire, Dream Home timing and bonus, and shield erosion. A seeded PRNG replaces them, and cosmetic draws (particles) get their own unseeded source, so the server can skip particles altogether.
2. **Shield erosion stops using `Math.hypot`** (`shields.js:43`). Its last bit isn't guaranteed to match across JavaScript engines. Comparing squared integer distances, `dx*dx + dy*dy <= r*r`, gives the same result everywhere.
3. **The client records input by step index**: held-key changes, presses, typed initials and pauses. That is a few KB for a long game, and the body cap is raised for it (it is 1 KB today, DDD-5).
4. **`createGame()` replaces the module-level `g`.** This matches the codebase's own factory paradigm (CLAUDE.md), lets the function run a fresh game for each check, and takes the live state out of `import()`'s reach.
5. **ADR-006 rule 5 is amended.** The function imports `src/game/game.js` and its imports (`theme/`, `shields.js`, `config.js`), not only `high-scores.js`.
6. **Wall-clock time must be at least the simulated time**, which comes from S2's `startedAt`. A 20-minute game can't be fabricated offline in one minute.
- **Residual risk**: a bot that plays well in real time. Without anti-bot measures that are far beyond this project, no client game can rule that out.
- **Cost check**: a 10-minute game is 72,000 steps of a small simulation, well within a function's run time. Each signing is still one invocation (ADR-007's quota figures are unchanged), plus the session request.
- **S2 and S3 designed** (user, 2026-10-26): [rightmove-invaders-replay-verified-scores](../feature/rightmove-invaders-replay-verified-scores/feature-delta.md), with S2 as its walking skeleton. DISCUSS and DESIGN are accepted ([ADR-012](../product/architecture/adr-012-the-table-replays-every-game.md), [ADR-013](../product/architecture/adr-013-deterministic-rules-one-game-per-instance.md)), and DISTILL is next. It differs from the countermeasures above in four points:
  - the game picks its own seed, and the session binds it with the issue time;
  - only the three held controls are recorded, because presses, initials and pauses never reach the gameplay;
  - there is no R: the replay and a clock check replace it;
  - the ceiling rises to £500,000 with the replay.

  A probe measured the replay at about 50 ms for 10 minutes in Node, identical across engines. The accepted residual risk is wider than "a bot in real time": it includes a program that searches inputs and seeds offline.

**Not recommended: minifying or obfuscating the JavaScript** (it addresses no root cause):
- Vector A never touches the JavaScript. The POST is visible in the network tab and replays with `curl`.
- Vector B survives too: devtools pretty-prints minified code, and a breakpoint reaches the state of a bundled closure.
- It adds the bundler that the project chose not to have (CLAUDE.md).
- At most, it slows down a casual console cheater for a few minutes.

## Backward chain validation
- **With S3**: the server computes the score from inputs under a seed it issued, so a claimed score is not evidence (RC1). Mutating `g` changes nothing the replay sees (RC3). A forged `curl` has no valid replay. An absurd score would need an absurd number of waves actually played, which S2's elapsed-time check exposes (RC2). The refusals are logged (RC4). The chain from Why 1 is broken at Why 2, Branch A.
- **With S1 + S2 only**: Why 2, Branch B is closed, and Branch A narrows to "plausible score after a real wait". The friend's absurd scores become impossible, but a modest forged top 10 does not.
- **With minification only**: no Why level changes. Vector A is untouched, and Vector B costs a pretty-print.

## Recommendation
1. **S0 now** (done, 2026-10-26).
2. **S1 as an immediate stopgap**: a small change in `high-scores.js` and the function, plus a refusal reason (done, 2026-10-26).
3. **Then S3 as a feature** (`/nw-new`, from DISCUSS), with S2's session endpoint as its walking skeleton. It supersedes ADR-007's accepted risk, and ADR-007's revisit trigger has now fired.
