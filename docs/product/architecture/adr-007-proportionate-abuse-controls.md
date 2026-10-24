# ADR-007: Proportionate abuse controls for the public score endpoint; forged scores are an accepted risk

**Status**: Accepted (user, 2026-10-24, revision 3) · **Feature**: rightmove-invaders-leaderboard

## Context
The game runs in the browser, so a score can't be proven: anyone can POST any well-formed signature to `/api/scores`. This is a small public fan game on a personal domain, with one maintainer, the free tier and no budget for paid services. The endpoint also carries cost (function invocations and Blobs operations), and offensive initials on a shared screen would be the most visible harm.

## Decision
- **Strict validation in the function**, in this order:
  - The content type must be `application/json`, otherwise 415 `json-required`. This makes cross-site simple POSTs impossible.
  - The body is read with a 1 KB byte cap (`Content-Length` isn't trusted). Anything longer gets 413 `payload-too-large`.
  - The body must be JSON with exactly `{ initials, score }`: three letters A–Z, and a positive integer multiple of £50 up to £9,999,999. Anything else gets 400 `invalid-signature`.
  - Initials on the word filter get 400 `initials-not-allowed`.
- **Rate limit**: `config.rateLimit` on the function asks Netlify for about 60 requests per minute, aggregated by IP and domain. It covers GET and POST together: a busy honest player makes a few requests a minute, and an office may share one IP. If it bites, split GET and POST into two functions with their own limits.
  - **Not yet verified.** Whether the site's plan honours it is a DEVOPS go/no-go, measured on a deploy preview.
  - The 429 comes from Netlify, with Netlify's body and headers. It exists only on Netlify, so no local scenario is written for it.
- **Fallback if `config.rateLimit` isn't honoured**: ship without it, and give the owner a switch.
  - The Netlify entry reads an environment variable. When it is set, every POST answers 503 `signing-paused` and GET is unaffected.
  - The switch takes effect only after a redeploy, typically within minutes. The procedure is in the DEVOPS open questions.
  - The client recognises `signing-paused` and shows a distinct message that never says "may have been saved", for example "High-score signing is paused; FAB wasn't saved" (final wording is DISTILL's).
  - The function logs it as `scores.rejected` with the reason `signing-paused`.
  - DEVOPS also sets up a usage alert if the plan offers one.
  - If this fallback is adopted, OUT-8 gains the 503 `signing-paused` answer and OUT-11 the paused outcome.
- **The 3-letter word filter** lives in `src/game/high-scores.js` (ADR-006), so the game refuses blocked initials and asks the player to change them before anything is sent. The server enforces the same list.
- **Moderation by the owner**: a short guide (DEVOPS) explains how to delete a row's key from the production store with the Netlify CLI or UI.
- **Privacy and logs**:
  - A signature keeps 3 initials, a score and a time. The platform sees client IPs (that is how it rate-limits); the function stores none.
  - Each log line carries only a fixed reason per outcome (for example `invalid-signature`, `key-exists`, `put-failed`, and `signing-paused` with the fallback), with the duration, the key count, the scope and the raw deploy context.
  - The function never logs an error's message, a key, the body, an id, initials or an IP. A unit test makes the store throw an error whose message contains a key, and checks that no initials reach the log.
- **Accepted risk**: made-up scores from a script.

## Worst-case operation counts
To be checked by DEVOPS against the plan's allowances; no plan limits are assumed here.
- **Per IP at the limit**: about 60 requests per minute, or **about 86,400 function invocations a day**.
- **Per POST**: 1 write + 1 listing + up to 5 deletes, so up to 7 Blobs operations. **Per GET**: 1 listing.
- **One IP posting at the limit all day**: about 86,400 invocations and up to about 604,800 Blobs operations. Each additional IP adds the same.
- **Honest use**: a page load plus about 2 requests per game.

## Alternatives considered
- **Validation only** (the skeleton): nothing caps the cost, nothing filters words, and cross-site simple POSTs are possible.
- **A server-issued signed game token with an elapsed-time plausibility check**: it needs a secret, clock maths and a second endpoint, and a patient forger can still fetch a token, wait and post. Little real gain for this audience.
- **Server-side replay of the game from recorded inputs**: the only real proof, but it means running the whole game on the server. Far beyond a fan game.

## Consequences
- The rate limit protects cost and the pruning loop, not honesty. One forger can still fill the top 10. The remedy is deleting rows, and the trigger to revisit this ADR is it happening more than occasionally.
- Players whose initials are filtered are told at once, in the game, without a round trip.
- The word list is public (it ships to the browser). Its contents are a DELIVER task, reviewed by the owner.
- Every answer from the function is `Cache-Control: no-store` with a JSON `{ error }` body for errors. Netlify's 429 carries no such guarantee.
