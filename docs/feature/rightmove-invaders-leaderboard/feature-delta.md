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
| DDD-2 | Store by deploy context: a pure `chooseStore(context)` returns `'site'` only when `context?.deploy?.context === 'production'`, and `'deploy'` otherwise (missing, other or differently spelled contexts included). `'site'` → `getStore('leaderboard')`; `'deploy'` → `getDeployStore('leaderboard')`, both with strong consistency. Without a deploy ID, `getDeployStore` throws `MissingBlobsEnvironmentError`: a 500, never a fallback to the site store. Locally, one store per `test-board` cookie. | Accepted (user) | Previews never write to production, and the production table survives deploys and rollbacks ([ADR-005](../../product/architecture/adr-005-table-store-by-deploy-context.md), OUT-13) |
| DDD-3 | The shared pure module `src/game/high-scores.js` imports nothing. It holds the table size, the alphabet and length, the £50 step, the maximum, signature validity, the word filter, and `makesTheTable`. The function uses the size and the signature validity, including the word filter; only the browser uses `makesTheTable`. | Accepted (user) | One rule on both sides of the wire ([ADR-006](../../product/architecture/adr-006-shared-high-score-rules.md), OUT-10) |
| DDD-4 | The function's composition roots (the Netlify entry, and `scripts/serve.mjs` locally) choose the store and wrap it in a **restricted table-store port**. The port has `list` (well-formed keys under `s/` only), `putIfNew(key)` and `remove(key)`, and `putIfNew` and `remove` refuse any key that isn't well-formed. There is no `deleteAll` and no other access to the store. A call to `putIfNew` or `remove` with a key that isn't well-formed throws a refusal. The handler maps a refusal to 500 `unexpected`, even during pruning: a refusal is a bug, not a store failure. The read path (GET) receives `list` alone. The roots also wire the clock, the id source and the logger. The handler is the imperative shell. The key codec, ranking, prune plan and `chooseStore` are pure. | Accepted | The handler can't touch anything but score keys; deterministic tests of the duplicate-key path |
| DDD-5 | Abuse controls: a JSON content type is required (else 415). The body is read with a 1 KB byte cap (else 413). The body must be exactly `{ initials, score }` (else 400). The word filter runs on both sides. `config.rateLimit` asks for about 60 requests per minute per IP and domain, across GET and POST: a DEVOPS go/no-go for the site's plan, with a fallback. There is an owner guide to deleting a row. Forged scores are an accepted risk. | Accepted (user) | Proportionate for a public fan game ([ADR-007](../../product/architecture/adr-007-proportionate-abuse-controls.md)) |
| DDD-6 | HTTP contract: every answer from the function sets `Cache-Control: no-store` itself and has a JSON body. GET 200 `{ scores, listedAt }`, POST 200 `{ scores, id, listedAt }`, where `listedAt` is the function's `Date.now()` in ms, taken right after its `list` call returns. Errors are `{ error }`: 400 `invalid-signature` / `initials-not-allowed`, 405 with `Allow`, 413 `payload-too-large`, 415 `json-required`, 503 `not-saved`, 500 `unexpected` (plus 503 `signing-paused` only if the ADR-007 fallback is adopted). A 429 comes from Netlify (on Netlify only), with Netlify's body and headers and no `no-store` guarantee. The client only distinguishes OK from not OK, with one exception: `signing-paused`, which has its own message. | Accepted (user) | The same behaviour locally and in production, except the platform's 429 (OUT-7, OUT-8) |
| DDD-7 | The table is read on page load, in the background on every `gameStarted`, and from every POST answer. The server ranks every valid signature and doesn't refuse one that no longer qualifies. | Accepted (user) | The table is as old as the last successful refresh (normally this game's start), with no wait at game over ([ADR-008](../../product/architecture/adr-008-table-probed-never-awaited.md)) |
| DDD-8 | Signing lifecycle: entering → pending → confirmed, off-table or unconfirmed (or paused, only if the ADR-007 fallback is adopted), keyed by a signing number n that the rules issue to match a POST answer to its signing. No POST retry. A new game does **not** drop the signing: its outcome is kept until the next signing. An outcome that arrives during play is announced by the status mirror only. A confirmed row stays highlighted wherever the table is shown, until the next signing or until the row leaves the table (pruned, or pushed down by newer signings). An answer for a signing that a newer signing has replaced is still announced once, through the status mirror. Its rows apply under DDD-12, and it changes neither the current signing nor its highlight. Enter always restarts. The skeleton's optimistic "Signed FAB." is reversed. | Accepted (user; keeping the signing across games and announcing replaced signings: orchestrator, 2026-10-24) | The player learns every signing's outcome, even after starting the next game or signing again, and the game never claims more than it knows (ADR-008, OUT-11) |
| DDD-9 | One table state, `{ status, rows }`, with status `unknown`, `available` or `unavailable`. **Unavailable only while no table has ever loaded**: a failed refresh keeps the last good table and the status stays available (user, 2026-10-24). Initials are asked for only when `makesTheTable` is true, which requires the table to be available. On game over: available shows the list; unavailable shows "High-score table unavailable"; unknown shows no prompt, no list and no table line. The title shows the list only while the table is available. | Accepted (user) | The game plays fully without the table (ADR-008, OUT-12) |
| DDD-10 | Blocked initials: the rules refuse the signing, keep the entry open with the letters kept, and ask the player to change them. The server refuses them too (400 `initials-not-allowed`). | Accepted (user) | An in-game refusal with no round trip (ADR-007) |
| DDD-11 | The network never sits on the frame path. `main.js` hands each outcome to the rules from promise callbacks, between frames. Only `game.js` writes `g`. | Accepted | Responsiveness stays the first quality attribute |
| DDD-12 | **Answers ordered by server listing time.** Every answer that carries rows also carries `listedAt`: the function's `Date.now()` in ms, taken right after its `list` call returns (GET `{ scores, listedAt }`, POST `{ scores, id, listedAt }`). The rules apply rows only if their `listedAt` is ≥ the last applied `listedAt`. Otherwise they ignore the rows, though a signing is still settled from its own answer. A POST's listing always comes after its own write, so a GET whose listing came before that write can never roll the table back. **Accepted edge**: clock skew between function instances (a few ms) can misorder two listings taken within that window; those snapshots are then nearly identical. Send order is not used for ordering. | Accepted (orchestrator, 2026-10-24) | Order by when the server looked, not when the browser asked (ADR-008, OUT-12) |
| DDD-13 | The client adapter's `fetch` and timers (`setTimeout`/`clearTimeout`) are injected by `main.js`. A timeout of exactly 5000 ms aborts a GET or POST. | Accepted (user) | Playwright's clock drives the timeout; `AbortSignal.timeout` would run on real time |
| DDD-14 | Accessibility: a `data-hud="initials"` field while entering, one short live-region update per change of letter or position (at most one per frame), announcements of signing outcomes whenever they arrive, and `aria-current` on the confirmed row in the High scores list. | Accepted (user) | Screen readers hear the chosen letter and the outcome; tests read the highlight from the DOM |
| DDD-15 | An all-time table. A periodic (monthly) table would later be a key-prefix change with no migration. | Accepted (user) | Simplest; what players expect |
| DDD-16 | Local server: keep the `test-board` cookie isolation and delete the emulator directory on exit, SIGINT and SIGTERM, with no start-up sweep. Failure scenarios inject faults with `page.route` on `/api/scores`. Accepted dev-only risk: `BlobsServer` 11.1.6 has no host option, so the emulator listens on every interface, on a random port and behind a random token. | Accepted (user) | Proven green in three engines; a sweep could delete a side-by-side checkout's live directory |
| DDD-17 | Observability: one structured JSON log line per request, with `event`, a `reason` from a fixed list per event (below), `ms`, `keys` (the count of well-formed keys, when listed), `scope` (`site`, `deploy` or `local`) and `context` (the raw `context.deploy.context`, or `missing`). **Never** logged: the error message, a key, the body, an id, initials or an IP. A unit test makes the store throw an error whose message contains a key, and checks that no initials reach the log. | Accepted (user) | Enough to diagnose; a key count above 40 means pruning is falling behind; "scope=deploy on the production site" means context detection broke |
| DDD-18 | Probes: the client's page-load GET is the probe ("wire, probe, use"); the game never refuses to start because of the table. No server probe at cold start. Each catalogued lie has a test (below). Real Netlify is probed by the DEVOPS smoke test. | Accepted (user) | Every dependency the design trusts is checked somewhere |
| DDD-19 | Build gate: the handler's tests run in the `unit` project through the restricted port, over a real `BlobsServer` in Node, with no hand-written fake. A hand-rolled import-scan unit test enforces the five layering rules. | Accepted (user) | A broken function or a layering breach fails the Netlify build |

