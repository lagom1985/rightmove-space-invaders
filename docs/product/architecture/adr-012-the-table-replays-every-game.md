# ADR-012: The high-score table replays every game, from a session issued as it starts; supersedes ADR-007's accepted risk

**Status**: Accepted (user, 2026-10-26), after three review cycles (rightmove-invaders-replay-verified-scores, DESIGN). D1–D4, D14, D18 and the re-entry of a deleted row within its session's 2 hours were the user's own decisions; the PO defaults D5–D21 were approved with it. Not yet built: it takes effect slice by slice in DELIVER · **Feature**: rightmove-invaders-replay-verified-scores · **Supersedes**: ADR-007's "Accepted risk" (the rest of ADR-007 stands, amended as below)

## Context
ADR-007 accepted that "made-up scores from a script" could reach the shared table, and named its trigger: forging "happening more than occasionally". On 2026-10-26 it fired. A player put deposits of about £9,999,950 on the production table, once with a `curl` and no game (Vector A), and once by changing the live game from the browser console, after which the game's own client signed the forged deposit (Vector B). The [root-cause analysis](../../analysis/root-cause-analysis-forged-high-scores.md) found that the server trusts the claimed deposit as its only evidence (RC1). PR #4's ceiling of £250,000 (S1) rules out absurd deposits, but not plausible ones.

ADR-007 rejected the two real defences as disproportionate: a signed game token ("little real gain") and server-side replay ("far beyond a fan game"). The second premise no longer holds. The rules run without browser APIs, in fixed steps of 1/120 s (ADR-000). A probe (2026-10-26, [findings](../../feature/rightmove-invaders-replay-verified-scores/probe/findings.md)) seeded a copy of them and found that:
- 7 bot games of up to 16.7 minutes replayed identically, fingerprint for fingerprint, in Node 22, Chromium, Firefox and WebKit;
- a 10-minute game replays in about 50 ms in Node;
- the inputs that matter, three held controls per step, take 0.8–1.6 KB a minute at human pace.

