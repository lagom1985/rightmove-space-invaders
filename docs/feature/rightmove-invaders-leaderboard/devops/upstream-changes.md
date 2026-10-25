# DEVOPS upstream changes: rightmove-invaders-leaderboard

2026-10-24 · nw-platform-architect · against DESIGN revision 3. Each change is applied in place in the DESIGN documents. They are marked "amended in DEVOPS (user, 2026-10-24)". All four are the user's decisions: §3 began as a DEVOPS recommendation and was then decided by the user. The DEVOPS record itself is in [feature-delta.md](../feature-delta.md), under "Wave: DEVOPS".

## 1. Successful GETs are cached at the CDN for 15 s (user decision 12)

**What it reverses**: DDD-6, for successful GETs only. The original, in `docs/feature/rightmove-invaders-leaderboard/feature-delta.md` (DDD-6): "HTTP contract: every answer from the function sets `Cache-Control: no-store` itself and has a JSON body." Also, in `docs/product/architecture/adr-007-proportionate-abuse-controls.md` (Consequences): "Every answer from the function is `Cache-Control: no-store` with a JSON `{ error }` body for errors."

**The new contract.** The function sets every header itself:

| Answer | Headers |
|---|---|
| GET 200 | `Netlify-CDN-Cache-Control: public, s-maxage=15, durable` · `Cache-Control: public, max-age=0, must-revalidate` |
| Every other answer from the function: POST (any status), GET 500, 405, every error | `Cache-Control: no-store` |
| Every answer from the function | `Netlify-Vary: query=table`, and a JSON body |
| 429 | Netlify's own (unchanged) |

**Why**: legacy plans bill functions per request. With `durable`, edge nodes share one cached answer instead of each invoking the function. Netlify's caching docs describe this, and the legacy billing FAQ suggests it to cut function usage. GET invocations drop to about 4 a minute per hostname, however many people play.

**Why `Netlify-Vary: query=table`**:
- For function responses, query parameters are part of the cache key by default (caching docs), so `/api/scores?x=<random>` would miss the cache every time.
- With the header, every request without a `table` parameter shares one cache object. `?table=<n>` is the deliberate miss that the smoke test and the production check use.
- The header goes on every answer, because "if different resources for the same URL return different `Netlify-Vary` settings, the instructions for the first resource cached for that URL are used" (caching docs).
- A client that forces misses costs one invocation per request, like a POST, and is rate-limited the same way.

**Consequences**:
- Another computer sees a new row up to about 15 s late. The signer sees it at once, in the POST answer.
- No rule changes: a cached GET carries the `listedAt` of its own listing, so after a newer POST answer DDD-12 ignores it (ADR-008).
- Qualification (`makesTheTable`) can use a table up to 15 s older than the last refresh. The server still ranks every valid signature, and the off-table outcome covers the rest.
- A cached GET runs no function and logs nothing, so the after-deploy check (ADR-005, K13) uses `?table=<random>`.
- Locally there is no CDN, so the headers are inert; with no validator, the browser fetches again each time. `scripts/serve.mjs` passes the function's headers through (DESIGN already has it stop adding `no-store`).
- Test (DELIVER): a `unit` test of the header set per answer (GET 200, GET 500, POST 200, a POST error, 405).

**Applied to**:
- the feature delta: DDD-6 and its decisions-table row, the handler delta's closing line, and the summary constraint
- ADR-007: Consequences
- ADR-008: "When the table is read" and Consequences
- the outcomes registry: OUT-7, and OUT-8's `no-store` clause
- the brief's Application Architecture: the security bullets and the Score API row

## 2. Rate limit: 10 requests per 60 s per IP and domain (user decision 11)

**The originals**:
- `docs/feature/rightmove-invaders-leaderboard/feature-delta.md` (DDD-5): "`config.rateLimit` asks for about 60 requests per minute per IP and domain, across GET and POST: a DEVOPS go/no-go for the site's plan, with a fallback."
- `docs/product/architecture/adr-007-proportionate-abuse-controls.md`: "`config.rateLimit` on the function asks Netlify for about 60 requests per minute, aggregated by IP and domain."

**The new rule**: `config.rateLimit = { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] }`, with the default action (429). It is one rule on the one function: Free plans (credit-based or legacy) allow 2 code rules per project, and function rules can't be set in `netlify.toml`.

**Facts** (rate-limit docs):
- Rate limiting is available on every plan, and enforcement can lag by up to 10 s.
- Counters are per IP and per domain. Per-domain (total) aggregation is Enterprise only.
- Rules are validated during post-processing and listed in the deploy log. An invalid rule doesn't fail the deploy.

**Honest use**: a page load, about 1 GET per game and 1 POST per signing, so a player makes a few requests a minute. An office behind one IP shares the 10:
- a 429 on a GET keeps the last good table (ADR-008)
- a 429 on a POST shows "Couldn't confirm FAB's signing", although nothing was saved, because the function didn't run

This is accepted. If it bites, split GET and POST into two functions, using the second rule.

