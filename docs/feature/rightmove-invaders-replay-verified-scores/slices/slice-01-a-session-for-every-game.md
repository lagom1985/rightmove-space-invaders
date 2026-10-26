# Slice 01: A session for every game (walking skeleton)

**Stories**: US-01, US-02 | **Jobs**: J-TABLE-TRUST, J-TABLE-SIGN | **Estimate**: about 1 day | **Order**: 1st

## Goal
Every game asks the Score API for a session as it starts, without waiting for it, and the table saves only signings that carry a session it issued, once each.

## IN scope
- A session request at each game start, which also brings the refreshed table and replaces today's `GET` on `gameStarted` (D2). The game starts at once, whatever the request does.
- A session binds the game's seed and its issue time, in a token signed with a secret from the Netlify environment (D3).
- The signing carries its game's session, and waits for it (pending at once) when it hasn't arrived yet. A game without a session signs and ends unconfirmed (D11).
- The function refuses a signing with no session, with an altered session, or with a session that has already signed (D6, D7), and saves nothing. Each refusal is logged by its reason (D15).
- No secret: no session is issued, no signing is saved, and the log says why.
- The local server makes its own secret, so `npm start` and the tests need no setup.
- The walking-skeleton scenario "A signing that no game asked for doesn't reach the table".

## OUT of scope
- The record and the replay (slice 02). In this slice the deposit is still checked only for its shape and the £250,000 ceiling: a forger who asks for a session first can still claim £249,950.
- The clock check and the rules version (slice 03).
- Any new wording (D5).

## Learning hypothesis
- **Disproves** "a session per game costs nothing on Netlify" if the function can't read its secret in a deploy preview, if a game start costs more than one request, or if a session's round trip pushes signing past K10's 1 s p95 on a preview.
- **Confirms** that the session request can take over from the game-start refresh with no visible change for the player, and that `curl` with no game no longer reaches the table.

## Acceptance criteria
See US-01 and US-02 in [feature-delta.md](../feature-delta.md#wave-discuss--ref-user-stories).

## Production data and dogfood
- The pull request's deploy preview, with its own secret set by the owner, its real function and its real Blobs store.
- Dogfood the same day: the deliverer plays and signs in Chrome, Firefox and Safari; then posts the RCA's `curl` (Vector A) to the preview with £249,950 and sees it refused, and reads the reason in the function's log.

## Dependencies
- PR #4 (merged, `4d17123`).
- The owner sets the secret on Netlify for deploy previews before the preview is checked, and for production before the merge.

## Reference class
Like the leaderboard's `listedAt` (DDD-12): one more field in a request and an answer, one new check in the handler, one change in `main.js`'s wiring. About 1 day with the secret's plumbing and its tests.