**Log reasons** (DDD-17), a fixed list per event:

| Event | Reasons |
|---|---|
| `scores.read` | `ok` |
| `scores.signed` | `ok`, `prune-failed` |
| `scores.rejected` | `json-required`, `payload-too-large`, `invalid-signature`, `initials-not-allowed`, `method-not-allowed`, plus `signing-paused` (only if the ADR-007 fallback is adopted) |
| `scores.not_saved` | `key-exists` |
| `scores.error` | `store-unavailable`, `put-failed`, `list-failed`, `unexpected` |

**Catalogued lies, each with its test** (DDD-18):

| Lie | How it shows | How the design handles it and checks it |
|---|---|---|
| The emulator lists its own temporary files (`s/.xxxx`) | Junk keys in the listing | The port lists well-formed keys only and can't remove any other. A unit test seeds a junk key and checks the table is unchanged and the junk key survives |
| A write to a key that already exists | The store reports "not modified", with no error | 503 `not-saved` and no second row. A unit test forces the duplicate with an injected clock and id |
| Strong consistency without `uncachedEdgeURL` | The listing throws | 500 `unexpected` (reason `list-failed` or `store-unavailable`), and the client degrades. Covered by the "table unavailable" scenario through `page.route` |
| The deploy context is missing or spelled differently | `chooseStore` returns `'deploy'` on production, so scores would seem to reset at each deploy | A table test of `chooseStore`: `production` → site; `deploy-preview`, `branch-deploy`, `dev`, no `deploy`, no context, `'Production'` → deploy. In production, detected as "scope=deploy on the production site" in the logs (DEVOPS checks a production GET's log line after each deploy) |
| A deploy store without a deploy ID | `getDeployStore` throws `MissingBlobsEnvironmentError` | 500 `unexpected` (reason `store-unavailable`), never the site store. A unit test runs the entry with a Blobs environment that has no deploy ID |
| A store error message carries a key (and so initials) | Initials leak into the logs | Only the fixed reason is logged. A unit test with a throwing store checks the log |
| Real Netlify lists stale keys right after a write | A false off-table, or a missing row | DEVOPS burst: at least 20 simultaneous POSTs on a preview; the following GET must equal the expected top 10, and each POST that belongs in it must find its own id in its answer |
| Real Netlify is slower than the emulator, or cold starts | Budget missed (submit + read < 1 s at p95) | DEVOPS: p95 over at least 30 sequential POST+GET pairs, timed on the client, with the cold start measured as a separate sample |
| `config.rateLimit` isn't honoured on the site's plan | No 429 under a burst | DEVOPS go/no-go, with the ADR-007 fallback |
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
| High-score table client | `src/platform/leaderboard.js` | EXTEND | bounded-change per call | Exactly one request to `/api/scores` per call. No state between calls. Resolves with the parsed answer, or rejects on a non-OK answer, a network error or the 5000 ms timeout (which aborts the request). The rejection carries the answer's `error` code when there is one, which is used only to recognise `signing-paused`. Never retries |
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
| Signing paused by the owner (only if the ADR-007 fallback is adopted) | none | 503 `signing-paused` |
| Over the rate limit (Netlify only) | none; the function doesn't run | 429 with Netlify's body and headers, without a `no-store` guarantee. Not reproducible locally: DISTILL writes no 429 scenario |

Every answer **from the function** carries `Cache-Control: no-store` and a JSON body.

### Rules operations (`src/game/game.js`)

| Operation | Delta |
|---|---|
| Game over | As before, plus the initials entry opens (letters A A A, the first letter current) only if `makesTheTable(table state, deposit)` is true. What game over shows, by table status: **available**, the list (the confirmed row highlighted, if any); **unavailable**, "High-score table unavailable"; **unknown**, no prompt, no list and no table line (DISTILL may add neutral wording). The game-over messages only describe a signing made in this game; an earlier signing shows only as its highlighted row |
| Third Enter, initials allowed | The entry closes. A new signing `{ initials, n, pending }` becomes the current signing and replaces the earlier one, including its highlight. A replaced signing that is still pending keeps waiting for its answer, whose outcome will only be announced (see "Answer for a replaced signing"). Emits `initialsEntered { initials, score, signing: n }` |
| Third Enter, initials on the word filter | No signing and no event. The entry stays open with the letters kept, and a refusal is shown until the next key. Which letter becomes current is DISTILL's (default: the first) |
| Rows answered (from a load, or the rows of a POST answer, with `listedAt` t) | Applied only if t ≥ the last applied `listedAt`: rows replaced, status available, last applied = t. Otherwise the rows are ignored. A confirmed row that the new rows no longer contain (pruned, or pushed down by newer signings) loses its highlight, and the signing stays confirmed |
| Load failed | If the status is unknown: unavailable. Otherwise nothing (unavailable only while no table has ever loaded; a failed refresh keeps the last good table) |
| Signing answered (signing n, rows, id, `listedAt`) | The rows as in "Rows answered". Then, if n is the current signing and it is pending: confirmed, with the rank taken from the id's position in this answer's own rows, or off-table if the id isn't in them. The settled outcome is recorded for the status mirror. This settles the signing even when its rows are too old to apply |
| Signing failed (signing n: a non-OK answer, a network error or the 5000 ms timeout) | If n is the current signing and it is pending: unconfirmed, or paused when the error is `signing-paused` (only if the ADR-007 fallback is adopted). The settled outcome is recorded for the status mirror. The table state is unchanged |
| Answer for a replaced signing (n older than the current signing) | Its rows apply as in "Rows answered". Its outcome (confirmed with its rank from its own rows, off-table, unconfirmed or paused) is recorded once for the status mirror to announce. The current signing's status and highlight don't change |
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
| pending (n) | 503 `signing-paused` (only if the ADR-007 fallback is adopted) | paused | "High-score signing is paused; FAB wasn't saved." (a distinct message that never says "may have been saved") |
| any status of the current signing n | Answer or failure for a replaced signing m (older than n) | unchanged | m's outcome is announced once by the status mirror ("Signed ABC, #r", off-table, "Couldn't confirm ABC's signing" or paused). Its rows apply under DDD-12. n's status and highlight don't change |
| pending, confirmed, off-table, unconfirmed, paused | Enter (new game) | unchanged | An outcome that arrives during play is announced by the status mirror only. Nothing is drawn on the canvas mid-game |

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
| DDD-2 | Pure `chooseStore`; site store only on an explicit `'production'`; a missing deploy ID is a 500 |
| DDD-3 | Shared pure `src/game/high-scores.js`; `makesTheTable` is the browser's |
| DDD-4 | Restricted table-store port built by the composition roots; GET gets `list` only |
| DDD-5 | 415, 413, 400 validation; rate limit (DEVOPS go/no-go); word filter; owner moderation |
| DDD-6 | `no-store` and JSON on every answer from the function; 429 is Netlify's |
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
| DDD-17 | Structured logs with fixed reasons; scope and raw context; never message, key, body, id, initials or IP |
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
  - **Go/no-go on `config.rateLimit`** for the site's plan (and the exact numbers, about 60 per 60 s). If it isn't honoured, the ADR-007 fallback applies. Check the ADR-007 worst-case operation counts against the plan's function and Blobs allowances.
  - **If the fallback is adopted, the owner's procedure to pause signing**: set the environment variable in the Netlify UI, then trigger a redeploy (the switch takes effect only after the redeploy, typically within minutes), then check that a POST answers 503 `signing-paused` and a GET still works. Resuming is the same in reverse.
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
    - paused, only if the ADR-007 fallback is adopted
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
  - the paused outcome and the switch's time to take effect (ADR-007 fallback)
  - "as old as the last successful refresh" (DDD-7)

## Wave: DESIGN / [REF] Wave decisions summary

- **Pattern**: a modular monolith with ports and adapters (browser SPA), plus one thin server-side adapter (a Netlify Function) around shared pure rules and a restricted store port. **Paradigm**: OOP (`CLAUDE.md`).
- **New**: `src/game/high-scores.js` and the import-scan unit test. **Extended**: `game.js`, `main.js`, `platform/leaderboard.js`, `status.js`, `render.js`, `index.html`, `netlify/functions/scores.mjs`, `scripts/serve.mjs`.
- **Constraints**:
  - the network never sits on the frame path, and only `game.js` writes `g`
  - only an explicit `'production'` context uses the site-wide store
  - the handler reaches the store only through the restricted port
  - one blob key per score, with well-formed keys only and bounded best-effort pruning
  - table rows apply in server listing order (`listedAt`)
  - the function sets `no-store`
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