**The worst case, recalculated (ADR-007)**: for a client that stays at the limit (see §5), 14,400 invocations a day per IP and hostname. That spends the month's 125k in about 8.7 days, with up to 100,800 Blobs operations a day if they are all POSTs. A fast client gets far more through: one IP at 20 a second spends the month in about 10 hours (§5). K14 measures two things this depends on: whether cache hits count toward the limit, and how much the lag lets through in each window.

**Applied to**:
- the feature delta: DDD-5 and its decisions-table row, the catalogued lie, and the handler delta's 429 row
- ADR-007: Rate limit, and Worst-case operation counts
- the outcomes registry: OUT-8
- the brief's Application Architecture

## 3. The ADR-007 fallback is rejected (user, 2026-10-24)

**The fallback** (ADR-007, revision 3): "ship without it, and give the owner a switch". An environment variable made every POST answer 503, with an error code of its own and a distinct client outcome, while GET was unaffected.

**The decision**: **rejected.** There is no environment switch, no extra 503 code and no paused outcome; the client tells only OK from not OK. K14, the preview check of the rate limit, is the go/no-go: if the limit fails, that is a no-go, and there is no merge to `main`. DEVOPS recommended this, and the user decided it.

**Reasoning** (DEVOPS's, now recorded in ADR-007 under "Alternatives considered"):
1. **Its trigger is gone.** Rate limiting is available on the plan (Free: 2 code rules per project), and whether it holds is measured, not assumed.
2. **It saves no quota.** Legacy plans bill functions "by request count, regardless of runtime" (functions usage docs), so a POST answered 503 at once costs the same invocation as a saved one. GETs aren't paused at all.
3. **It is slower than the kill switch.** The switch takes an environment variable and a redeploy: a build, minutes, and build minutes. Publishing the last deploy without the function is instant (deploy docs: "Rollbacks are instantaneous"), and it removes the function, so invocations stop.
4. **It wouldn't fix a failed rate limit either.** Without a working limit, the switch still wouldn't cap cost, and shipping on legacy Free would then risk a pause of every site on the account. The right answer is a no-go.
5. **Its one advantage is small.** It keeps reads while stopping writes. Deleting rows (the owner guide) covers that, and if vandalism persists, so does the kill switch, after which the game plays without a table. A read-only table instead of no table is a small difference for a fan game.
6. **It costs code and tests**: an environment-variable read, a 503 code, a client outcome and its message, a log reason, a DISTILL scenario, and clauses in OUT-8 and OUT-11.

**Deleted** (every conditional "only if the ADR-007 fallback is adopted", and every mention of the fallback's error code):
- the feature delta: DDD-6 (the extra 503 and the client's exception), DDD-8, the `scores.rejected` log reasons, the client component, the handler row, the "Signing failed" and "Answer for a replaced signing" rules, the lifecycle's paused row and the paused mentions in its other rows, the DISTILL scenario "paused", and the DESIGN open question about the pause procedure
- ADR-007: the Fallback bullets, which now appear only under "Alternatives considered", as rejected; the log-reason example
- ADR-008: the paused outcome, and paused in the replaced-signing and Enter bullets
- the outcomes registry: OUT-8's last clause and OUT-11's paused outcome

DISTILL writes no paused scenario, and DELIVER reads no environment variable.

## 4. Only the published production deploy writes the site store (user, 2026-10-24)

**The original** (ADR-005, DDD-2): "`chooseStore(context)` … returns `'site'` only when `context?.deploy?.context === 'production'`, and `'deploy'` for anything else."

**The new rule**: `'site'` only when `context?.deploy?.context === 'production'` **and** `context?.deploy?.published === true`; everything else gets `'deploy'`. The Functions API reference documents `deploy.published` as "a boolean that indicates whether or not the function belongs to the current published deploy".

**Why**: every deploy keeps a callable copy of its function at its permalink until the deploy is deleted, and an older production deploy still reports the context `production`. Under the old rule it would sign the real table with old code, including any validation bug fixed since.

**Consequences**:
- An older production deploy reached through its permalink writes a deploy store of its own. So does a production deploy built while auto publishing is locked, until it is published.
- A rollback publishes the chosen deploy, which then writes normally; the deploy it replaced stops writing the real table.
- **A new failure mode, detected the same way as before**: if `published` were missing or not `true` on the published deploy, production would use a deploy store, and scores would seem to reset at the next deploy. K13 catches it on the first production GET after each deploy or rollback.
- **Observability**: every log line now carries the raw `published` value (or `missing`), next to `scope` and `context` (DDD-17, ADR-005, ADR-007, OUT-13). Without that field, the smoke test couldn't confirm that the flag comes from the v2 `Context`.
  - A preview's line shows `published=false`.
  - The `true` case only shows on production (K13).
- **The smoke test** (production mode, once): after the second production deploy that has the function, a POST to the older deploy's permalink must land in its own deploy store (`scope=deploy, context=production, published=false`), and its id must be absent from the production GET. Before that deploy exists, the `chooseStore` unit table covers the case.
- **Unit table** (ADR-005): 12 cases, including production with `published` false, missing, and the string `'true'`.

**Applied to**:
- the feature delta: DDD-2 and its decisions-table row, DDD-17, the catalogued lie on context detection, the DESIGN summary constraint, and the DEVOPS environment matrix, smoke spec, K13, rollback, residual risks and pre-requisites
- ADR-005: the status, the context, the decision with its case table, the log fields, a rejected alternative and the consequences
- OUT-13
- the brief: the integrity attribute, Operability, the store bullets and the observability check
- `environments.yaml` and the K12/K13 rows of `kpi-contracts.yaml`

## 5. After the platform review, iteration 2 (2026-10-24)

No user decision is reopened. These are the review's changes that touch DESIGN documents. The rest are in the feature delta's DEVOPS sections, `environments.yaml` and K10–K15.

- **Uncaught errors (M7)**:
  - DDD-17 and ADR-007 now say that nothing escapes the handler. A catch-all around the request handler logs only `scores.error` with the reason `unexpected` and answers 500 `unexpected`, so no request-time error's message or stack, which could carry a key and so initials, reaches Netlify's log.
  - Module-load errors and runtime timeouts sit outside the handler. The risk is low, because no key is on that path (final fixes, N9).
  - `scripts/serve.mjs` logs the fixed reason only (today it calls `console.error(error)`).
  - The log-leak test captures every console method while a store throws an error whose message contains a key.
  - The brief's "Data kept" says the same.
- **The abuse model (B2)**: ADR-007's worst-case counts now use the lag formula, 10 + 10r a minute per hostname. One IP at 20 a second makes about 302,400 invocations a day: the month in about 10 hours, about an hour after the 90% email, and up to about 2.1 M Blobs operations a day if they are all POSTs. The earlier "about 9 days" held only for a client that stays at the limit. The brief's Quotas line is corrected to match.
- **The stale-listing lie (M4)**: the burst now runs on a throwaway preview with the rate-limit rule removed, so that the rule can't make it inconclusive. An inconclusive run is never a pass.
- **ADR-005 (minor)**: the detection bullet now says how `published` is read: by hand, from the preview's log line for the smoke test's first request, because the answers don't carry it. It also names the write guard on the unpublished check.
- **Privacy (minor)**: the brief and ADR-007 now say that signatures are kept until pruned or deleted by the owner, with no backup, and that Netlify processes client IPs for rate limiting.

## Applied edits

| Document | Where | Change |
|---|---|---|
| `docs/feature/rightmove-invaders-leaderboard/feature-delta.md` | DDD-2 | The site store needs `published === true` (§4) |
| same | DDD-5 | 10 per 60 s; go/no-go on a preview (K14); no fallback |
| same | DDD-6 | GET 200 cached 15 s (headers above); everything else `no-store`; `Netlify-Vary: query=table` on every answer; OK or not OK only (§3) |
| same | DDD-8, the client component, the rules operations, the lifecycle, the log reasons, the DISTILL list, the open questions | The fallback's conditionals and its paused outcome deleted (§3) |
| same | DDD-17 and its decisions-table row | The raw `published` value in every log line (§4); the handler's catch-all and the test over every console method (§5) |
| same | Catalogued lies: context detection; stale listing; "`config.rateLimit` isn't honoured" | The `published` cases; the burst on a throwaway preview (§5); no-go means no merge to `main` |
| same | Handler delta: the 429 row, the paused row (deleted) and the closing line | The numbers; the cache sentence |
| same | Decisions table: DDD-2, DDD-5 and DDD-6 | Short forms of the above |
| same | DESIGN wave decisions summary: the store and `no-store` constraints | Published deploy only; its own cache headers |
| `docs/product/architecture/adr-005-table-store-by-deploy-context.md` | Status; Context; Decision (case table, log fields); Alternatives; Consequences | §4; the after-deploy check is a cache-busting GET expecting `published=true`; how `published` is read, and the write guard (§5) |
| `docs/product/architecture/adr-007-proportionate-abuse-controls.md` | Status; Rate limit; Fallback (moved to Alternatives, rejected); privacy and logs; Worst-case operation counts; Consequences | §1–3; the lag-based worst case, the catch-all and the privacy wording (§5) |
| `docs/product/architecture/adr-008-table-probed-never-awaited.md` | Status; "When the table is read"; the lifecycle; Consequences | A GET answer may come from the CDN, up to 15 s old; the paused outcome removed |
| `docs/product/outcomes/registry.yaml` | OUT-7, OUT-8, OUT-11, OUT-13 `output.shape` | The cache headers; the rate-limit numbers; the paused outcome removed; `published` |
| `docs/product/architecture/brief.md` | Application Architecture: the integrity attribute, the security bullets, Operability, "Data kept" and the Score API component row | The rate-limit, cache, store and data-kept wording (§5). The Platform and Delivery section is DEVOPS's own, and was rewritten |
