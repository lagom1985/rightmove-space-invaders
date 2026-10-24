# Feature delta: rightmove-invaders-leaderboard

An arcade high-score table that everyone shares. A deposit that makes the top 10 is signed with three initials (A–Z, Up/Down change the letter, Enter takes it). Everyone who opens the game sees the same table, which is kept in Netlify Blobs behind a Netlify Function. The local best deposit in `localStorage` stays as it is.

- **Type**: user-facing, new functionality, brownfield. It builds on the walking skeleton at commit `2e108db` on branch `worktree-leaderboard-spike`.
- **No DISCUSS wave.** The brief came straight from the user (2026-10-24): "save the score in Netlify Blobs; when a player finishes, ask for their name, then show the list like every arcade". Decided with the user before DESIGN: 3 arcade initials, a top 10 shared by everyone, only a qualifying deposit is asked for initials, and the local best stays.
- **SPIKE**: [findings](spike/findings.md) · [wave decisions](spike/wave-decisions.md). The verdict: one blob key per score loses nothing under concurrency.
- **Do not push `worktree-leaderboard-spike` until ADR-005 is implemented.** The skeleton writes to the site-wide store from any branch deploy.
- **Density**: lean (Tier-1 only). **Revision**: 3 (after the solution-architect review and re-review).
- **SSOT**: [architecture brief](../../product/architecture/brief.md) · ADR-004…008 · [outcomes registry](../../product/outcomes/registry.yaml) (OUT-7…OUT-13) · [journey](../../product/journeys/play-a-session.yaml) · [ATDD policy](../../architecture/atdd-infrastructure-policy.md)

---

## Wave: DESIGN / [REF] DDD list

Scope: application / components (nw-solution-architect) · mode: propose · paradigm: OOP · density: lean. The user approved the whole recommended set on 2026-10-24. Later decisions the same day: on table status, by the user; on keeping a signing across a new game, by the orchestrator.

| ID | Decision | Verdict | One-line rationale |
|---|---|---|---|
| DDD-1 | Storage layout D: one empty blob per score, with the inverted score, the time, the initials and a random id in the key, written only if new (an existing key → 503 `not-saved`). The table comes from a strong listing of well-formed keys. Once there are more than 20 keys, each POST prunes at most 5 of those ranked 11th or lower, on a best-effort basis. | Accepted (user, SPIKE promotion) | 0 lost signatures with up to 100 at once; no coordination needed ([ADR-004](../../product/architecture/adr-004-high-score-table-function-over-blobs.md), OUT-9) |
| DDD-2 | Store by deploy context: a pure `chooseStore(context)` returns `'site'` only when `context?.deploy?.context === 'production'` **and** `context?.deploy?.published === true` (the published deploy; amended in DEVOPS (user, 2026-10-24)). Everything else gets `'deploy'`: missing, other or differently spelled contexts, and a production deploy that isn't the published one or has no `published` boolean. `'site'` → `getStore('leaderboard')`; `'deploy'` → `getDeployStore('leaderboard')`, both with strong consistency. Without a deploy ID, `getDeployStore` throws `MissingBlobsEnvironmentError`: a 500, never a fallback to the site store. Locally, one store per `test-board` cookie. | Accepted (user) | Previews never write to production, and the production table survives deploys and rollbacks ([ADR-005](../../product/architecture/adr-005-table-store-by-deploy-context.md), OUT-13) |
| DDD-3 | The shared pure module `src/game/high-scores.js` imports nothing. It holds the table size, the alphabet and length, the £50 step, the maximum, signature validity, the word filter, and `makesTheTable`. The function uses the size and the signature validity, including the word filter; only the browser uses `makesTheTable`. | Accepted (user) | One rule on both sides of the wire ([ADR-006](../../product/architecture/adr-006-shared-high-score-rules.md), OUT-10) |
| DDD-4 | The function's composition roots (the Netlify entry, and `scripts/serve.mjs` locally) choose the store and wrap it in a **restricted table-store port**. The port has `list` (well-formed keys under `s/` only), `putIfNew(key)` and `remove(key)`, and `putIfNew` and `remove` refuse any key that isn't well-formed. There is no `deleteAll` and no other access to the store. A call to `putIfNew` or `remove` with a key that isn't well-formed throws a refusal. The handler maps a refusal to 500 `unexpected`, even during pruning: a refusal is a bug, not a store failure. The read path (GET) receives `list` alone. The roots also wire the clock, the id source and the logger. The handler is the imperative shell. The key codec, ranking, prune plan and `chooseStore` are pure. | Accepted | The handler can't touch anything but score keys; deterministic tests of the duplicate-key path |
| DDD-5 | Abuse controls: a JSON content type is required (else 415). The body is read with a 1 KB byte cap (else 413). The body must be exactly `{ initials, score }` (else 400). The word filter runs on both sides. `config.rateLimit` allows 10 requests per 60 s per IP and domain, across GET and POST (amended in DEVOPS (user, 2026-10-24)): a DEVOPS go/no-go on a deploy preview (K14), where no-go means no merge to `main`. There is no fallback switch (rejected: user, 2026-10-24). There is an owner guide to deleting a row. Forged scores are an accepted risk. | Accepted (user) | Proportionate for a public fan game ([ADR-007](../../product/architecture/adr-007-proportionate-abuse-controls.md)) |
| DDD-6 | HTTP contract: every answer from the function has a JSON body and sets its own cache headers, plus `X-Content-Type-Options: nosniff` (amended in DEVOPS, 2026-10-24: Netlify's custom headers from `netlify.toml` don't apply to function answers, so the function sets the one that matters for JSON itself). **Amended in DEVOPS (user, 2026-10-24)**: a GET 200 is cached for 15 s at the CDN (`Netlify-CDN-Cache-Control: public, s-maxage=15, durable`; `Cache-Control: public, max-age=0, must-revalidate`); every POST answer and every error is `Cache-Control: no-store`; every answer carries `Netlify-Vary: query=table`, so other query strings share the one cached answer. GET 200 `{ scores, listedAt }`, POST 200 `{ scores, id, listedAt }`, where `listedAt` is the function's `Date.now()` in ms, taken right after its `list` call returns. Errors are `{ error }`: 400 `invalid-signature` / `initials-not-allowed`, 405 with `Allow`, 413 `payload-too-large`, 415 `json-required`, 503 `not-saved`, 500 `unexpected`. A 429 comes from Netlify (on Netlify only), with Netlify's body and headers and no `no-store` guarantee. The client only distinguishes OK from not OK (the ADR-007 fallback was rejected: user, 2026-10-24). | Accepted (user) | The same behaviour locally and in production, except the platform's 429 (OUT-7, OUT-8) |
| DDD-7 | The table is read on page load, in the background on every `gameStarted`, and from every POST answer. The server ranks every valid signature and doesn't refuse one that no longer qualifies. | Accepted (user) | The table is as old as the last successful refresh (normally this game's start), with no wait at game over ([ADR-008](../../product/architecture/adr-008-table-probed-never-awaited.md)) |
| DDD-8 | Signing lifecycle: entering → pending → confirmed, off-table or unconfirmed, keyed by a signing number n that the rules issue to match a POST answer to its signing. No POST retry. A new game does **not** drop the signing: its outcome is kept until the next signing. An outcome that arrives during play is announced by the status mirror only. A confirmed row stays highlighted wherever the table is shown, until the next signing or until the row leaves the table (pruned, or pushed down by newer signings). An answer for a signing that a newer signing has replaced is still announced once, through the status mirror. Its rows apply under DDD-12, and it changes neither the current signing nor its highlight. Enter always restarts. The skeleton's optimistic "Signed FAB." is reversed. | Accepted (user; keeping the signing across games and announcing replaced signings: orchestrator, 2026-10-24) | The player learns every signing's outcome, even after starting the next game or signing again, and the game never claims more than it knows (ADR-008, OUT-11) |
| DDD-9 | One table state, `{ status, rows }`, with status `unknown`, `available` or `unavailable`. **Unavailable only while no table has ever loaded**: a failed refresh keeps the last good table and the status stays available (user, 2026-10-24). Initials are asked for only when `makesTheTable` is true, which requires the table to be available. On game over: available shows the list; unavailable shows "High-score table unavailable"; unknown shows no prompt, no list and no table line. The title shows the list only while the table is available. | Accepted (user) | The game plays fully without the table (ADR-008, OUT-12) |
| DDD-10 | Blocked initials: the rules refuse the signing, keep the entry open with the letters kept, and ask the player to change them. The server refuses them too (400 `initials-not-allowed`). | Accepted (user) | An in-game refusal with no round trip (ADR-007) |
| DDD-11 | The network never sits on the frame path. `main.js` hands each outcome to the rules from promise callbacks, between frames. Only `game.js` writes `g`. | Accepted | Responsiveness stays the first quality attribute |
| DDD-12 | **Answers ordered by server listing time.** Every answer that carries rows also carries `listedAt`: the function's `Date.now()` in ms, taken right after its `list` call returns (GET `{ scores, listedAt }`, POST `{ scores, id, listedAt }`). The rules apply rows only if their `listedAt` is ≥ the last applied `listedAt`. Otherwise they ignore the rows, though a signing is still settled from its own answer. A POST's listing always comes after its own write, so a GET whose listing came before that write can never roll the table back. **Accepted edge**: clock skew between function instances (a few ms) can misorder two listings taken within that window; those snapshots are then nearly identical. Send order is not used for ordering. | Accepted (orchestrator, 2026-10-24) | Order by when the server looked, not when the browser asked (ADR-008, OUT-12) |
| DDD-13 | The client adapter's `fetch` and timers (`setTimeout`/`clearTimeout`) are injected by `main.js`. A timeout of exactly 5000 ms aborts a GET or POST. | Accepted (user) | Playwright's clock drives the timeout; `AbortSignal.timeout` would run on real time |
| DDD-14 | Accessibility: a `data-hud="initials"` field while entering, one short live-region update per change of letter or position (at most one per frame), announcements of signing outcomes whenever they arrive, and `aria-current` on the confirmed row in the High scores list. | Accepted (user) | Screen readers hear the chosen letter and the outcome; tests read the highlight from the DOM |
| DDD-15 | An all-time table. A periodic (monthly) table would later be a key-prefix change with no migration. | Accepted (user) | Simplest; what players expect |
| DDD-16 | Local server: keep the `test-board` cookie isolation and delete the emulator directory on exit, SIGINT and SIGTERM, with no start-up sweep. Failure scenarios inject faults with `page.route` on `/api/scores`. Accepted dev-only risk: `BlobsServer` 11.1.6 has no host option, so the emulator listens on every interface, on a random port and behind a random token. | Accepted (user) | Proven green in three engines; a sweep could delete a side-by-side checkout's live directory |
| DDD-17 | Observability: one structured JSON log line per request, with `event`, a `reason` from a fixed list per event (below), `ms`, `keys` (the count of well-formed keys, when listed), `scope` (`site`, `deploy` or `local`), `context` (the raw `context.deploy.context`, or `missing`) and `published` (the raw `context.deploy.published`, or `missing`; added in DEVOPS (user, 2026-10-24) so that DDD-2's published check can be seen). **Never** logged: the error message, a key, the body, an id, initials or an IP. **Nothing escapes the handler** (amended in DEVOPS, review iteration 2): a catch-all around the request handler logs only `scores.error` with the reason `unexpected` and answers 500 `unexpected`, so no request-time error reaches Netlify's log with its message or stack. Module-load errors and runtime timeouts sit outside the handler, and Netlify logs those itself. The risk is low, because no key is on that path: no store has been listed yet. `scripts/serve.mjs` likewise logs only the fixed reason, never the raw error. A unit test makes the store throw an error whose message contains a key, captures **every** console method (`log`, `info`, `warn`, `error`, `debug`, `trace`), and checks that no key or initials reach any of them. | Accepted (user) | Enough to diagnose; a key count above 40 means pruning is falling behind; "scope=deploy on the production site" means context detection broke |
| DDD-18 | Probes: the client's page-load GET is the probe ("wire, probe, use"); the game never refuses to start because of the table. No server probe at cold start. Each catalogued lie has a test (below). Real Netlify is probed by the DEVOPS smoke test. | Accepted (user) | Every dependency the design trusts is checked somewhere |
| DDD-19 | Build gate: the handler's tests run in the `unit` project through the restricted port, over a real `BlobsServer` in Node, with no hand-written fake. A hand-rolled import-scan unit test enforces the five layering rules. | Accepted (user) | A broken function or a layering breach fails the Netlify build |

**Log reasons** (DDD-17), a fixed list per event:

| Event | Reasons |
|---|---|
| `scores.read` | `ok` |
| `scores.signed` | `ok`, `prune-failed` |
| `scores.rejected` | `json-required`, `payload-too-large`, `invalid-signature`, `initials-not-allowed`, `method-not-allowed` |
| `scores.not_saved` | `key-exists` |
| `scores.error` | `store-unavailable`, `put-failed`, `list-failed`, `unexpected` |

**Catalogued lies, each with its test** (DDD-18):

| Lie | How it shows | How the design handles it and checks it |
|---|---|---|
| The emulator lists its own temporary files (`s/.xxxx`) | Junk keys in the listing | The port lists well-formed keys only and can't remove any other. A unit test seeds a junk key and checks the table is unchanged and the junk key survives |
| A write to a key that already exists | The store reports "not modified", with no error | 503 `not-saved` and no second row. A unit test forces the duplicate with an injected clock and id |
| Strong consistency without `uncachedEdgeURL` | The listing throws | 500 `unexpected` (reason `list-failed` or `store-unavailable`), and the client degrades. Covered by the "table unavailable" scenario through `page.route` |
| The deploy context or the `published` flag is missing, spelled differently or not a boolean | `chooseStore` returns `'deploy'` on the published production deploy, so scores would seem to reset at each deploy | A table test of `chooseStore` (the cases are in ADR-005): `production` with `published: true` → site. Everything else → deploy, including `production` with `published` false or missing, `deploy-preview`, `branch-deploy`, `dev`, no `deploy`, no context, and `'Production'`. In production, detected as "scope=deploy on the production site" in the logs: DEVOPS checks a cache-missing production GET's log line after each deploy (K13). The preview's log line shows that `published` is present (`false`) (amended in DEVOPS (user, 2026-10-24)) |
| A deploy store without a deploy ID | `getDeployStore` throws `MissingBlobsEnvironmentError` | 500 `unexpected` (reason `store-unavailable`), never the site store. A unit test runs the entry with a Blobs environment that has no deploy ID |
| A store error message carries a key (and so initials) | Initials leak into the logs | Only the fixed reason is logged. A unit test with a throwing store checks the log |
| Real Netlify lists stale keys right after a write | A false off-table, or a missing row | DEVOPS burst (K11): at least 20 simultaneous POSTs on a throwaway preview whose only change removes the rate-limit rule, so that the rule can't interfere (amended in DEVOPS, review iteration 2). The following GET must equal the expected top 10, and each POST that belongs in it must find its own id in its answer. Only a 429 is inconclusive (the rule wasn't removed), and never a pass. Any other non-200 fails, and no rerun turns it into a pass |
| Real Netlify is slower than the emulator, or cold starts | Budget missed (submit + read < 1 s at p95) | DEVOPS: p95 over at least 30 sequential POST+GET pairs, timed on the client, with the cold start measured as a separate sample |
| `config.rateLimit` isn't honoured on the site's plan | No 429 under a burst | DEVOPS go/no-go on a preview (K14, 10 per 60 s; amended in DEVOPS (user, 2026-10-24)). No-go means no merge to `main`; there is no fallback (rejected: user, 2026-10-24) |
| The bundler doesn't include `src/game/high-scores.js` | The function fails at load | The DEVOPS preview GET and POST |
| A request hangs | No answer | The 5000 ms timeout on injected timers → unconfirmed, or no change to the table. Tested with a delayed `page.route` and the fake clock |
| The clocks of function instances differ | Two listings taken a few ms apart can be misordered by `listedAt` | Accepted edge (DDD-12): the two snapshots are nearly identical, and the next refresh corrects them. A unit test checks that `listedAt` is taken after the listing (injected clock) |

