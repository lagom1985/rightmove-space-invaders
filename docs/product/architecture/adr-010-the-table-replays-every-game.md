# ADR-010: The high-score table replays every game, from a session issued as it starts; supersedes ADR-007's accepted risk

**Status**: Proposed (rightmove-invaders-replay-verified-scores, DESIGN, 2026-10-26), awaiting the user's approval. D1–D4 were decided by the user on 2026-10-26 · **Feature**: rightmove-invaders-replay-verified-scores · **Supersedes**: ADR-007's "Accepted risk" (the rest of ADR-007 stands)

## Context
ADR-007 accepted that "made-up scores from a script" could reach the shared table, and named its trigger: forging "happening more than occasionally". On 2026-10-26 it fired. A player put deposits of about £9,999,950 on the production table, once with a `curl` and no game (Vector A), and once by changing the live game from the browser console, after which the game's own client signed the forged deposit (Vector B). The [root-cause analysis](../../analysis/root-cause-analysis-forged-high-scores.md) found that the server trusts the claimed deposit as its only evidence (RC1). PR #4's ceiling of £250,000 (S1) rules out absurd deposits, but not plausible ones.

ADR-007 rejected the two real defences as disproportionate: a signed game token ("little real gain") and server-side replay ("far beyond a fan game"). The second premise no longer holds. The rules run without browser APIs, in fixed steps of 1/120 s (ADR-000). A probe (2026-10-26, [findings](../../feature/rightmove-invaders-replay-verified-scores/probe/findings.md)) seeded a copy of them and found that:
- 7 bot games of up to 16.7 minutes replayed identically, fingerprint for fingerprint, in Node 22, Chromium, Firefox and WebKit;
- a 10-minute game replays in about 50 ms in Node;
- the inputs that matter, three held controls per step, take 0.8–1.6 KB a minute at human pace.

## Decision
- **The table saves the deposit the server replays** (D1). A signing carries its game's **record**, the held controls by step index, and the deposit the browser claims. The function replays the record and saves the replayed deposit. If the replay doesn't end at game over exactly at the record's last step, or ends with another deposit, the signing is refused (400 `replay-mismatch`), logged, and nothing is saved.
- **A session per game, bound to the game's own seed** (D2). The game starts at once with a seed of its own. In the background it posts that seed to `POST /api/sessions`, which answers with a session `{ id, seed, issuedAt, token }` and the refreshed table. That one request replaces the table refresh at every game start (ADR-008), so a game still costs one request, and the rules never wait for it.
- **The session is a signed token** (D3): HMAC-SHA256 over `v1.{id}.{seed}.{issuedAt}`, with the secret `SCORES_SESSION_SECRET` from the Netlify environment (at least 32 characters). The composition roots build a session signer `{ sign, verify }` from it; the handler never holds the secret. Without a secret, no session is issued and no signing is saved (500 `unexpected`, logged `secret-missing`). Locally, `scripts/serve.mjs` draws a random secret at each start.
- **One game, one row** (D7), with the restricted table port and the key format of ADR-004 unchanged. A row's id is its session's id. Per id the table keeps the key signed first; a later signing with the same session removes its own key and is refused (409 `session-used`), and pruning removes such keys first.
- **The signing's checks**, cheapest first: JSON, a body of at most 128 KB, a session, the shape `{ initials, score, session, record }`, the word filter, the token, a readable record, the rules version (`rules-changed`), at most 60 minutes of game time (`game-too-long`), no faster than the clock (`too-fast`: the game time can't exceed the time since the session was issued plus 10 s), the plausible ceiling, and only then the replay. The full order is the feature delta's "Signing checks" table.
- **Every refusal is logged by its fixed reason**, never the session, token, seed, record, initials or IP (DDD-17, extended). In the game, every refusal ends as today's "Couldn't confirm ALX's signing." (D5): the client still tells only OK from not OK (ADR-008).
- **The rows already on the table stay** (D4).

## Accepted risk (replaces ADR-007's)
**A program that plays well.** The seed is known when the game starts, and the rules are public, so a program can play in real time, or search offline for the inputs that do best with that seed, and sign the result. What still holds it back:
- the rules of the game: every deposit on the table was really scored, by some sequence of inputs;
- real time per game: a 20-minute game can't be signed sooner than 20 minutes after its session was issued (D8);
- one row per session (D7);
- the £250,000 ceiling;
- the rate limit.

**What doesn't hold it back**: a program can wait for many sessions at once, so D8 limits each forged game, not how many games a forger runs in parallel. Within the rate limit (10 requests a minute per IP, a session and a signing per row), one IP could ask for 10 sessions in a minute, wait the length of its forged games, and sign 10 rows in the next two minutes. The owner still deletes rows by hand, and the log's refusal reasons show attempts that fail. Ruling the risk out would take anti-bot measures (reaction-time heuristics, captchas, a seed revealed wave by wave from the server, which would put the network on the frame path), far beyond this project. **Revisit when** a row the owner judges forged appears on the production table (K24).

## Alternatives considered
- **The ceiling alone (S1, PR #4)**: free and already shipped, but a forged £249,950 still lands at #1.
- **A session with an elapsed-time rule and no replay** (the RCA's S2: refuse a deposit above R × elapsed seconds): needs a calibrated R and still trusts the claim. A forger who waits gets any deposit under R × the wait.
- **A seed chosen by the server, with the session fetched ahead of time** (rejected by the user, 2026-10-26): it stops seed shopping, which gains a forger nothing a program doesn't already have, and a game started before its session arrived (Enter within a second of a cold page load) could not be signed.
- **A session kept as a blob, used once** (rejected by the user, 2026-10-26): no secret, but a Blobs write per game, a sweep for sessions never used, and a wider table port than ADR-004 allows.
- **Ranking the replayed deposit and ignoring the claim** (rejected by the user, 2026-10-26): the player could see one deposit and be ranked with another, and a determinism bug or a tampered page would leave no trace in the log.
- **Keeping the records** (for an audit, or to watch replays): useful, but it changes the store's footprint and the privacy statement for no integrity gain. Out of scope.
- **A secret in the browser, signing the deposit**: anything the page can read, a forger can read.
- **Minifying or obfuscating the JavaScript**: the RCA rejects it. It addresses no root cause, and it would need a bundler.

## Consequences
- **Positive**: both of the RCA's vectors stop working. A claimed deposit is never evidence. Mutating the game in the browser changes only what that browser shows. Every row on the table was produced by some sequence of inputs, under the game's own rules, in at least its own length of real time.
- **Detection** (RC4): the log counts refusals by reason. `replay-mismatch` means either tampering or a determinism bug, and K23 investigates every one in the first 30 days.
- **Costs**:
  - **A secret to keep**: one per deploy context, set by the owner; rotating it invalidates the sessions in flight, whose signings end "Couldn't confirm".
  - **The game rules carry a version** (ADR-011): a deploy that changes how the game plays refuses signings from pages loaded before it (`rules-changed`), until they reload.
  - **A signing's body grows** from about 40 bytes to tens of KB, and the function replays it: about 50 ms for a 10-minute game in Node, unmeasured on Netlify (K22). Legacy Free bills invocations, not CPU time.
  - **The game-start request is no longer CDN-cacheable**, so a game start always costs an invocation (ADR-007's quota figures: about 1 + signings per game, under K15).
- **Accepted for release day**: a page loaded before the release signs in the old shape and is refused as `session-required` (D12).
- **Supersedes** ADR-007's accepted risk. ADR-007's validation, body cap and signing shape are amended by this ADR, and its rate limit, cache headers, word filter, kill switch and privacy statement stand.
