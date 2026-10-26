# ADR-007: Proportionate abuse controls for the public score endpoint; forged scores are an accepted risk

**Status**: Accepted (user, 2026-10-24, revision 3); amended in DEVOPS (user, 2026-10-24): the rate limit is 10 per 60 s, and successful GETs are cached for 15 s; fallback rejected (user, 2026-10-24); amended after the [forged-scores RCA](../../analysis/root-cause-analysis-forged-high-scores.md) (user, 2026-10-26): the plausible ceiling, and the revisit trigger has fired; **accepted risk superseded by [ADR-010](adr-010-the-table-replays-every-game.md)** (user, 2026-10-26), which also amends the body cap, the signing's shape, the ceiling and the operation counts · **Feature**: rightmove-invaders-leaderboard

## Context
The game runs in the browser, so a score can't be proven: anyone can POST any well-formed signature to `/api/scores`. This is a small public fan game on a personal domain, with one maintainer, the free tier and no budget for paid services. The endpoint also carries cost (function invocations and Blobs operations), and offensive initials on a shared screen would be the most visible harm.

## Decision
- **Strict validation in the function**, in this order:
  - The content type must be `application/json`, otherwise 415 `json-required`. This makes cross-site simple POSTs impossible.
  - The body is read with a 1 KB byte cap (`Content-Length` isn't trusted). Anything longer gets 413 `payload-too-large`. *Amended by ADR-010 (user, 2026-10-26)*: 128 KB for a signing, which carries its game's record, and 1 KB for a session request.
  - The body must be JSON with exactly `{ initials, score }`: three letters A–Z, and a positive integer multiple of £50 up to £9,999,999. Anything else gets 400 `invalid-signature`. *Amended by ADR-010 (user, 2026-10-26)*: exactly `{ initials, score, session, record }`, with the session checked against its signed token and the record replayed. The full order of checks and their reasons are in the feature delta's "Signing checks" table (rightmove-invaders-replay-verified-scores).
  - Initials on the word filter get 400 `initials-not-allowed`.
  - A score above the plausible ceiling, £250,000 (`MAX_PLAUSIBLE_SCORE`, ADR-006), gets 400 `implausible-score` (amended, user, 2026-10-26). The 7-digit key field allows £9,999,999, but a wave is worth at most £8,800, so the ceiling is about 28 perfect waves. The game asks for no initials above it. *Amended by ADR-010 (user, 2026-10-26)*: £500,000, from the change that makes the function replay each game.
- **Rate limit** (amended in DEVOPS (user, 2026-10-24)): `config.rateLimit` on the function is `{ windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] }`: 10 requests per 60 s per IP and domain, in one rule (the Free plan allows 2 code rules per project). It covers GET and POST together: a busy honest player makes a few requests a minute, and an office may share one IP. Netlify can take up to 10 s to start blocking. If it bites, split GET and POST into two functions with their own limits, using the second rule.
  - Rate limiting is available on every plan (Netlify docs). Whether it holds is the DEVOPS go/no-go on a deploy preview (K14). There is no fallback (user, 2026-10-24): a no-go means the function isn't merged to `main`.
  - The 429 comes from Netlify, with Netlify's body and headers. It exists only on Netlify, so no local scenario is written for it. The client treats it like any other not-OK answer.
- **The owner's emergency stop** is the DEVOPS kill switch: publish the last production deploy without the function. Netlify's usage emails (50, 75, 90 and 100%) are the alert. There is nothing to set up.
- **The 3-letter word filter** lives in `src/game/high-scores.js` (ADR-006), so the game refuses blocked initials and asks the player to change them before anything is sent. The server enforces the same list.
- **Moderation by the owner**: a short guide (DEVOPS) explains how to delete a row's key from the production store with the Netlify CLI or UI.
- **Privacy and logs**:
  - A signature keeps 3 initials, a score and a time. They are kept until pruned or deleted by the owner, and there is no backup. Netlify processes client IPs for rate limiting; the function stores none.
  - Each log line carries only a fixed reason per outcome (for example `invalid-signature`, `key-exists`, `put-failed`), with the duration, the key count, the scope, the raw deploy context and the raw `published` flag (ADR-005).
  - The function never logs an error's message, a key, the body, an id, initials or an IP.
  - **Nothing escapes the handler** (amended in DEVOPS, review iteration 2): a catch-all around the request handler logs only `scores.error` with the reason `unexpected` and answers 500 `unexpected`. So no request-time error, whose message or stack could carry a key, reaches Netlify's log. Module-load errors and runtime timeouts sit outside the handler, and Netlify logs those itself. The risk is low, because no key is on that path. `scripts/serve.mjs` logs only the fixed reason too.
  - A unit test makes the store throw an error whose message contains a key, captures every console method (`log`, `info`, `warn`, `error`, `debug`, `trace`), and checks that no key or initials reach any of them.
- **Accepted risk**: made-up scores from a script, up to the plausible ceiling (amended, user, 2026-10-26). **Superseded by ADR-010 (user, 2026-10-26)**: a made-up deposit is refused, because the function replays every game. The accepted risk narrows to a program that plays well (ADR-010, "Accepted risk").

## Worst-case operation counts
Checked by DEVOPS against the legacy Free plan: 125k function invocations per site per month, counted per request (amended in DEVOPS (user, 2026-10-24); corrected after the review, iteration 2). Blobs limits are not listed, which doesn't mean there is none: they are checked on the account before the merge.
- **Per POST**: 1 write + 1 listing + up to 5 deletes, so up to 7 Blobs operations. **Per GET**: 1 listing, or none when the CDN cache answers. *Amended by ADR-010 (user, 2026-10-26)*: an `already-signed` refusal counts its own removal among the 5 deletes; a session request (`POST /api/sessions`, one per game start, never cached) is 1 listing.
- **Enforcement lags** by up to 10 s (Netlify docs). Assuming the lag repeats in every 60 s window, one IP sending r requests a second gets about **10 + 10r a minute** through, per hostname. This is an upper bound until the DEVOPS smoke test measures the real cap at 20 a second (K14).
- **One IP that stays at the limit**: about 14,400 invocations a day, and the month in about 8.7 days.
- **One IP at 20 a second**: about 210 a minute, so **about 302,400 invocations a day**. That is the month's 125k in **about 10 hours**, about an hour after the 90% email. If they are all POSTs, that is up to about 2.1 million Blobs operations a day.
- **More hostnames, more IPs**: each live hostname that serves the function (the custom domain, every preview, branch deploy and permalink) has its own counter, and so does each extra IP; each multiplies these figures.
- **Honest use**: a page load plus about 1 GET per game and 1 POST per signing. GETs within the same 15 s share one cached answer.

## Alternatives considered
- **Validation only** (the skeleton): nothing caps the cost, nothing filters words, and cross-site simple POSTs are possible.
- **A server-issued signed game token with an elapsed-time plausibility check**: it needs a secret, clock maths and a second endpoint, and a patient forger can still fetch a token, wait and post. Little real gain for this audience.
- **Server-side replay of the game from recorded inputs**: the only real proof, but it means running the whole game on the server. Far beyond a fan game.
- **An owner switch as a fallback, if `config.rateLimit` isn't honoured** (revision 3): ship without the limit, and have an environment variable make every POST answer 503 with an error code of its own. GET is unaffected, and the client shows a distinct "wasn't saved" message. **Rejected (user, 2026-10-24)**, on DEVOPS's reasoning:
  - **Its trigger is gone**: rate limiting is available on the plan, and whether it holds is measured on a preview (K14).
  - **It saves no quota**: legacy plans bill functions by request count, regardless of runtime, so a POST answered 503 at once costs the same invocation as a saved one. GETs aren't paused at all.
  - **It is slower than the kill switch**: it takes a redeploy (minutes and build minutes), while publishing the last deploy without the function is instant and stops invocations altogether.
  - **It wouldn't fix a failed rate limit**: without a working limit it caps nothing, and on legacy Free reaching the quota pauses every site on the account. The right answer is a no-go.
  - **Its one advantage is small**: it keeps reads while writes stop. Deleting rows and the kill switch cover that, and for a fan game a read-only table instead of no table is a small difference.
  - **It costs**: an environment-variable read, an error code, a client outcome and its message, a log reason, a DISTILL scenario, and clauses in OUT-8 and OUT-11.

## Consequences
- The rate limit protects cost and the pruning loop, not honesty. One forger can still fill the top 10. The remedy is deleting rows, and the trigger to revisit this ADR is it happening more than occasionally. *Under ADR-010, the rate limit also bounds how fast a program that plays well can sign (its accepted risk), and a refused session request now leaves its game unsignable (D19 of rightmove-invaders-replay-verified-scores).*
  - **The trigger fired on 2026-10-26**: a player posted absurd scores, both by a direct POST and by changing the live game state from the browser console. The plausible ceiling is the stopgap: it rules out absurd scores, but not plausible forged ones. The [root-cause analysis](../../analysis/root-cause-analysis-forged-high-scores.md) recommends server-side replay as the real fix (S3). Its premise differs from the rejected alternative above: the rules already run without browser APIs, in fixed steps.
- Players whose initials are filtered are told at once, in the game, without a round trip.
- The word list is public (it ships to the browser). Its contents are a DELIVER task, reviewed by the owner.
- Every POST answer and every error from the function is `Cache-Control: no-store`, with a JSON `{ error }` body for errors. A successful GET is cached for 15 s at the CDN (DDD-6; amended in DEVOPS (user, 2026-10-24)). Netlify's 429 carries no such guarantee.
