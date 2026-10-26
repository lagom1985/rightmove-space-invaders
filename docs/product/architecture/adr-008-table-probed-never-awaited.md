# ADR-008: The high-score table is probed, never awaited, and a signing has an explicit outcome

**Status**: Accepted (user, 2026-10-24, revision 3); amended in DEVOPS (user, 2026-10-24): a GET answer may come from the CDN cache, up to 15 s old; the paused outcome is removed, because the ADR-007 fallback was rejected (user, 2026-10-24); amended by [ADR-010](adr-010-the-table-replays-every-game.md) (user, 2026-10-26): the game-start read is the session request's answer · **Feature**: rightmove-invaders-leaderboard

## Context
Responsiveness is the game's first quality attribute: input and sound within one frame. The table is a network call, possibly with a cold start, and it can be unreachable (offline, a static host without the function, a 5xx, a 429). In the walking skeleton:
- the table loads only at page load, so whether a score qualifies can be hours out of date
- "Signed FAB." is announced before the server answers, even if the signing then fails
- a hanging request is never given up
- answers can arrive out of order, so a slow GET could replace a newer table and drop a just-confirmed row
- starting a new game throws away a signing that is still in flight

POST is not idempotent: a retry after a lost answer would add the score twice.

## Decision
- **The network never sits on the frame path.** `main.js` makes the requests through `platform/leaderboard.js` and hands the outcome to the rules from the promise callbacks, between frames. Only `game.js` writes `g`.
- **When the table is read**: on page load, in the background whenever a game starts (`gameStarted`), and from every POST answer. *Amended by ADR-010 (user, 2026-10-26)*: the game-start read is the answer to the game's session request (`POST /api/sessions`). That answer carries rows and `listedAt` like any other, under the same listing-time rule, and is never cached. A signing waits, in a promise and never in a frame, for its game's session. Each request's 5000 ms timeout starts when that request is sent. Every refusal is still an unconfirmed signing. The server stays the authority: it ranks every valid signature and doesn't refuse one that no longer qualifies.
  - **Amended in DEVOPS (user, 2026-10-24)**: a GET answer may come from Netlify's CDN cache and be up to 15 s old (DDD-6). It carries the `listedAt` of its own listing, so the rule below treats it as the older answer it is. POST answers are never cached.
- **Answers ordered by server listing time**:
  - Every answer that carries rows also carries `listedAt`: the function's `Date.now()` in ms, taken right after its `list` call returns. That is GET `{ scores, listedAt }` and POST `{ scores, id, listedAt }`.
  - The rules apply rows only if their `listedAt` is ≥ the last applied `listedAt`. Otherwise they ignore the rows, and still settle a signing from its own answer.
  - A POST's listing always comes after its own write, so a GET whose listing came before that write can never roll the table back. A late failed GET after a success changes nothing.
  - Send order is not used. The signing number n only matches a POST answer to its signing.
  - **Accepted edge**: clock skew between function instances (a few ms) can misorder two listings taken within that window. Those snapshots are then nearly identical, and the next refresh corrects them.
- **One table state `{ status, rows }`**:
  - `unknown` until the first answer, and unchanged while a load is in flight.
  - `available` after a successful load or POST answer, whose rows apply only if their `listedAt` is ≥ the last applied one.
  - `unavailable` **only while no table has ever loaded**, after a failed load (user, 2026-10-24). Once a table has loaded, a failed refresh keeps the last good table and the status stays `available`: a player who makes it is still asked for initials, and a signing that then can't get through ends as unconfirmed. A failed signing doesn't change the table state.
- **Initials** are asked for only when `makesTheTable` is true, which requires the status to be `available` (ADR-006). What game over shows:
  - available: the list
  - unavailable: "High-score table unavailable"
  - unknown: no prompt, no list and no table line (DISTILL may add neutral wording)

  The title screen shows the list only while the table is available.
- **Signing lifecycle**. The rules number each signing.
  - **pending**: "Signing FAB…", shown at once.
  - **confirmed**: "Signed FAB, #3", when the new id is in the answer's own rows (rank = its position). The answer settles the signing even if its rows are too old to apply.
  - **off-table**: "The table filled up before FAB arrived", when the id is not in the answer's rows.
  - **unconfirmed**: "Couldn't confirm FAB's signing", after a non-OK answer, a network error or the timeout. The signing may still have been saved. *Amended in DELIVER (2026-10-25, review M1)*: also after an OK answer of the wrong shape (no `scores` array of `{ initials, score, id }` rows, no finite `listedAt`, or no string `id` for a signing). `src/platform/leaderboard.js` rejects it at the adapter boundary, so a malformed answer goes down the same failed path and never reaches the rules or the views. A failed load works the same way: it leaves the table as it was.