## Decision
- **The table saves the deposit the server replays** (D1). A signing carries its game's **record**, the held controls by step index, and the deposit the browser claims. The function replays the record and saves the replayed deposit. If the replay doesn't end at game over exactly at the record's last step, or ends with another deposit, the signing is refused (400 `replay-mismatch`), logged, and nothing is saved.
- **A session per game, bound to the game's own seed** (D2). The game starts at once with a seed of its own. In the background it posts that seed to `POST /api/sessions`, which answers with a session `{ seed, issuedAt, token }` and the refreshed table. That one request replaces the table refresh at every game start (ADR-008), and the rules never wait for it.
- **The session is a signed token** (D3): HMAC-SHA256 over `v1.{seed}.{issuedAt}`, with the secret `SCORES_SESSION_SECRET` from the Netlify environment (32 random bytes in canonical base64; anything else, checked by decoding and re-encoding, is treated as missing). The composition roots build a session signer from it; the handler never holds the secret. Without a secret, no session is issued and no signing is saved (500 `unexpected`, logged `secret-missing`). Locally, `scripts/serve.mjs` draws a random secret at each start. **A session expires after 2 hours** (D18, `session-expired`).
- **One game, one row** (D7), with the restricted table port and the key format of ADR-004 unchanged. A row's id is its game id, the SHA-256 of the seed cut to 32 hex characters, so every session for one seed names the same row. After its write, a signing keeps its key only if its own listing shows no other key with that game id; otherwise it removes its key and is refused (409 `already-signed`; if the removal fails, still 409, and pruning removes the key later). With list-after-write (ADR-004's strong consistency), at most one of two concurrent signings for one game keeps its key: if X keeps, Y wrote after X's listing, so Y's listing shows X's key. Both may remove theirs, which only a forger signing one game twice at once can cause. Every answer, and pruning, use one ranking: per game id, the key signed first (the earliest time, then arcade order), so a later attempt never shows, even while it is being refused. Pruning removes a game's other keys first; a signing deletes at most 5 keys, its own removal included.
- **A row that leaves the table can come back** (accepted by the user, 2026-10-26): a game whose row was pruned or deleted by the owner can be signed again with a session still within its 2 hours. The moderation guide says to delete again after the 2 hours, or to rotate the secret, which ends every session at once.
- **The signing's checks**, cheapest first: the secret, the JSON content type, a body of at most 128 KB, JSON, a session, the shape `{ initials, score, session, record }`, the word filter, the token, the session's age, a readable record, the rules version (`rules-changed`), at most 60 minutes of game time (`game-too-long`), no faster than the clock (`too-fast`: the game time can't exceed the time since the session was issued plus 10 s), the ceiling, and only then the replay. Nothing is written before the replay passes. The full order is the feature delta's "Signing checks" table.
- **The ceiling rises to £500,000** (D14), with the replay. It is the owner's judgement, about 1.8 times the probe's best rate (£4,700 a minute) over 60 minutes, so a verified game is unlikely to reach it; one that does is refused as `implausible-score`, and K23 traces it. It is checked on the claim before any replay.
- **Every refusal is logged by its fixed reason**, never the session, token, seed, game id, record, initials or IP (DDD-17, extended). In the game, every refusal ends as today's "Couldn't confirm ALX's signing." (D5): the client still tells only OK from not OK (ADR-008), and recovery is a reload.
- **The rows already on the table stay** (D4).

## Accepted risk (replaces ADR-007's)
**A program that plays well.** The seed is the game's own and the rules are public, so a program can play in real time, or search offline for the inputs that do best with a seed, and sign the result. It can also try many seeds and keep the best: over 100 seeds, the probe's bot scores a median of £46,100, and the best of 10 seeds averages £67,300 (+46 %). A seed chosen by the server would not stop this, because a forger could ask for 10 sessions a minute and keep only the best seed.

What still holds it back:
- the rules of the game: every deposit on the table was scored by some sequence of inputs;
- real time per game: a 20-minute game can't be signed sooner than 20 minutes after its session was issued (D8);
- one row per game (D7), and a session that expires after 2 hours (D18);
- the £500,000 ceiling;
- the rate limit, per IP and per hostname, with a session and a signing per row.

**What doesn't hold it back**: a program can wait for many sessions at once, so D8 limits each forged game, not how many games a forger runs in parallel. The rate limit's real cap is what K14 measured: about 13 requests a minute at a steady pace, and up to about 78 a minute for one IP sending 20 a second, because of Netlify's enforcement lag. **So after one wait, one fast IP can sign up to about 39 rows a minute** on each hostname that serves production:
- the custom domain;
- `<site>.netlify.app`, unless it redirects (unchecked);
- the published deploy's permalink, if its ID is known.

The user re-accepted this with these numbers on 2026-10-26: with 10 rows on the table, the pace changes little, because every row still needs a game that really plays to its deposit. The owner still deletes rows by hand; within its session's 2 hours, the same request can put a deleted row back, and after that only a new session and a new wait can. Ruling the risk out would take anti-bot measures (reaction-time heuristics, captchas, a seed revealed wave by wave from the server, which would put the network on the frame path), far beyond this project. **Revisit when** a row the owner judges forged appears on the production table (K24).

## Alternatives considered
- **The ceiling alone (S1, PR #4)**: free and already shipped, but a forged £249,950 still lands at #1.
- **A session with an elapsed-time rule and no replay** (the RCA's S2: refuse a deposit above R × elapsed seconds): needs a calibrated R and still trusts the claim. A forger who waits gets any deposit under R × the wait.
- **A seed chosen by the server, with the session fetched ahead of time** (rejected by the user, 2026-10-26, and confirmed with the measured gain): it would limit a forger to the seeds the rate limit hands out, which still allows best-of-10 every minute, and a game started before its session arrived (Enter within a second of a slow page load) could not be signed.
- **A session kept as a blob, used once** (rejected by the user, 2026-10-26): no secret, but a Blobs write per game, a sweep for sessions never used, and a wider table port than ADR-004 allows.
- **Ranking the replayed deposit and ignoring the claim** (rejected by the user, 2026-10-26): the player could see one deposit and be ranked with another, and a determinism bug or a tampered page would leave no trace in the log.
- **Checking for a used session before the replay** (one more listing per signing): it would refuse a re-sent request without replaying it, but adds a listing to every honest signing, whose path already gains the replay against K10's 924 ms p95 (the signing path's budget, D21: K10 under 1,250 ms, the replay under 250 ms). A re-send instead writes, lists, removes its key and is refused, under the rate limit, and its key never shows.
- **Remembering signed games** (a marker key per signed game, kept for the session's 2 hours; offered to the user, 2026-10-26, and declined): it would stop a deleted row from coming back with its old session, but adds a second key family to the store and widens the restricted port (ADR-004). A new session and a new wait would still bring it back.
- **The session's id as the row's id**: one row per session, but one game signed under many sessions would get many rows. The game id makes it one row per game.
- **Keeping the records** (for an audit, or to watch replays): useful, but it changes the store's footprint and the privacy statement for no integrity gain. Out of scope.
- **A secret in the browser, signing the deposit**: anything the page can read, a forger can read.
- **Minifying or obfuscating the JavaScript**: the RCA rejects it. It addresses no root cause, and it would need a bundler.

## Consequences
- **Positive**: both of the RCA's vectors stop working. A claimed deposit is never evidence. Mutating the game in the browser changes only what that browser shows. Every row on the table was produced by some sequence of inputs, under the game's own rules, in at least its own length of real time, and one game has one row.
- **Detection** (RC4): the log counts refusals by reason. `replay-mismatch` means either tampering or a determinism bug, and K23 investigates every one in the first 30 days.
- **The token binds the seed and the issue time, not the initials, the deposit or the record.** Whoever holds a session and a record chooses the initials of its row. That is acceptable: the record must replay, the game has one row, and the session travels only over HTTPS between the player's page and the function.
- **Costs**:
  - **A secret to keep**: one per deploy context, set by the owner. Rotating it needs a new deploy, and invalidates the sessions in flight, whose signings end "Couldn't confirm".
    - Each deploy keeps the value it was built with. A page on an older permalink signs to that permalink's own function and store.
    - A session an older production deploy issued verifies on the published deploy only if both were built with the same value, and the published deploy checks the signing with its own code (ADR-005, qualified).
    - After a rotation for a leak, no deploy built before the rotation may be published (the feature's DEVOPS).
  - **The build can read the secret**: on legacy Free, environment variables are visible to the build as well as the functions. So code that runs in the build could read the production value: a compromised dependency, for example.
    - Netlify's install runs with `NPM_FLAGS=--ignore-scripts` (the user, 2026-10-26), which blocks dependencies' install scripts. The dependencies stay pinned exactly.
    - What is left is accepted: the test gate's own code, run in the build. Rotate on any advisory against a dependency.
  - **The game rules carry a version** (ADR-013): a deploy that changes how the game plays refuses signings from pages loaded before it (`rules-changed`), until they reload.
  - **A signing's body grows** from about 40 bytes to tens of KB, and the function replays it: about 50 ms for a 10-minute game in Node. On Netlify, the signing path's budget (D21) is a 10-minute replay under 250 ms at p95, with K10 re-baselined from 1000 ms to 1,250 ms for a POST carrying that record, and K22 measures the longest game; a miss reopens this decision. "Signing ALX…" still shows at once. Legacy Free bills invocations, not CPU time.
  - **The game-start request is no longer CDN-cacheable**, so a game start always costs an invocation and a Blobs listing. A game costs about 2–3 invocations (K15 holds). Its rate-limit count is unchanged, because cache hits counted already (K14's baseline).
  - **Quick restarts can meet the rate limit** (D19): a game started after about 10 requests within a minute from one IP, on one hostname, gets no session and can't be signed. ADR-007's plan to split the function, using the plan's second code rule, applies if it bites.
  - **ADR-007's operation counts**: a POST is still 1 write + 1 listing + up to 5 deletes (an `already-signed` refusal's own removal is one of them); a session request is 1 listing.
- **Accepted for release day**: a page loaded before the release signs in the old shape and is refused as `session-required` (D12); the release note says to reload.
- **Supersedes** ADR-007's accepted risk. ADR-007's validation, body cap, signing shape, ceiling and operation counts are amended by this ADR; its rate limit, cache headers, word filter, kill switch and privacy statement stand.