## Wave: DESIGN / [REF] Component decomposition

Contract shapes: **pure** · **bounded-change** (a declared universe and delta) · **unbounded-preservation** · **composition root** / **static** (exempt, with the universe listed).

| Component | Path | Change | Contract shape | Notes |
|---|---|---|---|---|
| Shared high-score rules | `src/game/high-scores.js` | CREATE NEW | pure | Table size 10, alphabet A–Z, length 3, step £50, maximum £9,999,999, signature validity, word filter, and `makesTheTable(table state, deposit)`: status available, deposit above 0, and fewer than 10 rows or a deposit above the 10th (a tie misses). Imports nothing (OUT-10) |
| Rules and state | `src/game/game.js` | EXTEND | bounded-change | Universe: `g` and the outbox. In `g`: the table state `{ status, rows }`, which replaces the skeleton's `highScores`; the last applied `listedAt`; `initials`; the current signing `{ initials, n, status, id, rank }`; and the latest settled outcome `{ n, initials, outcome, rank }`, which the status mirror announces once. Deltas: see the rules operations below. Its table constants move to `high-scores.js` |
| Event vocabulary | `src/game/events.js` | none | pure | `INITIALS_ENTERED` exists, and its detail gains the signing number. `GAME_STARTED` triggers the refresh |
| Loop and wiring | `src/main.js` | EXTEND | composition root | Universe: one load at page load and one per `gameStarted`, one sign per `initialsEntered`, and the outcomes handed to the rules: rows answered (with their `listedAt`) or load failed; signing answered or failed (with the signing number n). Injects `fetch` and the timers into the client |
| High-score table client | `src/platform/leaderboard.js` | EXTEND | bounded-change per call | Exactly one request to `/api/scores` per call. No state between calls. Resolves with the parsed answer, or rejects on a non-OK answer, a network error or the 5000 ms timeout (which aborts the request). The rules learn only OK or not OK: no error code is used (amended in DEVOPS: the fallback was rejected, user, 2026-10-24). Never retries |
| Status mirror | `src/view/status.js` | EXTEND | bounded-change | Reads `g` (pre-existing); this feature widens the reads to the table state and the signing. Writes: the `[data-hud]` fields (plus `initials`), the live region, and the High scores list items (plus `aria-current` on the confirmed row). Announces the chosen letter, the refusal, each settled outcome once when it arrives (in any game state, including a replaced signing's) and "High-score table unavailable" |
| Rendering | `src/view/render.js` | EXTEND | bounded-change | Reads `g` (pre-existing); the reads widen to the table state and the signing. Writes canvas pixels only: the signing line, the refusal and unavailable lines on game over, and the confirmed row highlighted wherever the list is drawn (title attract, game over). Nothing new is drawn during play. The compact game-over layout gets a visual pass (manual, D10) |
| Page | `index.html` | EXTEND | static | One field, `data-hud="initials"` |
| Score API entry | `netlify/functions/scores.mjs` (default export, `config`) | EXTEND | composition root | Universe: `chooseStore` on the request's `Context`, then `getStore` or `getDeployStore`; the restricted port built around that store; routing by method (GET gets `list` only); `config.path` and `config.rateLimit`; the clock, id source and logger |
| Restricted table-store port | `netlify/functions/scores.mjs` (factory, also used by `scripts/serve.mjs`) | EXTEND | bounded-change | Universe: keys under `s/` in one store. `list` returns well-formed keys only. `putIfNew` and `remove` act on one well-formed key and refuse any other. No `deleteAll` and no other store method |
| Score API handler | `netlify/functions/scores.mjs` | EXTEND | bounded-change | See the handler delta below (OUT-7, OUT-8, OUT-9) |
| Key codec, ranking, prune plan, `chooseStore` | `netlify/functions/scores.mjs` | EXTEND | pure | Encode and decode a key from score, time, initials and id; rank well-formed keys; choose at most 5 keys ranked 11th or lower once there are more than 20; `chooseStore(context)` → `'site'` or `'deploy'`. Exported for unit tests |
| Local server | `scripts/serve.mjs` | EXTEND | composition root | Universe: the static files, the Blobs emulator and its temp directory (deleted on exit, SIGINT and SIGTERM), and one store per `test-board` cookie, wrapped in the same restricted port (scope `local`). It stops adding `no-store` to `/api/scores`, because the function now sets it |
| Layering test | `tests/unit/` (import scan) | CREATE NEW | pure (test) | Five rules (see [Wave decisions summary](#wave-design--ref-wave-decisions-summary)). It must match `import … from '…'`, bare `import '…'`, `export … from '…'` and dynamic `import('…')` |

### Handler delta (`/api/scores`)

Universe: the well-formed keys under `s/` in the store chosen for the request, reached only through the restricted port. A well-formed key matches `^s/\d{7}-\d{15}-[A-Z]{3}-[a-z0-9]+$`. The tests check deltas by listing the store before and after, on the real emulator.

| Request | Store delta | Answer |
|---|---|---|
| GET | none (`list` only) | 200 `{ scores, listedAt }`: at most 10, best first; `listedAt` is taken right after the listing returns |
| GET, the listing throws | none | 500 `unexpected` (`list-failed`) |
| POST, content type not `application/json` | none | 415 `json-required` |
| POST, body over 1 KB (read with a byte cap; `Content-Length` isn't trusted) | none | 413 `payload-too-large` |
| POST, body not JSON, extra or missing fields, or invalid initials or score | none | 400 `invalid-signature` |
| POST, initials on the word filter | none | 400 `initials-not-allowed` |
| Any other method | none | 405 with `Allow: GET, POST` |
| POST, valid, the key already exists | none | 503 `not-saved` |
| POST, valid, saved | + 1 well-formed key. Then the prune plan: − k keys, where k ≤ 5 and k = 0 unless there are more than 20 well-formed keys. Each deleted key is ranked 11th or lower in that listing, possibly the new key itself. Pruning is best-effort: a store failure during `remove` is caught and logged (`prune-failed`), and the answer is still 200 | 200 `{ scores, id, listedAt }`, from the listing taken after the write; `listedAt` is taken right after that listing returns |
| POST, the write throws | 0 or + 1 key (unknown) | 500 `unexpected` (`put-failed`) |
| POST, saved, then the listing throws | + 1 key | 500 `unexpected` (`list-failed`). The client shows unconfirmed, and the next refresh shows the row (ADR-008) |
| The port refuses a key that isn't well-formed (a bug) | none, or + 1 key if the refusal comes during pruning | 500 `unexpected` (`unexpected`), never swallowed as `prune-failed` |
| The store can't be opened (for example, no deploy ID) | none | 500 `unexpected` (`store-unavailable`) |
| Over the rate limit, 10 per 60 s per IP and domain (Netlify only) | none; the function doesn't run | 429 with Netlify's body and headers, without a `no-store` guarantee. Not reproducible locally: DISTILL writes no 429 scenario |

Every answer **from the function** carries a JSON body and `Netlify-Vary: query=table`. A GET 200 is cached for 15 s at the CDN, and every other answer is `Cache-Control: no-store` (amended in DEVOPS (user, 2026-10-24); the headers are in DDD-6).

### Rules operations (`src/game/game.js`)

| Operation | Delta |
|---|---|
| Game over | As before, plus the initials entry opens (letters A A A, the first letter current) only if `makesTheTable(table state, deposit)` is true. What game over shows, by table status: **available**, the list (the confirmed row highlighted, if any); **unavailable**, "High-score table unavailable"; **unknown**, no prompt, no list and no table line (DISTILL may add neutral wording). The game-over messages only describe a signing made in this game; an earlier signing shows only as its highlighted row |
| Third Enter, initials allowed | The entry closes. A new signing `{ initials, n, pending }` becomes the current signing and replaces the earlier one, including its highlight. A replaced signing that is still pending keeps waiting for its answer, whose outcome will only be announced (see "Answer for a replaced signing"). Emits `initialsEntered { initials, score, signing: n }` |
| Third Enter, initials on the word filter | No signing and no event. The entry stays open with the letters kept, and a refusal is shown until the next key. Which letter becomes current is DISTILL's (default: the first) |
| Rows answered (from a load, or the rows of a POST answer, with `listedAt` t) | Applied only if t ≥ the last applied `listedAt`: rows replaced, status available, last applied = t. Otherwise the rows are ignored. A confirmed row that the new rows no longer contain (pruned, or pushed down by newer signings) loses its highlight, and the signing stays confirmed |
| Load failed | If the status is unknown: unavailable. Otherwise nothing (unavailable only while no table has ever loaded; a failed refresh keeps the last good table) |
| Signing answered (signing n, rows, id, `listedAt`) | The rows as in "Rows answered". Then, if n is the current signing and it is pending: confirmed, with the rank taken from the id's position in this answer's own rows, or off-table if the id isn't in them. The settled outcome is recorded for the status mirror. This settles the signing even when its rows are too old to apply |
| Signing failed (signing n: a non-OK answer, a network error or the 5000 ms timeout) | If n is the current signing and it is pending: unconfirmed. The settled outcome is recorded for the status mirror. The table state is unchanged |
| Answer for a replaced signing (n older than the current signing) | Its rows apply as in "Rows answered". Its outcome (confirmed with its rank from its own rows, off-table or unconfirmed) is recorded once for the status mirror to announce. The current signing's status and highlight don't change |
| New game (Enter) | `initials` cleared, as today. The signing is **kept** until the next signing, and the table state is unchanged |

### Signing-status lifecycle (OUT-11)

| From | Trigger | To | Canvas (game over only) and status mirror (user-approved defaults; final wording is DISTILL's) |
|---|---|---|---|
| no entry | Game over, and `makesTheTable` is true | entering | "New high score! Enter your initials: Up and Down change the letter, Enter takes it." |
| entering | Up/Down | entering | Initials field and announcement, for example "F A A, letter 2 of 3" |
| entering | Third Enter, blocked word | entering | "Those initials aren't allowed. Change a letter." |
| entering | Third Enter, allowed | pending (n), replacing any earlier signing as the current one | "Signing FAB…" |
| pending (n) | Answer for n; the id is at rank r in its rows | confirmed | "Signed FAB, #r". The row is highlighted (canvas green, DOM `aria-current`) wherever the list is shown, until the next signing or until the row leaves the shown table (pruned, or pushed down by newer signings). The signing stays confirmed when its highlight goes |
| pending (n) | Answer for n; the id is not in its rows | off-table | "The table filled up before FAB arrived." |
| pending (n) | Non-OK answer, network error or 5000 ms timeout for n | unconfirmed | "Couldn't confirm FAB's signing." (It may have been saved; the next refresh shows the row, without a highlight) |
| any status of the current signing n | Answer or failure for a replaced signing m (older than n) | unchanged | m's outcome is announced once by the status mirror ("Signed ABC, #r", off-table or "Couldn't confirm ABC's signing"). Its rows apply under DDD-12. n's status and highlight don't change |
| pending, confirmed, off-table, unconfirmed | Enter (new game) | unchanged | An outcome that arrives during play is announced by the status mirror only. Nothing is drawn on the canvas mid-game |

### Table status (OUT-12)

The table state is `{ status, rows }`:
- **`unknown`**: from page load until the first answer. A load in flight changes nothing.
- **`available`**: after a successful load or POST answer, whose rows apply only if their `listedAt` is ≥ the last applied `listedAt` (DDD-12).
- **`unavailable`**: only while no table has ever loaded, after a failed load.

Once available, the status stays available. A failed refresh keeps the last good table, and a player who makes it is still asked for initials (a signing that can't get through then ends as unconfirmed). A failed signing doesn't change the table state. The title's attract mode shows the list only while the table is available and has rows.

## Wave: DESIGN / [REF] Driving ports

- **Keyboard in the page**: as before, plus Up/Down/Enter while the initials are entered (presses of the same key within one frame count once). Enter restarts from every signing status.
- **Page load**: settings and the best-score store, as before, plus the first table load (the client's probe).
- **Window `blur` and document `visibilitychange`**: unchanged. An answer that arrives while paused or hidden is still applied between frames.
- **Server, HTTP `/api/scores`** (GET, POST): through Netlify in production, and through `scripts/serve.mjs` locally and in tests.

## Wave: DESIGN / [REF] Driven ports + adapters

| Port | Adapter | In acceptance tests |
|---|---|---|
| Shared high-score table (client) | `src/platform/leaderboard.js` over injected `fetch` and timers | Real: the real function and the real Blobs client on the emulator, through `scripts/serve.mjs`. Faults (abort, 503, delay with the fake clock) come from `page.route` on `/api/scores` |
| Restricted table-store port (server) | Built by the composition roots around a `@netlify/blobs` `Store`. In production: `getStore` or `getDeployStore`, chosen by `chooseStore`. Locally: `getStore` per cookie. The read path gets `list` only; the sign path gets `list`, `putIfNew` and `remove` | The real `BlobsServer` emulator under the port, in acceptance and unit tests (DDD-19). Real Netlify Blobs only in the DEVOPS smoke test |
| Clock and id source (server) | `Date.now` (for the key's time and `listedAt`) and `randomUUID`, injected into the handler | Fixed values in unit tests, to force the duplicate-key path and to check that `listedAt` is taken after the listing |
| Logger (server) | `console` (Netlify function logs) | Captured in unit tests (fixed reasons, no initials) |
| Accessibility tree | `src/view/status.js` | Real, asserted on (the High scores list, `aria-current`, `data-hud="initials"`, the live region) |
| Screen | `src/view/render.js` | Real, not asserted on (D10 manual) |
| Persistence (local best, settings) | `src/platform/storage.js` | Unchanged |

**Contract tests for external integrations** (for platform-architect): Netlify Blobs is consumed through `@netlify/blobs`. Consumer-driven contracts (Pact) don't apply, because the provider won't verify them. The proportionate substitute: the client version is pinned exactly (11.1.6), the handler is tested on the vendor's own emulator, and the DEVOPS smoke test runs against real Blobs.

## Wave: DESIGN / [REF] Technology choices

- Browser: JavaScript ES2022 modules, no bundler, and still **no runtime dependencies**. Uses `fetch` and `AbortController`, with injected timers (5000 ms timeout).
- Server: one Netlify Function v2 (`Request, Context → Response`) on Node 22, with `config.path` and `config.rateLimit`.
- `@netlify/blobs` **11.1.6, MIT**, pinned exactly in `package.json`: the project's only runtime dependency, used by the function only. `BlobsServer` (`@netlify/blobs/server`) is the local and test emulator.
- No new devDependencies. The layering test is hand-rolled.
- Rejected: an external hosted database, Pact, dependency-cruiser (for now) and third-party monitoring (proprietary and paid).

## Wave: DESIGN / [REF] Decisions table

| ID | Decision |
|---|---|
| DDD-1 | One blob key per score, strong listing, well-formed keys only, bounded best-effort pruning |
| DDD-2 | Pure `chooseStore`; site store only on an explicit `'production'` that is the published deploy (amended in DEVOPS); a missing deploy ID is a 500 |
| DDD-3 | Shared pure `src/game/high-scores.js`; `makesTheTable` is the browser's |
| DDD-4 | Restricted table-store port built by the composition roots; GET gets `list` only |
| DDD-5 | 415, 413, 400 validation; rate limit of 10 per 60 s (DEVOPS go/no-go; amended in DEVOPS); word filter; owner moderation |
| DDD-6 | JSON on every answer from the function; a GET 200 cached for 15 s at the CDN, everything else `no-store` (amended in DEVOPS); 429 is Netlify's |
| DDD-7 | Refresh on page load, on game start and from the POST answer |
| DDD-8 | Signing pending → confirmed, off-table or unconfirmed; kept across games until the next signing; a replaced signing's outcome is announced once |
| DDD-9 | One table state `{ status, rows }`; unavailable only while no table has ever loaded |
| DDD-10 | Blocked initials refused in the game and by the server |
| DDD-11 | The network never sits on the frame path |
| DDD-12 | Answers ordered by server listing time: rows apply only if `listedAt` ≥ the last applied one |
| DDD-13 | `fetch` and timers injected; 5000 ms timeout |
| DDD-14 | `data-hud="initials"`, live-region updates, outcome announcements, `aria-current` |
| DDD-15 | All-time table |
| DDD-16 | `test-board` cookie, temp-directory cleanup on exit, `page.route` faults; emulator on every interface accepted for dev |
| DDD-17 | Structured logs with fixed reasons; scope, raw context and raw `published`; never message, key, body, id, initials or IP; a catch-all so that nothing escapes the handler (amended in DEVOPS) |
| DDD-18 | Probes: page-load GET, catalogued lies, DEVOPS smoke test |
| DDD-19 | Handler tests through the port on the real emulator in `unit`; import-scan layering test |

## Wave: DESIGN / [REF] Reuse Analysis

| Existing component | File | Overlap | Decision | Contract shape | Justification |
|---|---|---|---|---|---|
| Rules and state | `src/game/game.js` | Qualification, initials entry, `signed`, `applyLeaderboard` (skeleton) | EXTEND | bounded-change | Already the only writer of `g`. Gains the table state, the `listedAt` check, the signing lifecycle, the settled-outcome notice and the refusal |
| Event vocabulary | `src/game/events.js` | `INITIALS_ENTERED`, `GAME_STARTED` | NONE | pure | The existing events carry what is needed; the detail grows |
| Loop and wiring | `src/main.js` | Already wires the table | EXTEND | composition root | Adds the refresh on game start, the failure outcomes and timer injection |
| High-score table client | `src/platform/leaderboard.js` | GET and POST (skeleton) | EXTEND | bounded-change per call | Adds the timeout and abort; the reject-on-non-OK contract is unchanged |
| Storage | `src/platform/storage.js` | Local best | NONE | n/a | The local best stays (user). Caching the table offline: rejected, not needed |
| Status mirror | `src/view/status.js` | Game-over announcement, the High scores list | EXTEND | bounded-change | Announcing is its job; adds one field, outcome announcements and `aria-current` |
| Rendering | `src/view/render.js` | Table, initials, highlight | EXTEND | bounded-change | A few lines of text in existing layouts; the highlight already exists |
| Page | `index.html` | The list exists | EXTEND | static | One `data-hud` field |
| Theme | `src/theme/theme.js` | Hurdle values imply the £50 step | NONE | pure | A unit test checks every value and bonus is a multiple of the step from `high-scores.js` |
| Config | `src/game/config.js` | Pure constants | NONE (challenged) | pure | Rejected as the home for table rules: it would mix canvas geometry with them, and the function would carry the geometry |
| Score function | `netlify/functions/scores.mjs` | GET, POST, codec, prune (skeleton) | EXTEND | composition root + bounded-change + pure | Split into roles within the file (entry, port factory, handler, pure helpers); its constants come from `high-scores.js` |
| (none) | `src/game/high-scores.js` | Constants duplicated in `game.js` and `scores.mjs` | CREATE NEW | pure | `game.js` can't be imported server side (module-level `g`, theme and shield imports), and only `src/` reaches the browser |
| Local server | `scripts/serve.mjs` | Mounts the handler on the emulator, cookie boards | EXTEND | composition root | Adds temp-directory cleanup and the restricted port; no longer sets the API's cache header |
| Package manifest | `package.json` | `@netlify/blobs` 11.1.6 added by the skeleton | EXTEND (done in the skeleton) | static | The first runtime dependency, pinned exactly; server side only |
| Netlify config | `netlify.toml` | Build, headers | EXTEND (DEVOPS) | static | Bundler pin and anything for `/api/*` are DEVOPS's; DESIGN changes nothing here |
| Build | `scripts/build.mjs` | — | NONE | n/a | Functions are not part of `dist/`; Netlify bundles them from the repo |
| (none) | `tests/unit/` import-scan test | No layering check, and no import-parsing helper in `tests/unit/support/` (only `fresh-game.js`, `seed.js`, `fake-audio.js`) | CREATE NEW | pure (test) | Rules without enforcement erode; five rules don't justify a new devDependency |

**Accepted cross-boundary import**: `netlify/functions/scores.mjs` → `src/game/high-scores.js` (ADR-006). Nothing else in `netlify/**` imports from `src/`.

## Wave: DESIGN / [REF] Open questions

Left deliberately to later waves:
- **DEVOPS**:
  - **Do not push `worktree-leaderboard-spike` until ADR-005 is implemented.** The skeleton writes to the site-wide store from any branch deploy.
  - **Smoke test on a deploy preview**:
    - a concurrent burst of at least 20 simultaneous POSTs, whose following GET equals the expected top 10 (this catches a false off-table from a stale listing)
    - p95 over at least 30 sequential POST+GET pairs, timed on the client, with the cold start as a separate sample (budget: < 1 s)
    - the preview's ids absent from the production GET
    - the bundler including `src/game/high-scores.js`
    - after each production deploy, one production GET whose log line shows `scope=site`
  - **Go/no-go on `config.rateLimit`** for the site's plan (and the exact numbers, about 60 per 60 s). Check the ADR-007 worst-case operation counts against the plan's function and Blobs allowances. *(Answered in DEVOPS: 10 per 60 s (user, 2026-10-24); a no-go means no merge to `main`, because the fallback was rejected (user, 2026-10-24). See "Wave: DEVOPS / [REF] Pre-requisites".)*
  - Where the function logs are read, and how long the plan keeps them.
  - The production store has no backup: accepted loss (a lost table starts again empty). Record it.
  - The owner guide to deleting a row (Netlify CLI or the Blobs UI).
  - Pinning the functions bundler in `netlify.toml`.
  - Rewriting the brief's "Platform and Delivery": observability, the function, the rate limit, and rollback with a persistent store. Also replace "There is no server and no personal data" with: "the game stores 3 initials, a score and a time per signature; the platform sees client IPs for rate limiting; we log none".
- **DISTILL**:
  - the exact wording of every message, including any neutral line for an unknown table on game over
  - which letter becomes current after a refusal (default: the first)
  - scenarios for:
    - unavailable
    - unconfirmed (abort, 503 and timeout)
    - off-table
    - a late answer: an older `listedAt` ignored, and an answer after a new game has started
    - an answer for a replaced signing, announced once with the current signing and its highlight unchanged
    - a confirmed row pruned or pushed off the table, which loses its highlight
    - the refusal
    - the confirmed row kept highlighted on the title
    - no 429 scenario (Netlify only)
  - the fault-injection row in the ATDD policy (`page.route` on `/api/scores`)
  - the announcement cadence for fast Up/Down presses
- **DELIVER**:
  - the word-filter list contents (short, public, reviewed by the owner)
  - the compact game-over layout visual pass (manual, D10)
  - the import-scan test
  - the `chooseStore` table test
  - the log-leak test
  - the step-multiple unit test against the theme
  - adding `src/platform/leaderboard.js`, `src/game/high-scores.js` and `netlify/functions/scores.mjs` to the README file table
- **Product, later**: a monthly table, as a key-prefix change (DDD-15).

## Wave: DESIGN / [REF] Changed assumptions

Originals quoted verbatim:
- `docs/product/architecture/brief.md` (Application Architecture): "**Security and exposure**: client-only, with no personal data and no network calls besides the font." → The game also calls its own `/api/scores`. A signature keeps 3 initials, a score and a time. The platform sees client IPs (for rate limiting), and we log none. Production sets no cookies.
- `docs/product/architecture/brief.md` (quality attribute 3): "**Maintainability**: theme, art and sound recipes are data; one module per concern; one event vocabulary (`game/events.js`); no runtime dependencies." → No runtime dependencies in the browser; the function's only dependency is `@netlify/blobs`.
- `docs/product/architecture/brief.md` (Platform and Delivery): "**Observability**: none. There is no server and no personal data; KPIs come from the playtest, the test suite and `scripts/measure-performance.mjs`." → Out of date: there is now a function with structured logs (DDD-17), and the data statement above. Flagged in the brief; DEVOPS rewrites it.
- `docs/product/architecture/brief.md` (containers): `Container(server, "Static file server", "Node 22, scripts/serve.mjs", "Serves index.html and src/ ES modules (dev and tests)")` → Now "Static hosting" (the Netlify CDN in production, `scripts/serve.mjs` locally), and `scripts/serve.mjs` also mounts the Score API on the Blobs emulator.
- `CLAUDE.md`: "Vanilla Canvas2D + ES modules, no runtime dependencies, no bundler" → no runtime dependencies in the browser; the function uses `@netlify/blobs`.
- `README.md`: "Plain Canvas2D and ES modules, with no runtime dependencies and no bundler (`npm run build` only copies the files to publish)." → the same change.
- `docs/feature/rightmove-invaders-leaderboard/spike/wave-decisions.md`: "\"Signed FAB.\" is announced before the server answers, even if the signing then fails." → Reversed: pending, then the real outcome (DDD-8).
- `netlify/functions/scores.mjs` (skeleton): "export default req => handleScores(req, getStore({ name: 'leaderboard', consistency: 'strong' }));" → The store is chosen by `chooseStore` (DDD-2) and reached only through the restricted port (DDD-4).
- `src/main.js` (skeleton comment): "a signing that doesn't arrive is simply not shown." → An unanswered signing is shown as unconfirmed (DDD-8).
- `src/game/game.js` (skeleton comment): "signed: what this game signed, { initials, id }; id stays null until the table has the row." and `startGame`'s "g.signed = null;" → The signing is the latest one, kept across games until the next signing (DDD-8).
- `docs/feature/rightmove-invaders-sound/feature-delta.md` (Technology choices): "JavaScript ES2022 modules, no bundler, no runtime dependencies." → Still true of the browser, not of the project.
- **Revision 2** (after the review):
  - the restricted table-store port (DDD-4)
  - one table state (DDD-9) and request numbers (DDD-12)
  - the signing kept across games, and "Couldn't confirm" in place of "wasn't saved" (DDD-8)
  - 413 for oversized bodies; 429 is Netlify's only (DDD-5, DDD-6)
  - `chooseStore`, with a missing deploy ID as a 500 (DDD-2)
  - fixed log reasons (DDD-17)
  - best-effort pruning (DDD-1)
  - five layering rules
  - DEVOPS smoke-test and rate-limit criteria
  - status "failed" renamed to "unconfirmed"
- **Revision 3** (after the re-review):
  - request numbers replaced by ordering on the server's listing time, `listedAt` (DDD-12)
  - a replaced signing's outcome announced once (DDD-8)
  - a confirmed row that leaves the table loses its highlight
  - a GET listing failure is a 500
  - a port refusal is a 500, never swallowed by pruning (DDD-4)
  - the paused outcome and the switch's time to take effect (ADR-007 fallback; both removed when the user rejected the fallback in DEVOPS, 2026-10-24)
  - "as old as the last successful refresh" (DDD-7)

## Wave: DESIGN / [REF] Wave decisions summary

- **Pattern**: a modular monolith with ports and adapters (browser SPA), plus one thin server-side adapter (a Netlify Function) around shared pure rules and a restricted store port. **Paradigm**: OOP (`CLAUDE.md`).
- **New**: `src/game/high-scores.js` and the import-scan unit test. **Extended**: `game.js`, `main.js`, `platform/leaderboard.js`, `status.js`, `render.js`, `index.html`, `netlify/functions/scores.mjs`, `scripts/serve.mjs`.
- **Constraints**:
  - the network never sits on the frame path, and only `game.js` writes `g`
  - only the published deploy of an explicit `'production'` context uses the site-wide store (amended in DEVOPS (user, 2026-10-24))
  - the handler reaches the store only through the restricted port
  - one blob key per score, with well-formed keys only and bounded best-effort pruning
  - table rows apply in server listing order (`listedAt`)
  - the function sets its own cache headers: a GET 200 is cached for 15 s at the CDN, and everything else is `no-store` (amended in DEVOPS (user, 2026-10-24))
  - no POST retry
  - the client's timers are injected (5000 ms)
  - logs carry fixed reasons and nothing about the player
- **Layering rules** (import-scan unit test, in the build gate; it matches `import … from`, bare `import '…'`, `export … from` and `import()`):
  1. `game/` imports only from `game/` and `theme/`.
  2. `theme/` imports nothing.
  3. `game/high-scores.js` imports nothing.
  4. `src/**` never imports `netlify/**` or `@netlify/*`.
  5. `netlify/**` imports only `src/game/high-scores.js` from `src/`.
- **Outcomes**: OUT-7 (read), OUT-8 (sign), OUT-9 (no lost signature), OUT-10 (shared validity and browser qualification), OUT-11 (signing lifecycle), OUT-12 (table status), OUT-13 (store by deploy context).
- **SSOT**: [brief](../../product/architecture/brief.md), ADR-004…008, [outcomes registry](../../product/outcomes/registry.yaml).
- **Handoff**: DEVOPS (preview smoke test, Platform section), then DISTILL (scenarios and policy row above).

---

## Wave: DEVOPS / [REF] Environment matrix

Run on 2026-10-24, after DESIGN revision 3 and before DISTILL (nw-platform-architect, lean). Revised the same day after the platform-architect review, iteration 2. The user's decisions are in the [Wave decisions summary](#wave-devops--ref-wave-decisions-summary). Machine-readable version: [environments.yaml](environments.yaml). Amendments to DESIGN: [devops/upstream-changes.md](devops/upstream-changes.md). Config: [netlify.toml](../../../netlify.toml). Nothing was pushed, deployed, created or linked.

| Environment | URL | Runtime | High-score store | Deploy trigger | Preconditions |
|---|---|---|---|---|---|
| production | https://maketherightmove.fabiodamico.xyz, and the site's `<site>.netlify.app` | Netlify CDN + Functions v2 (Node 22), legacy Free plan | The site-wide store `leaderboard` (`getStore`, strong), written only by the **published** deploy (`published === true`). Its region is `us-east-2`, the default for site-wide stores. It survives deploys and rollbacks, and has no backup. Log `scope=site`, `published=true` | push to `main` | ADR-005 implemented; go on K10–K14; kill switch armed on the merge day; Blobs limits checked; the user's decision on the account |
| deploy-preview | `https://deploy-preview-<n>--<site>.netlify.app` | same | A deploy store `leaderboard` (`getDeployStore`), empty at each deploy. It follows its deploy on rollback and is deleted with it. Log `scope=deploy`, `published=false` | pull request | ADR-005 implemented; the user's OK to push the branch |
| branch-deploy | `https://<branch>--<site>.netlify.app` | same | as deploy-preview | branch push, where branch deploys are on | as deploy-preview |
| deploy permalinks | `https://<deploy ID>--<site>.netlify.app`, one per successful deploy | same | Whatever its deploy chooses. The published production deploy's permalink **is** the published deploy, so it writes the site store. Every other permalink writes its own deploy's store | every successful deploy | Each keeps its own copy of the function and its own rate-limit counter until the deploy is deleted. On Free that happens after 30 days, except for the published deploy, the latest production deploy and the latest deploy of each branch (deploy docs) |
| local | http://localhost:4173 (`PORT` moves it) | Node 22, `npm start` (`scripts/serve.mjs`) | The `BlobsServer` emulator in a temp directory, deleted on exit. One store per `test-board` cookie (`leaderboard-<board>`, else `leaderboard-local`). Log `scope=local` | manual | `npm install`; `npx playwright install` for the browser projects |
| `netlify dev` | the Netlify CLI's local server | Netlify CLI | **Unsupported.** The context is `dev`, so `chooseStore` gives `'deploy'`. `getDeployStore` then either throws without a deploy ID (500 `unexpected`) or opens the CLI's local sandbox store. Either way no production data is reachable: the Blobs docs say "You cannot read production data during local development" | manual | Use `npm start` instead |

Blobs limits checked (Blobs docs):
- **Store names**: at most 64 bytes, with no `/` or `:`. The longest is `leaderboard-` plus a 40-character board, 52 bytes.
- **Keys**: at most 600 bytes. A score key is 62.

Platform coverage is unchanged from the sound feature (desktop Chrome, Edge, Firefox and Safari). There are no secrets and no environment variables beyond `NODE_VERSION`.

## Wave: DEVOPS / [REF] CI/CD pipeline outline

This is the sound feature's pipeline, plus the two stages Netlify adds for a function. No GitHub Actions and no containers (user).

| Stage | Command or owner | Gate type | What it checks |
|---|---|---|---|
| Install | `npm install` (Netlify) | blocking | `@netlify/blobs` 11.1.6 (exact) and the devDependencies; no browsers |
| Test gate | `bddgen && playwright test --project=unit --project=in-memory` | blocking | 46 tests today. After DELIVER, also:<br>• the handler through the port on a real `BlobsServer` (DDD-19)<br>• the import scan and `chooseStore`<br>• the log-leak test, which captures every console method (DDD-17), and the handler's catch-all<br>• a contract test of the exported `config` (`path`, `rateLimit`) and of the header set per answer, so a typo fails the build |
| Build | `node scripts/build.mjs` | blocking | `dist/` = `index.html` + `src/`. The function is not in `dist/` |
| Functions bundling | Netlify, `node_bundler = "esbuild"` (`netlify.toml`) | blocking | Bundles `netlify/functions/scores.mjs` with `src/game/high-scores.js` and `@netlify/blobs` inlined. Files imported statically are bundled without `included_files` (Netlify file-based config docs). Only the bundler family is pinned: the esbuild version is whatever Netlify's build image ships |
| Post-processing | Netlify | advisory: an invalid rule logs an error but doesn't fail the deploy, so the site **deploys without the limit** | Validates `config.rateLimit`; a valid rule is listed in the deploy log under this stage. Only that log line and K14 would show a missing limit, so read it on every deploy that changes `config` |
| Publish | Netlify | atomic | The files, the function and the rate-limit rule switch together |
| Preview smoke test | `node scripts/smoke-leaderboard.mjs` (spec below; DELIVER writes it), on the shipped preview, plus a throwaway preview for the burst | hard: a manual go/no-go before the first merge, and again on the release-check triggers | K10–K14 |
| Production check | `node scripts/smoke-leaderboard.mjs --production <URL>`, then the log line | hard, manual, after every production deploy and every rollback | K13 |

Checked here:
- `PORT=4174 CI=1 npm run build`: 46 passed, 22 files in `dist/` (then deleted).
- `netlify.toml` parses with the new `[functions]` table.

Local gates: none, as before. `npm test` stays the only run of the browser projects.

### Preview smoke test (`scripts/smoke-leaderboard.mjs`), spec

This is a spec only. DELIVER implements it and runs it once ADR-005 and the amended DDD-5, DDD-6 and DDD-17 are implemented, and only with the user's OK to push. The script has four modes:

| Mode | Command | Target | Steps | KPIs |
|---|---|---|---|---|
| Preview run | `--site <name> --preview <URL> [--production <URL>] [--permalink <URL>]` | a preview or branch deploy of the shipped config | 1, 4–10 | K10, K12, K14 |
| Burst run | `--site <name> --burst <URL>` | a **throwaway** preview, whose only change removes the rate-limit rule | 1–3 | K11 |
| Production mode | `--production <URL>` | the production custom domain; **GET only** | P1–P3 | K13 |
| Unpublished check | `--site <name> --unpublished <permalink> --production <URL>`, with `NETLIFY_AUTH_TOKEN` and `--site-id <ID>` for the API route, or interactive otherwise | the permalink of an older, unpublished production deploy | U1–U3 | K13 |

- **Runtime**: Node 22 `fetch`, no dependencies. It imports `src/game/high-scores.js` for valid and blocked initials. It prints one JSON summary. It exits 1 if a hard check fails, and 2 if the write guard refuses.
- **Write guard**: checked before any POST, in every mode. A refusal writes nothing.
  1. **Host**: a POST goes only to `deploy-preview-<n>--<site>.netlify.app` or `<branch>--<site>.netlify.app`, with `<site>` taken from `--site`.
     - Refused: the custom domain; `<site>.netlify.app`; the production branch's subdomain (`main--<site>.netlify.app`); any host whose prefix is a 24-character deploy ID (a permalink); and any other host.
     - The one exception is the unpublished check, under rule 2.
  2. **Unpublished check**: the host must be a permalink, `<24-character deploy ID>--<site>.netlify.app`. The guard never relies on an ID typed on the command line. It learns the published deploy's ID in one of two ways, and refuses if that ID equals the permalink's, or if it can't get it:
     - **API (preferred)**: with `NETLIFY_AUTH_TOKEN` in the environment and `--site-id`, the script reads `published_deploy.id` from `GET https://api.netlify.com/api/v1/sites/<site ID>`. A failed or empty answer refuses. The token is the owner's personal access token: it lives only in the owner's shell, and is never logged, written or committed. DELIVER confirms the field name against Netlify's API reference before relying on it.
     - **Interactive**: without a token, the script prints the target permalink's deploy ID, and asks the owner to type back the published deploy's ID, read in Netlify → Deploys. It refuses unless the answer is a 24-character deploy ID that differs from the target's.
  3. **First GET**: the run's first request to the host is a GET. A POST is allowed only if that GET answered 200 with an empty table (`scores: []`). The production table has rows, so it never passes.
- **Pacing**: every step stays under 10 requests per 60 s per hostname, except the deliberate over-limit runs: step 2 (with no rule), 8a, 8b and 9. A 61 s wait follows each of them.
- **Cost**: about 20 minutes for the preview run, and 2 for the burst run.
  - At most about 1,600 invocations (1.3% of the month), if the rule didn't hold at all. About 400 are expected.
  - A 429 never reaches the function.
- **The throwaway preview** for the burst run:
  - It is built from a branch such as `smoke/no-rate-limit`, made from the candidate commit, whose only change removes `rateLimit`. Pushing it needs the user's OK, like any push.
  - It has no limit while it exists, so delete its deploy and its branch right after the run.
  - There, K11 measures Blobs under concurrency, not the rule. The rule is K14's, on the shipped config.

| # | Step | Pass | KPI |
|---|---|---|---|
| 1 | The deploy's first request (preview run and burst run): GET `/api/scores`, timed | 200 with `{ scores: [], listedAt }`: the function loaded, with its import of `high-scores.js`, and opened an empty deploy store. This is the write guard's rule 3. The time is the **cold-start sample**, kept out of the p95 | K10 (recorded), K12 |
| 2 | Burst run only, after step 1 passed: 20 simultaneous POSTs, with distinct scores (multiples of £50) and valid initials | All 200, each with its own id. Each POST whose score is in the true top 10 of the 20 finds its own id in its answer.<br>• **Only a 429 is inconclusive**: it means the rule wasn't removed. Fix the throwaway branch and rerun on a fresh throwaway preview. An inconclusive run is never a pass.<br>• **Any other non-200** (503 `not-saved`, 500 and so on) **fails K11**. Record that first result: no rerun can turn it into a pass | K11 |
| 3 | Burst run only: wait 61 s, then GET `/api/scores?table=<random>` (a cache miss by design) | `scores` equals the expected top 10 of the burst, and `listedAt` comes after the burst | K11 |
| 4 | After step 1 passed: one POST with initials on the word filter | 400 `initials-not-allowed`. Only the bundled `high-scores.js` can give it | K12 |
| 5 | Within 15 s: GET `/api/scores` twice, then `?x=<random>`, then `?table=<random>` | The 2nd and 3rd answers have a `Cache-Status` that shows a hit, and the 1st one's `listedAt`. The 4th misses, with a newer `listedAt`. **A missing `Cache-Status` fails the step**: it is not a vacuous pass | K14 |
| 6 | After step 1 passed: wait 61 s, then 30 pairs, one every 13 s: a POST, then a GET `?table=<random>`, each pair timed on the client | p95 (the 29th of 30) of POST + GET < 1000 ms | K10 |
| 7 | With `--production`: one production GET (read only) | None of the preview's ids (from step 6) is in it. If production has no function yet (404), the step reports "skipped", and step 1's empty table plus the preview's log line are the evidence | K12 |
| 8a | Wait 61 s, then GET `?table=<random>` at 2 a second for 125 s (250 requests). Record the send rate actually achieved | **Below 2 a second achieved, the step is inconclusive**, never a pass: rerun from a faster machine or connection.<br>Pass: a 429 within 16 s of the first request, and **at most 30 accepted** in each full 60 s window (the limit plus the documented 10 s lag at this rate).<br>More than 20 in a window is not a fail, but it triggers a documented recompute of the abuse table before the merge | K14 (go/no-go) |
| 8b | Wait 61 s, then GET `?table=<random>` at 20 a second for 60 s (1,200 requests); wait 61 s; then one GET. Record the send rate actually achieved | **Below 20 a second achieved, the step is inconclusive**, never a pass: rerun from a faster machine or connection.<br>Pass: a 429 within 11 s, and the last GET is 200.<br>The accepted count is the real per-minute cap of one fast IP, and it replaces the 10 + 10r assumption in the abuse table before the merge. As in 8a, a count above 210 (10 + 10 s × 20 a second) is not a no-go: it triggers a documented recompute, and the user decides before the merge.<br>Cost: at most 1,200 invocations, and about 210 if the documented lag holds | K14 (go/no-go) |
| 9 | Wait 61 s, then 25 plain GETs, one a second (over the limit by design) | Record whether cache hits count toward the limit, that is, whether a 429 shows up among them; either outcome is acceptable. Pass needs positive evidence: the plain GET 61 s later is 200 and carries `Cache-Status`, since a cached 429 would answer 429 there. A 429 whose `Cache-Status` shows a hit fails | K14 |
| 10 | With `--permalink`: GET the preview's permalink `/api/scores` (read only) | Record the status. A 200 means every deploy's permalink keeps a callable copy of the function: add it to the kill switch's list of live hostnames | — |

Read by hand from the same runs:
- **The `published` flag**: the preview's function log shows step 1's line with `"scope":"deploy","context":"deploy-preview","published":false`.
  - This confirms that `published` arrives in the Functions v2 `Context` as a boolean. The Functions API reference documents `deploy.published` as "a boolean that indicates whether or not the function belongs to the current published deploy".
  - A preview can only show `false`. The `true` case shows only on production (K13).
- **A function answer's header set**, on the first preview: the script prints the full response headers of step 1 (a GET 200), step 4 (a 400) and the first POST of step 6 (a 200).
  - Expected, per Netlify's custom-headers docs: the `/*` security headers from `netlify.toml` don't appear, because custom headers aren't applied to URLs handled by a function, even though the pattern matches.
  - Pass: nothing conflicts with DDD-6. There is exactly one `Cache-Control` value: `public, max-age=0, must-revalidate` on the GET 200, and `no-store` on the others. `Netlify-Vary: query=table` and `Content-Type: application/json` are present, and no static rule's `no-cache` is added.
  - If the security headers do appear, that is harmless, since `nosniff`, `Referrer-Policy` and `Permissions-Policy` don't touch caching. Record it, and correct the `netlify.toml` comment. Part of K14.
- **The header's name**: on the first preview, check that Netlify answers with `Cache-Status` (Netlify's caching docs, RFC 9211). If it sends something else, DELIVER updates the script and this spec before relying on steps 5 and 9.
- **Pruning**: `keys` stays near 20; above 40 means pruning is falling behind.

**Production mode** (`--production <URL>` alone, after every production deploy and every rollback). It never POSTs:
1. (P1) The script makes one GET `/api/scores?table=<random>` and prints the UTC time. A plain GET could be a cache hit, which runs no function and logs nothing.
2. (P2) The owner finds that `scores.read` line in Netlify → Cloud compute → Functions → `scores`, and checks `"scope":"site","context":"production","published":true` (K13). After a rollback, this shows that the deploy just published now writes the table.
3. (P3) Do it the same day: retention is unverified (Observability stack).

**Unpublished check**, once, after the second production deploy that has the function (K13):
1. (U1) The write guard runs first. The host must be a permalink whose ID differs from the published deploy's ID, which comes from the Netlify API or from the owner's typed confirmation (write guard, rule 2). The opening GET must answer 200 with an empty table.
2. (U2) One POST of a valid signature. It must answer 200 with an id, and its log line must show `"scope":"deploy","context":"production","published":false`.
3. (U3) A production GET `?table=<random>` must not contain that id.

Until such a deploy exists, the `chooseStore` unit table covers the case (`production` with `published: false` or missing → deploy). If the id ever shows up in production, delete that row (owner guide) and roll back.

**Why `?table=` misses and `?x=` doesn't**:
- By default, query parameters are part of a function response's cache key (Netlify caching docs).
- So every answer from the function carries `Netlify-Vary: query=table`, and every request without a `table` parameter shares one cache object.
- The header goes on every answer, because Netlify keeps the first cached response's `Netlify-Vary` for a URL.
- A client can still force a miss with `?table=<n>`. That costs one invocation, like a POST, and the rate limit bounds both. The cache is there for honest load; the rate limit is there for abuse.

## Wave: DEVOPS / [REF] Monitoring contracts

The KPI rows are K10–K15 in [kpi-contracts.yaml](../../product/kpi-contracts.yaml). K1–K9 (sound) are unchanged.

| KPI | Gate | Instrument | When |
|---|---|---|---|
| K10 Signing is quick on Netlify | **hard** | Steps 1 and 6 of the preview run: p95 < 1 s, with the cold start recorded apart | On the preview before the first merge, and again on the release-check triggers |
| K11 No signature lost on real Blobs | **hard** | Steps 1–3 of the burst run, on a throwaway preview with the rate-limit rule removed. It measures Blobs under concurrency, not the rule. Only a 429 is inconclusive, and never a pass. Any other non-200 fails K11, the first result is recorded, and no rerun can turn it into a pass | as K10 |
| K12 Previews never reach the production table, and the bundle is complete | **hard** | Steps 1, 4 and 7, the preview's log line, and the write guard | as K10 |
| K13 Only the published production deploy uses the site-wide store | **hard**, manual | Production mode (GET only), then the log line (`scope=site`, `published=true`); the unpublished check once, behind the write guard | After every production deploy and every rollback, the same day. The unpublished check once, after the second production deploy with the function |
| K14 The rate limit and the GET cache hold | **hard** (go/no-go) | Steps 5, 8a, 8b and 9, on the shipped config, plus the deploy log | On the preview before the first merge, and again on the release-check triggers |
| K15 Invocations stay under half the free quota | soft | The daily check: the Usage total, recorded daily and at every email, plus the account's Blobs figures, if any are visible | Daily, and on every email |

Signals in the function log (DDD-17), read with the UI's text filter or `netlify logs --function scores --since 24h --json`:

| Signal | Means | Action |
|---|---|---|
| `"scope":"deploy"` on production | Context detection broke: scores would reset at every deploy | Roll back to the previous deploy, then fix it (K13) |
| `scores.error` | A store or listing failure; the game degrades (ADR-008) | Seen in the daily check: if the last 24 h show `scores.error` lines spread over more than an hour, roll back. `store-unavailable` on production is an incident |
| `scores.error` with the reason `unexpected` | A bug, or an error the handler didn't expect, caught by the handler's catch-all | Investigate; roll back if it repeats |
| `keys` above 40 | Pruning is falling behind (`prune-failed`) | Investigate. It is harmless until listings slow down |
| A run of `scores.rejected` with `invalid-signature` | Someone is scripting the endpoint | Watch Usage, and read it every few hours (below) |

What the log doesn't show:
- A cached GET runs no function, so the log shows only cache misses. The Usage page counts what is billed.
- A 429 doesn't appear either, because the function doesn't run.
- Legacy plans have no Observability page (functions usage docs).

**Daily check.** It takes a minute. Do it every day from the merge on, and at every usage email:
1. Read the cumulative total for the billing period on Cloud compute → Functions → Usage. The docs call it "an aggregated count of requests in the current billing period". On day 1, record what the page actually shows on legacy Free: only a total, or a daily breakdown too.
2. Write the total down with the date and time, in the owner's own notes.
3. The day's rate is this total minus the previous reading, scaled to 24 h.
4. Days to 100% = (125,000 − this total) ÷ the day's rate. If 100% would come before the 1st of next month (when usage resets), pull the kill switch now.
5. Scan the last 24 h of the `scores` log. `scores.error` lines spread over more than an hour, or any `"scope":"deploy"` on production, mean roll back (Rollback, items 1 and 4).
6. Look for a Blobs usage figure (Quota and outage risk). If there is one, record it next to the total.

**While abuse is suspected** (an email before the 20th of the month, or a day's rate above about 4,000, which would spend 125k within the month): repeat steps 1–4 every few hours.

**What the daily check can't do**: one IP at 20 requests a second leaves about an hour between the 90% email and the pause, which a daily reading can't catch. Only reading the email and pulling the kill switch at once will.

## Wave: DEVOPS / [REF] Quota and outage risk

**The plan** (user; Netlify's legacy pricing page and billing FAQ):
- **Functions**: 125k invocations per site per month, counted per request whatever the runtime.
- **Other limits**: 100 GB bandwidth and 300 build minutes, both hard limits on Free. 1M Edge Function invocations, unused.
- **Blobs**: no limit is listed on the legacy pricing page, which doesn't mean there is none.
  - Before the merge, the owner checks the account's billing and usage pages for any Blobs limit or usage figure, and records the result here: `Blobs limits: <what the account shows> · checked <date>`.
  - If nothing is visible, Blobs operations are an unmonitored residual risk (below), and the daily check looks for a figure each day.
- **Reset**: usage resets on the 1st. Emails go out at 50, 75, 90 and 100%.
- **At 100% of the function quota**: new builds stop and **every site on the account is paused**, until a payment method is added and the account upgraded. Deleting the site doesn't restore the account, and Free has no automatic upgrade.
- **At 100% of build minutes**: sites keep serving, but builds stop.
- **If the account is ever migrated** to a credit-based plan, these numbers no longer apply: Free then gives 300 credits a month, and every project pauses when they run out.

**Honest load.** A page load costs 1 GET, each game start 1 GET, and each signing 1 POST (DDD-7).
- *Typical*: sessions of 3 games, and 1 game in 10 signs (once the top 10 fills, only top-10 deposits sign).
- *Worst honest*: 1 game per visit, and every game signs.
- *With the 15 s cache*: the page-load GET and the first game start usually fall within 15 s, so they cost one invocation. At these volumes, different players rarely share a 15 s window.

| Games a month | Typical, no cache | Typical, cache | Worst honest, no cache | Worst honest, cache | Worst, share of 125k |
|---|---|---|---|---|---|
| 100 | 143 | 110 | 300 | 200 | 0.2% |
| 1,000 | 1,433 | 1,100 | 3,000 | 2,000 | 2.4% |
| 5,000 | 7,167 | 5,500 | 15,000 | 10,000 | 12% |

- **The soft line**: K15 (62,500, 50% of the quota) would take about 20,800 games a month in the worst honest case without the cache.
- **The cache's ceiling** is its real value: with `durable`, GET misses stay at about 4 a minute per hostname (at most about 5,760 a day), however many people play at once.
- **Bandwidth is not binding**: a cold page load is about 106 KB from Netlify (the font comes from Google), so the limit allows about 900k cold loads a month.
- **Build minutes are not binding either**: a build takes roughly a minute (install, 46 tests in about 2 s, copy; not measured on Netlify), so the limit allows about 300 builds a month, previews included.

**Abuse.**
- **Counters**: each live hostname that serves the function has its own rate-limit counter per IP (`aggregateBy: ["ip","domain"]`). That means the custom domain, `<site>.netlify.app` (unless it redirects to the custom domain; not checked), every preview and branch deploy, and every permalink.
- **No total cap**: on Free nothing caps the total, because per-domain aggregation is Enterprise only (rate-limit docs).
- **The lag**: enforcement can lag by up to 10 s. Assuming the lag repeats in every 60 s window, one IP sending r requests a second gets about **10 + 10r a minute** through, per hostname. This is an upper-bound assumption until smoke step 8b measures the real cap; the measured figure then replaces it here, before the merge.
- **Blobs**: a POST costs up to 7 operations (1 write, 1 listing, up to 5 deletes), and a GET that misses the cache costs 1.

| Abuser | Through per minute, per hostname | Hostnames | Invocations a day | Blobs operations a day, if all POSTs | 125k reached (from an empty month) | 90% email → pause |
|---|---|---|---|---|---|---|
| 1 IP that stays at the limit | 10 | 1 | 14,400 | 100,800 | about 8.7 days | about 21 h |
| 1 IP at 2 a second | 30 | 1 | 43,200 | 302,400 | about 2.9 days | about 7 h |
| 1 IP at 20 a second | 210 | 1 | 302,400 | 2.1 M | **about 10 h** | **about 1 h** |
| 1 IP at 20 a second | 210 | 3 (the custom domain, a forgotten preview, a permalink) | 907,200 | 6.4 M | about 3.3 h | about 20 min |
| 10 IPs that stay at the limit | 10 | 1 | 144,000 | 1.0 M | about 21 h | about 2 h |
| 10 IPs at 20 a second | 210 | 1 | 3.0 M | 21 M | about 1 h | about 6 min |
| No rate limit, 1 client at 20 a second | 1,200 | 1 | 1.73 M | 12.1 M | about 1 h 45 min | about 10 min |

- **A single IP is enough**: at 20 a second it spends the month in about 10 hours, with about an hour between the 90% email and the pause. Each extra hostname or IP makes it proportionally faster.
- **GET floods** mostly hit the cache. A deliberate miss (`?table=`) or a POST costs an invocation, and both are rate-limited.
- **Mitigations**, in order: the rate limit (it caps each IP and hostname), the GET cache (it caps honest GETs), the emails and the daily check, and the kill switch.
- **The real control**: no setting on legacy Free caps the total, and a daily check is too slow for a fast client. What stands between abuse and a pause of every site on the account is the owner reading an email and pulling the kill switch within the hour.
- **Blast radius**: before the merge, the user decides whether to move the game to a Netlify team or account of its own (Pre-requisites).

**Residual risks** (not fixed here):
- **Many IPs**: there is no total cap on this plan.
- **Other copies of the function**: every deploy keeps its own copy at its permalink until the deploy is deleted. The deploy docs say deleting a deploy removes the "functions unique to the deploy". Each deploy preview also serves its copy at a guessable URL. Each copy has its own counter on the same site quota. The kill switch keeps a list of them, and the smoke-test previews are deleted after the merge.
- **Old production deploys**: closed by the user's decision (2026-10-24). `chooseStore` gives the site store only to the published production deploy (DDD-2, ADR-005), so an older production deploy reached through its permalink writes its own deploy store. It can't sign the real table with old code, but its copy still counts against the quota, as above.
- **Blobs operations**: unmonitored unless the account shows a figure (above). A POST flood from one IP at 20 a second would cost about 2.1 M operations a day, against a limit nobody has seen.

## Wave: DEVOPS / [REF] Deployment strategy

**Netlify atomic deploys with instant rollback** (user). The static files, the function and its rate-limit rule publish together, only after the build, the bundling and the post-processing finish. Canary, blue-green and rolling are rejected:
- the plan has no traffic splitting
- Netlify already switches atomically
- the only state is the site store, which every production deploy shares, and this feature has no migration

### Rollback (designed first)

| What | Moves with a rollback? |
|---|---|
| The static files, the function's code, the rate-limit rule | Yes (atomic deploy) |
| The production table (site store `leaderboard`) | **No.** Every production deploy shares it: a rollback undoes no signature and restores no deleted row |
| A preview's or branch deploy's table (deploy store) | Yes: it follows its deploy (Blobs docs) |
| The GET cache | A new deploy invalidates the cache of its deploy context (caching docs). Otherwise an answer is at most 15 s old |

1. **A leaderboard deploy misbehaves**, in the game or the function: Deploys → the previous good deploy → **Publish deploy**. It is instant, and auto publishing stops. Fix the problem on `main`, publish the fixed deploy, then use **Unlock to start auto publishing**.
   - Rollback is safe by construction: an older function reads the same `s/` keys, and only well-formed keys count.
   - Writes follow the publish: the deploy you publish becomes the published one, so it writes the production table. The deploy you leave writes only its own store from then on (DDD-2). Run K13 after the rollback.
   - Rule for later changes: never change the meaning of the `s/` keys or the store name in place. A new format takes a new prefix, which older functions ignore (ADR-004).
2. **Abuse or quota burn**: the kill switch, below.
3. **Vandalised or forged rows**: list `s/` (owner guide) and delete the offending rows.
   - Also delete any key under `s/` that doesn't match `^s/\d{7}-\d{15}-[A-Z]{3}-[a-z0-9]+$`. The function ignores such keys, but nothing else removes them.
   - There is no backup: rows that were pushed below 10th and pruned in the meantime are gone (accepted).
4. **Context detection broke** (`scope=deploy` on production, with `context` or `published` missing or unexpected in the log line): roll back as in 1. Signatures made in the meantime sit in that deploy's store and never reach the production table (accepted).
5. **The production store is lost**: the table starts empty again (accepted, ADR-004).

### Kill switch (zero code)

**Arm it on the day of the merge**, before the merge is pushed:
1. Deploys → Trigger deploy, on `main` at the last pre-leaderboard commit, and let it publish.
   - Free deletes a deploy 30 days after it was made, unless it is the published deploy, the latest production deploy or the latest deploy of a branch (deploy docs). Arming on the merge day gives the full 30 days.
2. Check that it has no `scores` function:
   - its deploy summary lists no functions (the deploy overview docs say the summary "shows you how many functions … were deployed")
   - a GET on its permalink's `/api/scores` answers 404
3. Record it here: `kill-switch deploy: <deploy ID> · <commit> · <date> · expires <date + 30 days>`. Put the expiry date in a calendar. DELIVER fills this in.
4. Keep a list here of **live function hostnames**, one line each with its deploy ID: every pushed preview and branch deploy, and every permalink that was used or handed out.
   - Start the list with the smoke-test previews.
   - Strike a line when its deploy is deleted.
   - Delete the smoke-test previews after the merge.
5. Make sure Netlify's usage emails reach an inbox the owner reads.

**Pull it** when the daily check says so, or when an email or the logs show abuse:
1. Deploys → the kill-switch deploy → **Publish deploy**. It is instant, and auto publishing stops.
   - It switches **only the production hostnames**: the custom domain and `<site>.netlify.app`. Previews, branch deploys and permalinks keep their own copies of the function.
   - That deploy has no function, so `/api/scores` on production becomes a static 404, which costs no invocation.
   - Its game makes no table call, and an open tab of the leaderboard version degrades as it would with the table down (ADR-008).
2. Check with a GET, not a HEAD: `curl -s -o /dev/null -w '%{http_code}\n' https://maketherightmove.fabiodamico.xyz/api/scores`. Expect `404` within about 15 s: a cached GET can outlive the switch by up to 15 s.
3. After 15 minutes, read the Usage total again. If it is still climbing, the traffic is on a hostname from the list of live function hostnames.
   - Delete those deploys (Deploys → the deploy → Options → Delete deploy), previews and branch deploys first.
   - Deleting the leaderboard production deploy itself is possible once the kill-switch deploy is published, but then resuming needs a fresh build of `main`.
   - If the climb doesn't stop, look in the Functions list for a deploy that isn't on the list, delete it, and add it to the list.

**Resume**:
1. Delete bad rows, if any (owner guide). The table is as it was before the switch.
2. Deploys → the latest production deploy → **Publish deploy**, then **Unlock to start auto publishing**.
3. Run the production check (K13).

**After the expiry date**, the kill-switch deploy is gone, unless it is published, and the **only route is a revert build**: `git revert` the leaderboard merge on `main`, or delete `netlify/functions/scores.mjs`.
- That takes one build: about a minute, plus any queue (Free has 1 concurrent build).
- It needs build minutes left.
- **Changing the production branch** (Project configuration → Developer settings → Continuous deployment → Branches and deploy contexts) to a branch that holds the last pre-leaderboard commit might give a production deploy without the function. But the docs only show where the setting is: they don't say whether changing it triggers a deploy, or what it does to existing deploys. It is not documented, so it is not relied on, and it would need a build anyway.

**Release check**, before every push to `main`: `npm test` green, then `npm run build`.
- **Re-run triggers**: re-run K10 and K14 on a preview, and K11 on a throwaway preview, whenever the push changes:
  - `netlify/functions/scores.mjs`
  - the `@netlify/blobs` version
  - the functions bundler settings
  - `config.rateLimit`
  - the cache headers
- **The first time, also**:
  - the K10–K14 go
  - the Blobs limits checked and recorded
  - the user's decision on the account
  - the kill switch armed on the merge day
- **An invalid rule fails silently**: a rate-limit rule that fails Netlify's validation doesn't fail the deploy. The site deploys without the limit, and only the deploy log and K14 would show it. The unit contract test of `config` catches a typo in its shape, not Netlify's verdict.

## Wave: DEVOPS / [REF] Mutation testing strategy

**Disabled** (user), as already persisted in `CLAUDE.md` under `## Mutation Testing Strategy`. No change for this feature.

## Wave: DEVOPS / [REF] Observability stack

No third-party tools (user, 2026-10-24).
- **Logs**: one JSON line per request (DDD-17), in Netlify → Cloud compute → Functions → `scores`.
  - The view is a live tail, or the last hour, day or 7 days, with a text filter.
  - From a terminal: `netlify logs --function scores --since 24h --json`.
  - For a preview: search the Functions list by preview number, or use `netlify logs --url <preview URL>`.
- **Nothing escapes the handler**: a catch-all around the request handler logs `scores.error` with the reason `unexpected` and answers 500 `unexpected`. So no request-time error reaches Netlify's log with its message or stack, which could hold a key, and so initials (DDD-17).
  - Module-load errors and runtime timeouts sit outside the handler, and Netlify logs them itself. The risk is low, because no key is on that path.
  - Locally, `scripts/serve.mjs` also logs the fixed reason only.
- **Retention is unverified for legacy Free**. The docs say logs are kept "at least 24 hours", and 7 days on some plans they don't name.
  - On day 1 after the first production deploy, try to read a log line older than 24 hours, and record here whether it was still there.
  - Until then, K13 and any abuse investigation happen the same day.
  - Log drains are Enterprise only.
- **Usage**:
  - Cloud compute → Functions → Usage: a cumulative count of requests for the billing period, per project. The daily check turns it into a rate.
  - Function Metrics: per function, a reduced page on legacy plans.
  - Billing → Account usage insights: the team.
- **Alerts**: Netlify's emails at 50, 75, 90 and 100% of a free-tier limit. Nothing else pages anyone.
- **SLOs**: none run continuously. The latency budget is a release gate (K10). With one owner and no on-call, an availability SLO would measure Netlify.
- **Privacy**: a signature keeps 3 initials, a score and a time. They are kept until pruned or deleted by the owner, and there is no backup. Netlify processes client IPs for rate limiting; the function logs none.

## Wave: DEVOPS / [REF] Branching strategy

**Trunk-based on `main`** (user). Every push to `main` deploys to production. Pull requests get deploy previews, and so do branches where branch deploys are on. For this feature:
- `worktree-leaderboard-spike` stays unpushed until ADR-005 is implemented, and then needs the user's OK. So does the throwaway burst branch (`smoke/no-rate-limit`).
- The smoke test runs on that branch's deploy preview (a pull request). The merge to `main` waits for the go.
- Every pushed preview or branch deploy goes on the kill switch's list of live function hostnames.
- Delete the throwaway burst preview and its branch right after the burst run. Delete the smoke-test previews after the merge: each keeps a callable copy of the function, with its own rate-limit counter on the same quota.
- There is no branch protection. The Netlify build gate is the only automated check.

## Wave: DEVOPS / [REF] Coexistence matrix

| Tool | Version | Must keep working | How |
|---|---|---|---|
| `@playwright/test` | 1.62.1 | yes | The gate is unchanged; `PORT` keeps side-by-side checkouts apart |
| `playwright-bdd` | 9.2.1 | yes | `bddgen` runs first in the gate |
| `fast-check` | 4.10.2 | yes | The unit properties run in the gate |
| `@netlify/blobs` | 11.1.6, exact (the only runtime dependency) | yes | The function's client on Netlify, inlined by esbuild; `BlobsServer` for `npm start` and the tests |
| Netlify functions bundler | esbuild (only the family is pinned; the esbuild version is whatever Netlify's build image ships) | yes | `[functions]` in `netlify.toml`. Local runs don't bundle |
| `netlify-cli` | 27.14.2, through `npx` (owner only, not a dependency) | owner's tool | Deleting rows and reading logs. Its command syntax is unverified until each command is checked with `--help` |

There is still no husky, no pre-commit and no GitHub Actions.

## Wave: DEVOPS / [REF] Pre-requisites

DESIGN's open questions for DEVOPS, answered:

| Open question | Answer |
|---|---|
| Don't push before ADR-005 | It stands (Branching strategy) |
| Smoke test on a deploy preview | The spec above: a preview run, a burst run on a throwaway preview, and the production checks, all behind a write guard (K10–K14) |
| Go/no-go on `config.rateLimit`, and the numbers | 10 per 60 s per IP and domain (user). Rate limiting exists on every plan, with 2 code rules per project on Free. Go = K14; no-go = the feature is not merged to `main` |
| The owner's procedure to pause signing | None: the fallback was rejected (user, 2026-10-24; [upstream-changes](devops/upstream-changes.md) §3). The kill switch is the owner's stop |
| Where the logs are read, and for how long | Observability stack: Netlify → Cloud compute → Functions → `scores`. Retention is unverified: "at least 24 hours" per the docs, checked on day 1 |
| The production store has no backup | Recorded as an accepted loss (Rollback, items 3 and 5) |
| The owner guide to deleting a row | Below |
| Pinning the functions bundler | `netlify.toml` `[functions]`: `node_bundler = "esbuild"` and `directory = "netlify/functions"`. Only the bundler family is pinned, not the esbuild version. No `included_files`, because the import is static |
| The brief's Platform and Delivery | Rewritten, including the privacy sentence |

**Open for the user, before the merge**:
- **The account**: whether to move the game to a Netlify team or account of its own, so that a quota pause can't take down the user's other sites. Transfer and terms are unverified.
- **Pushing**: the OK to push the candidate branch and the throwaway burst branch.

**Owner guide: deleting a row** from the production table. The Blobs UI (Data & Storage → Blobs) only browses and downloads, so deleting needs the CLI (Netlify CLI reference: `blobs:list`, `blobs:delete`). **The syntax below is unverified**: before first use, run each command with `--help` (for example `npx netlify-cli@27.14.2 blobs:list --help`) and correct this guide if it differs.
1. Once: run `npx netlify-cli@27.14.2 login`, then `npx netlify-cli@27.14.2 link` and pick the site. `link` writes `.netlify/state.json`, so run it from a folder outside the repo, or add `.netlify/` to `.gitignore` first.
2. List the rows: `npx netlify-cli@27.14.2 blobs:list leaderboard --prefix s/ --json`. The CLI always reads with strong consistency, and from the default region, as the function does.
   - A key reads `s/{9999999 − score}-{time in ms}-{initials}-{id}`. For example, `s/9998999-…-FAB-…` is FAB with £1,000.
   - The best score sorts first.
   - A key under `s/` that doesn't match `^s/\d{7}-\d{15}-[A-Z]{3}-[a-z0-9]+$` is junk: delete it too.
3. Delete one row: `npx netlify-cli@27.14.2 blobs:delete leaderboard '<the whole key>'`, and answer the prompt.
4. Other computers see the change within about 15 s (the GET cache).

A deletion is final: there is no backup. Deleting a top-10 row lets the 11th climb back, but a POST that listed just before the deletion may prune that row at the same moment, so the table can briefly show 9 rows. Accepted: moderation is rare.

**Before DISTILL and DELIVER**:
- **DISTILL**:
  - no 429 scenario (Netlify only), and no paused scenario, since the fallback was rejected
  - the client tells only OK from not OK
  - a check of the headers on each answer belongs in the `unit` project (DDD-6 as amended)
  - the `chooseStore` table gains the `published` cases (ADR-005)
  - the log-leak test captures every console method (DDD-17)
- **DELIVER**:
  1. Implement DDD-6 as amended: the cache headers on a GET 200, `Netlify-Vary: query=table` on every answer, and `no-store` on the rest.
  2. Set `config.rateLimit = { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] }`.
  3. Implement ADR-005 as amended: the site store only for `context === 'production'` and `published === true`, and the raw `published` value in every log line (DDD-17).
  4. Implement DDD-17's catch-all: wrap the request handler so that nothing escapes it (module-load errors and runtime timeouts are outside it, and carry no key). The catch logs only `scores.error` with the reason `unexpected`, and answers 500 `unexpected`. The log-leak test captures every console method (`log`, `info`, `warn`, `error`, `debug`, `trace`) while a store throws an error whose message contains a key.
  5. Fix `scripts/serve.mjs`:
     - log only the fixed reason, instead of `console.error(error)` (around line 65)
     - stop forcing `cache-control: no-store` on `/api/scores` (line 47), and pass the function's own headers through
  6. Add a `unit` contract test of the exported `config` (`path: '/api/scores'`, and `rateLimit` exactly `{ windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] }`) and of the header set per answer, so a typo fails the build.
  7. Write `scripts/smoke-leaderboard.mjs`, including the write guard.
  8. Add `.netlify/` to `.gitignore`.
  9. Before the merge, with the owner:
     - check and record the account's Blobs limits
     - with the user's OK to push, run the burst run on a throwaway preview, then the preview run on the candidate
     - start the list of live function hostnames
  10. On the merge day, before the merge is pushed: arm the kill switch. Trigger the deploy, check that it has no function, record it, and put the expiry date in a calendar.
- **Not done here**: pushing, creating or linking Netlify resources, and running the smoke test.

## Wave: DEVOPS / [REF] Changed assumptions

Originals quoted verbatim:
- `docs/feature/rightmove-invaders-leaderboard/feature-delta.md` (DDD-6): "HTTP contract: every answer from the function sets `Cache-Control: no-store` itself and has a JSON body." → A successful GET is cached for 15 s at the CDN (`Netlify-CDN-Cache-Control: public, s-maxage=15, durable`; `Cache-Control: public, max-age=0, must-revalidate`). Every answer carries `Netlify-Vary: query=table`. POSTs and errors stay `no-store` (user). Amended in place.
- The same file (DDD-5): "`config.rateLimit` asks for about 60 requests per minute per IP and domain, across GET and POST: a DEVOPS go/no-go for the site's plan, with a fallback." → 10 per 60 s per IP and domain (user). The fallback was rejected (user). Amended in place.
- The same file (catalogued lies): "DEVOPS go/no-go, with the ADR-007 fallback" → No-go means no merge to `main`.
- The same file (catalogued lies): "DEVOPS burst: at least 20 simultaneous POSTs on a preview" → on a throwaway preview with the rate-limit rule removed, so that the rule can't make the burst inconclusive (review, iteration 2).
- The same file (DDD-6): "The client only distinguishes OK from not OK, with one exception: […], which has its own message." (the fallback's error code is elided) → OK or not OK only.
  - The 503, the paused outcome, its log reason and its DISTILL scenario are deleted (user: the fallback was rejected).
  - The same deletion applies to DDD-8, the lifecycle, the handler delta, the rules operations, the client component and the log reasons.
  - Amended in place.
- The same file (DDD-2): "a pure `chooseStore(context)` returns `'site'` only when `context?.deploy?.context === 'production'`" → also requires `context?.deploy?.published === true` (user). Amended in place, with DDD-17 gaining the raw `published` in every log line.
- The same file (DDD-17): "**Never** logged: the error message, a key, the body, an id, initials or an IP." → It now also holds for uncaught request-time errors, through the handler's catch-all (module-load errors and timeouts sit outside it, with no key on that path), and the log-leak test captures every console method (review, iteration 2).
- `docs/product/architecture/adr-007-proportionate-abuse-controls.md`:
  - "**Per IP at the limit**: about 60 requests per minute, or **about 86,400 function invocations a day**." → 14,400 a day for a client that stays at the limit, but up to about 302,400 a day for one IP sending 20 a second (10 + 10r a minute): the month in about 10 hours. The first DEVOPS draft's "about 9 days" understated a single fast IP (review, iteration 2).
  - "To be checked by DEVOPS against the plan's allowances; no plan limits are assumed here." → Checked against legacy Free: 125k invocations per site per month. Blobs limits are not listed, and are checked on the account before the merge.
  - Both amended in place.
- The same ADR: "DEVOPS also sets up a usage alert if the plan offers one." → Nothing to set up: legacy Free sends the emails at 50, 75, 90 and 100% on its own (billing FAQ). The daily check turns the Usage total into a rate.
- The same ADR: "**Fallback if `config.rateLimit` isn't honoured**: ship without it, and give the owner a switch." → Rejected (user). It moves to "Alternatives considered".
- `docs/product/architecture/adr-005-table-store-by-deploy-context.md`:
  - "DEVOPS reads one production GET's log line after each deploy and expects `scope=site`." → That GET must miss the cache (`?table=<random>`), because a cached GET runs no function and logs nothing. It expects `published=true` too. Amended in place, with decision 14.
  - The same ADR's "A unit test covers exactly those seven cases." → a table of 12 cases, including production with `published` false and missing.
- `docs/product/architecture/brief.md` (Application Architecture, "Data kept"): "The platform sees client IPs (that is how it rate-limits); the game stores none" → Signatures are kept until pruned or deleted by the owner, with no backup; Netlify processes client IPs for rate limiting; nothing logs the raw error (review, iteration 2).
- `docs/product/architecture/brief.md` (Platform and Delivery): "**Observability**: none. There is no server and no personal data; KPIs come from the playtest, the test suite and `scripts/measure-performance.mjs`." and "**Rollback**: Netlify → Deploys → a previous deploy → Publish deploy." → The section is rewritten: the function's logs, the usage page, the emails and the daily check; a rollback that leaves the production table as it is; the kill switch.
- `docs/feature/rightmove-invaders-sound/environments.yaml`: "Static files only: no server, no functions, no database, no secrets or environment variables beyond NODE_VERSION" → Superseded by this feature's [environments.yaml](environments.yaml): one function, one store, a rate limit and a cache, and still no secrets. The sound file stays as its wave's record.
- `docs/feature/rightmove-invaders-sound/feature-delta.md` (Observability stack): "**None** (user, 2026-10-24). No logs, metrics, traces, analytics or error tracking." → The function's logs, the Usage page, the usage emails and the daily check.
- The same file (Deployment strategy):
  - "one static site with no server, no state and no migrations has nothing to shift gradually" → Still atomic, but there is now state: the site store, which a rollback doesn't move.
  - "click "Start auto publishing" again" → Netlify's current label is "Unlock to start auto publishing" (deploy docs).
- `netlify.toml`: "# Netlify static hosting for Make the Right Move (docs/feature/rightmove-invaders-sound/feature-delta.md, DEVOPS)." → The file now covers the Score API too, and gains a `[functions]` table. Its comment says that only the bundler family is pinned.

## Wave: DEVOPS / [REF] Wave decisions summary

- **User decisions (2026-10-24)**:
  1. Target: Netlify as today (CDN, Functions v2 on Node 22, Blobs).
  2. Serverless only, no containers.
  3. CI/CD: the Netlify build with the existing gate; no GitHub Actions.
  4. Existing infrastructure reused: the Netlify site, the build gate and `netlify.toml`.
  5. Observability: the function's logs and Netlify's usage emails.
  6. Deployment: atomic deploys with instant rollback.
  7. Continuous learning: none.
  8. Branching: trunk-based, with previews.
  9. Mutation testing: disabled.
  10. Plan: legacy Free.
  11. Rate limit: 10 per 60 s per IP and domain.
  12. GET cache: 15 s at the CDN with `durable`. This reverses DDD-6 for successful GETs only.
  13. The ADR-007 fallback is rejected. There is no environment switch and no paused outcome; the client tells only OK from not OK. If the rate limit fails on the preview, K14 is a no-go, and there is no merge to `main`.
  14. Only the published production deploy writes the site store: `chooseStore` requires `context === 'production'` and `published === true`.
- **DEVOPS decisions** (revised after the review, iteration 2):
  - **Bundler**: the bundler family is pinned (`esbuild`, `netlify/functions`), not the esbuild version, and there is no `included_files`.
  - **Cache key**: every answer carries `Netlify-Vary: query=table`, so query strings don't split the cache.
  - **Smoke test**:
    - four modes: a preview run, a burst run on a throwaway preview with the rule removed, a GET-only production mode, and the unpublished check
    - all of them behind a write guard: no POST to a production host or to the published deploy, and none without an empty first GET
    - KPI rows K10–K15
  - **Go/no-go**: K14 on the shipped config. No-go means no merge to `main`. Step 8b measures the real cap of one fast IP: a count above 210 triggers a documented recompute and a decision by the user, not a no-go. A probe that misses its send rate is inconclusive, and an inconclusive run is never a pass.
  - **K11**: only a 429 is inconclusive. Any other non-200 fails it, for good.
  - **Kill switch**:
    - armed on the merge day, checked to have no function, and its expiry date put in a calendar
    - it covers only the production hostnames, with a list kept of the live function hostnames
    - after expiry, the revert build is the only route
  - **Daily check**: the cumulative Usage total recorded daily and at every email, with the quota rule working on the difference. It is also the detector for `scores.error` and `scope=deploy`.
  - **Logs**: every log line carries the raw `published` value, and nothing escapes the handler (DDD-17).
  - **Release check**: re-run triggers for K10, K11 and K14, plus a unit contract test of `config` and the headers.
- **Open for the user, before the merge**: the account, that is, whether to move the game to a Netlify team or account of its own (transfer and terms unverified), and the OK to push.
- **Key risk**: honest play stays under 12% of the quota even at 5,000 games a month in the worst case. But **one IP at 20 requests a second spends the month in about 10 hours**, with about an hour after the 90% email, and 100% pauses every site on the account. The owner's response to an email, plus the kill switch, is the control. Blobs operations are unmonitored unless the account shows a figure.
- **Upstream amendments**, marked in place:
  - in this file:
    - DDD-2, DDD-5, DDD-6, DDD-8 and DDD-17, with their decisions-table rows
    - the log reasons, the catalogued lies, the client component, the handler delta, the rules operations and the lifecycle
    - the DISTILL scenario list, the open questions and the summary constraints
  - ADR-005, ADR-007 and ADR-008
  - OUT-7, OUT-8, OUT-11 and OUT-13
  - in the brief's Application Architecture: the rate-limit, cache, store and data-kept wording

  See [devops/upstream-changes.md](devops/upstream-changes.md).
- **Handoff**: DISTILL (no 429 scenario and no paused scenario; the `chooseStore` cases with `published`; the log-leak test over every console method), then DELIVER (Pre-requisites above).