- **A signing lives until the next signing** (orchestrator, 2026-10-24).
  - A new game does not drop it. If the outcome arrives during play, the status mirror announces it, and nothing new is drawn on the canvas mid-game.
  - A confirmed row stays highlighted (canvas green, DOM `aria-current`) wherever the list is shown (the game-over screen of any later game; the title shows no signing, because a signing does not survive the reload that shows it: clarified in DISTILL), until the next signing replaces it or the row leaves the shown table. A row leaves when it is pruned or pushed down by newer signings; the highlight then disappears, and the signing stays confirmed.
  - The game-over messages of a later game don't repeat an earlier outcome.
- **A replaced signing is still announced** (orchestrator, 2026-10-24). When the answer (or failure) of a signing that a newer signing has replaced arrives:
  - its outcome (confirmed "#r" from its own rows, off-table or unconfirmed) is announced once, through the status mirror
  - its rows apply under the listing-time rule
  - it changes neither the current signing's status nor its highlight
- There is no automatic POST retry. Enter starts a new game from pending, confirmed, off-table and unconfirmed alike. The client tells only OK from not OK: a 429 or any other error is unconfirmed.
- **The timeout** is exactly 5000 ms, for GET and POST. It runs on the `setTimeout`/`clearTimeout` that `main.js` injects, and aborts the request. Playwright's clock therefore drives it in tests, as with the synth's capabilities (sound DDD-14).
- **Wire, probe, use**: the page-load GET is the client's probe. Until a load succeeds nobody is asked for initials, and the game never refuses to start because of the table. The function has no probe of its own at cold start, because every request exercises the store.

## Alternatives considered
- **Load at page load only** (the skeleton): qualification can be hours out of date.
- **Fetch at game over and wait** (with a timeout): the freshest answer, but a visible pause, possibly a cold start, at the emotional peak of the game.
- **An optimistic "Signed FAB."** (the skeleton): untrue whenever the signing fails.
- **"…wasn't saved" as the failure message** (iteration 1): untrue whenever the server saved the key but the answer was lost or late.
- **Dropping the signing when a new game starts** (the skeleton): the player never learns the outcome of a slow signing.
- **Last answer wins**: a slow GET could replace a newer table and remove a just-confirmed row.
- **Request numbers in send order** (revision 2): a GET sent after a POST can be listed before the POST's write lands. It would then outrank the POST's newer rows and remove the just-confirmed row. The order that matters is when the server listed, not when the browser asked.
- **Dropping a replaced signing's answer silently**: the player who signed twice in quick succession would never learn how the first signing ended.
- **Holding Enter until the server answers**: leaves the player at the mercy of the network.
- **Retrying the POST automatically**: a retry after a lost answer would add the score twice. Making it idempotent would need a client-chosen key, which isn't worth it for a table of 10 rows.

## Consequences
- A qualification decision uses a table as old as the last successful refresh (normally this game's start), plus up to 15 s of CDN caching on GET (amended in DEVOPS (user, 2026-10-24)). Another computer sees a new row up to about 15 s late; the signer sees it at once, in the POST answer (K11 checks on Netlify that a signer finds their own row in their own answer; the local emulator can cut a listing short under concurrency: clarified in DISTILL). Rows apply in server listing order, apart from the accepted clock-skew edge.
- The player learns what happened to every signing, even during the next game or after signing again, and the game never claims more than it knows. A slow or absent server costs at most a message.
- A highlight is not a promise: a confirmed row can later leave the table, and its highlight goes with it.
- **Saved but unconfirmed** (accepted): the player is told "Couldn't confirm FAB's signing" although the score was saved, and the next refresh shows the row, without a highlight because the client never learned its id. This happens in two ways:
  - the server saved the key but the listing then failed (500)
  - the client's 5000 ms timeout fired before a slow server finished saving
- The rules gain the table state, the last applied `listedAt`, a signing (with its number) that outlives a game, and a settled-outcome notice that the status mirror announces once. The status mirror announces outcomes in any game state; the canvas shows them on the game-over screen only. The exact wording is DISTILL's, starting from the messages above.
- Failure paths are tested by injecting faults at the network boundary (`page.route` on `/api/scores`: abort, 503, delay), as the throwing-`localStorage` scenarios already do.
