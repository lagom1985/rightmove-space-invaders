# ADR-005: The high-score store is chosen by deploy context

**Status**: Accepted (user, 2026-10-24, revision 2); amended in DEVOPS (user, 2026-10-24): only the published production deploy writes the site store; qualified by [ADR-012](adr-012-the-table-replays-every-game.md) (user, 2026-10-26): sessions from an older production deploy · **Feature**: rightmove-invaders-leaderboard

## Context
`getStore('leaderboard')` is site-wide. In the walking skeleton every deploy uses it, so a deploy preview or a branch deploy signs the production table. **Until this ADR is implemented, the branch `worktree-leaderboard-spike` must not be pushed.** The production table must survive new deploys and rollbacks. Preview smoke tests (DEVOPS) need to sign freely and start from an empty table. Locally, `scripts/serve.mjs` already gives each `test-board` cookie a table of its own.

Netlify Functions v2 receive a `Context` whose `deploy` object carries:
- `context`: `production`, `deploy-preview`, `branch-deploy` or `dev`
- the deploy `id`
- `published`: "a boolean that indicates whether or not the function belongs to the current published deploy" (Netlify Functions API reference)

`getDeployStore()` scopes a store to the current deploy and reads the deploy ID from the Blobs environment. Without a deploy ID it throws `MissingBlobsEnvironmentError` (`@netlify/blobs` 11.1.6).

Every deploy keeps its own copy of the function, reachable at its permalink until the deploy is deleted (DEVOPS, from Netlify's deploy docs). So an older production deploy still answers, with its own code and the context `production`.

## Decision
- **A pure function `chooseStore(context)`** in the function file returns `'site'` only when `context?.deploy?.context === 'production'` **and** `context?.deploy?.published === true` (amended in DEVOPS (user, 2026-10-24)). Anything else gets `'deploy'`. A unit test covers at least these cases:

  | `context` passed to `chooseStore` | Result |
  |---|---|
  | `{ deploy: { context: 'production', published: true } }` | `'site'` |
  | `{ deploy: { context: 'production', published: false } }` (an older or not yet published production deploy) | `'deploy'` |
  | `{ deploy: { context: 'production' } }` (`published` missing) | `'deploy'` |
  | `{ deploy: { context: 'production', published: 'true' } }` (not a boolean) | `'deploy'` |
  | `{ deploy: { context: 'Production', published: true } }` (spelled differently) | `'deploy'` |
  | `{ deploy: { context: 'deploy-preview', published: false } }` | `'deploy'` |
  | `{ deploy: { context: 'deploy-preview', published: true } }` | `'deploy'` |
  | `{ deploy: { context: 'branch-deploy', published: false } }` | `'deploy'` |
  | `{ deploy: { context: 'dev' } }` | `'deploy'` |
  | `{ deploy: { published: true } }` (no context) | `'deploy'` |
  | `{}` (no `deploy`) | `'deploy'` |
  | `undefined` | `'deploy'` |

- The Netlify entry opens the store with `getStore({ name: 'leaderboard', consistency: 'strong' })` for `'site'`, and with `getDeployStore({ name: 'leaderboard', consistency: 'strong' })` for `'deploy'`. It then wraps the store in the restricted table-store port (ADR-004).
- If the store can't be opened (for example, `getDeployStore` without a deploy ID), the answer is 500 `unexpected`, logged with the reason `store-unavailable`. The site store is never used as a fallback.
- The store is passed into the handler, so the choice lives only in the composition roots. `scripts/serve.mjs` passes its own store (one per `test-board` cookie, or `local`) with scope `local`. The production entry never reads that cookie.
- Every log line carries a fixed reason (ADR-007) and three more fields:
  - the `scope` (`site`, `deploy` or `local`)
  - the raw `context` value (or `missing`)
  - the raw `published` value (or `missing`; added in DEVOPS (user, 2026-10-24))

  The detection failure is named **"scope=deploy on the production site"**.

## Alternatives considered
- **`getStore('leaderboard')` everywhere** (the skeleton): the simplest, but every preview and branch deploy writes to the real table.
- **`getDeployStore()` everywhere**: fully isolated, but the production table would empty on every deploy and roll back with every rollback.
- **The deploy context in the store name** (`leaderboard-deploy-preview`): one lasting table that all previews share. Previews pollute each other, and smoke tests don't start from empty.
- **Treating a missing context as production**: production keeps working if the field disappears, but a preview could then write to the real table. Rejected: integrity matters more than continuity, and the failure is detectable.
- **The context alone, without `published`** (revision 2): an older production deploy, reached through its permalink, would sign the real table with that deploy's code, including any validation bug fixed since. Rejected by the user in DEVOPS (2026-10-24).

## Consequences
- The production table is shared by every production deploy, so it survives deploys and rollbacks. Only the deploy that is published at the time writes it.
- **Old production deploys can't sign the real table with old code.** Reached through their permalinks, they write a deploy store of their own, which Netlify deletes with the deploy. A production deploy built while auto publishing is locked does the same, until it is published.
  - *Qualified by ADR-012 (user, 2026-10-26; corrected after the DEVOPS review)*: each deploy keeps the session secret's value it was built with.
    - A page on an older permalink signs to that permalink's own function, which stores the row in its own deploy store.
    - A session an older production deploy issued verifies on the published deploy only if both were built with the same value. The published deploy then checks the signing with its own code (its replay and its rules version), so old code still decides nothing on the real table.
- **A rollback publishes the chosen deploy, which then writes normally**: `published` is true for it from that moment, and false for the deploy it replaced.
- Each preview or branch deploy starts with an empty table of its own, which Netlify deletes along with the deploy.
- **Detection**: if the `context` field, or the `published` field on the published deploy, were ever missing or renamed, production would use a deploy store. Scores would seem to reset at the next deploy, but no preview and no old deploy could write to production.
  - After each deploy and each rollback, DEVOPS reads the log line of one production GET that misses the CDN cache (`?table=<random>`; a cached GET runs no function). It expects `scope=site` and `published=true` (K13).
  - The script can't see these fields, because the answers don't carry them. So the owner reads the preview's function log line for the smoke test's first request by hand. It must show `context=deploy-preview` and `published=false`, both present as raw values, which confirms that `published` arrives from the v2 `Context` as a boolean. The smoke test checks separately that preview signatures don't appear in production.
  - Once there is an older production deploy with the function, a POST to its permalink must land in its own store (K13). The smoke test's write guard refuses that POST if the permalink's ID equals the published deploy's ID, and it never takes that ID from a command-line flag. It reads `published_deploy.id` from the Netlify API when the owner gives a personal access token (`NETLIFY_AUTH_TOKEN`). Without a token, it prints the target's deploy ID and requires the owner to type back the published deploy's ID, read in Netlify → Deploys.
- Moving to a periodic table later (monthly, for example) is a key-prefix change inside the chosen store. This ADR doesn't change for it.
