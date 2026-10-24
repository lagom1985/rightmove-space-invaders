# ADR-005: The high-score store is chosen by deploy context

**Status**: Accepted (user, 2026-10-24, revision 2) · **Feature**: rightmove-invaders-leaderboard

## Context
`getStore('leaderboard')` is site-wide. In the walking skeleton every deploy uses it, so a deploy preview or a branch deploy signs the production table. **Until this ADR is implemented, the branch `worktree-leaderboard-spike` must not be pushed.** The production table must survive new deploys and rollbacks. Preview smoke tests (DEVOPS) need to sign freely and start from an empty table. Locally, `scripts/serve.mjs` already gives each `test-board` cookie a table of its own.

Netlify Functions v2 receive a `Context` whose `deploy` object carries `context` (`production`, `deploy-preview`, `branch-deploy` or `dev`), the deploy `id` and `published`. `getDeployStore()` scopes a store to the current deploy and reads the deploy ID from the Blobs environment. Without a deploy ID it throws `MissingBlobsEnvironmentError` (`@netlify/blobs` 11.1.6).

## Decision
- **A pure function `chooseStore(context)`** in the function file returns `'site'` only when `context?.deploy?.context === 'production'`, and `'deploy'` for anything else. That includes a missing `deploy`, a missing context and a differently spelled value such as `'Production'`. A unit test covers exactly those seven cases.
- The Netlify entry opens the store with `getStore({ name: 'leaderboard', consistency: 'strong' })` for `'site'`, and with `getDeployStore({ name: 'leaderboard', consistency: 'strong' })` for `'deploy'`. It then wraps the store in the restricted table-store port (ADR-004).
- If the store can't be opened (for example, `getDeployStore` without a deploy ID), the answer is 500 `unexpected`, logged with the reason `store-unavailable`. The site store is never used as a fallback.
- The store is passed into the handler, so the choice lives only in the composition roots. `scripts/serve.mjs` passes its own store (one per `test-board` cookie, or `local`) with scope `local`. The production entry never reads that cookie.
- Every log line carries the `scope` (`site`, `deploy` or `local`) and the raw `context` value (or `missing`), next to a fixed reason (ADR-007). The context-detection failure is named **"scope=deploy on the production site"**.

## Alternatives considered
- **`getStore('leaderboard')` everywhere** (the skeleton): the simplest, but every preview and branch deploy writes to the real table.
- **`getDeployStore()` everywhere**: fully isolated, but the production table would empty on every deploy and roll back with every rollback.
- **The deploy context in the store name** (`leaderboard-deploy-preview`): one lasting table that all previews share. Previews pollute each other, and smoke tests don't start from empty.
- **Treating a missing context as production**: production keeps working if the field disappears, but a preview could then write to the real table. Rejected: integrity matters more than continuity, and the failure is detectable.

## Consequences
- The production table is shared by every production deploy, so it survives deploys and rollbacks.
- Each preview or branch deploy starts with an empty table of its own, which Netlify deletes along with the deploy.
- If the context field were ever missing or renamed, production would use a deploy store: scores would seem to reset at the next deploy, but no preview could write to production. DEVOPS reads one production GET's log line after each deploy and expects `scope=site`. The preview smoke test checks that the field is present, and that preview signatures don't appear in production.
- Moving to a periodic table later (monthly, for example) is a key-prefix change inside the chosen store. This ADR doesn't change for it.
