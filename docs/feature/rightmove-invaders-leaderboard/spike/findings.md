# SPIKE Findings: rightmove-invaders-leaderboard

**Date**: 2026-10-24
**Probe question**: Can a Netlify Function keep an arcade top 10 in Netlify Blobs without losing a score when 20 players submit at the same moment?
**Budget**: submit + read the table < 1 s at p95.
**Where**: local only (user's choice), against the `BlobsServer` emulator shipped in `@netlify/blobs@11.1.6/server`. Nothing was deployed. Real Netlify latency and consistency are **not** measured here.
**Probe code**: one file, `probe.mjs` (~150 lines), kept outside the repository in the session scratchpad and deleted after promotion. Strategy D lives on in `netlify/functions/scores.mjs`.

**Promoted on 2026-10-24** into the walking skeleton (Netlify Function, local server, initials entry, high-score table). See [wave-decisions.md](wave-decisions.md).

## Verdict

**WORKS**, with one storage layout: **one blob key per score**, with the top 10 computed from the key listing. Across 50 rounds of 20 simultaneous submissions it lost 0 scores, and it also lost none at 50 and 100 simultaneous players. The p95 time to submit and get the table back was 20 ms (20 players) locally. The obvious layout, one `top10` JSON blob updated with read-modify-write, **loses scores in every round**, and the emulator cannot show whether the etag-guarded version of it would work.

## Results

Each round uses a fresh store. N players submit at once over HTTP to a Netlify Functions v2 handler (`(Request) => Response`) behind a minimal Node `http` adapter, which is the way `scripts/serve.mjs` could mount it. When all submissions have answered, one GET reads the table. A score counts as lost if it belongs in the true top 10 of that round but is missing from the table. Scores are distinct multiples of £50 and initials are random `A–Z`. Measured on an Apple M4 Pro with Node 22.20.

| Strategy | Players × rounds | Rounds with a loss | Scores lost | Submit p50 / p95 / max (ms) | Read p95 (ms) |
|---|---|---|---|---|---|
| A. one `top10` blob, read-modify-write | 20 × 30 | **30 / 30** | 280 | 14 / 18 / 73 | 1.3 |
| B. as A + `onlyIfMatch` etag + retry | 20 × 30 | **30 / 30** | 285 | 13 / 14 / 17 | 1.0 |
| C. one key per score + prune everything past 10th | 20 × 30 | 0 | 0 | 35 / 39 / 70 | 1.3 |
| C | 50 × 20 | 0 | 0 | 272 / 553 / 3,475 | 7.8 |
| C | 100 × 10 | **4 / 10** | 4 | 9,061 / 49,509 / 54,134 | 3.2 |
| **D. as C + well-formed keys only + prune at most 5 per submit** | 20 × 50 | 0 | 0 | 16 / **20** / 75 | 1.7 |
| D | 50 × 20 | 0 | 0 | 81 / 107 / 166 | 4.7 |
| D | 100 × 10 | 0 | 0 | 230 / 268 / 293 | 3.5 |

Strategy D is the one to build on. It is well inside the 1 s budget locally, but that says little about production, where every Blobs call is a network round trip from the function.

### How strategy D works

- **Key** = `s/{9999999 − score, 7 digits}-{epoch ms, 15 digits}-{initials}-{random id}`, empty body, written with `onlyIfNew`. Sorting keys as strings gives the arcade order: higher score first, and on a tie the earlier entry first. The table is read from `store.list({ prefix: 's/', consistency: 'strong' })` alone, with no blob bodies fetched.
- **Every write goes to a key of its own**, so concurrent writes never overwrite each other. That holds by construction, not through retries.
- **Pruning is safe under concurrency**: an entry ranked 11th or lower can never climb back, because entries only leave the table by being pruned. Any function instance can delete such keys without coordination. Each submit deletes at most 5 of them, and only once more than 20 keys exist, so a burst of submissions doesn't turn into a delete storm. The store stays at about 20 keys.
- **Only keys matching `^s/\d{7}-\d{15}-[A-Z]{3}-[a-z0-9]+$` count.** Anything else is ignored.

## Edge cases discovered

1. **The emulator never returns an etag on reads.** `getWithMetadata()` and `getMetadata()` give `etag: undefined` because its GET/HEAD handlers set no `etag` header. Only write responses carry one. The compare-and-swap in strategy B therefore can't be exercised locally at all.
2. **`setJSON(key, value, { onlyIfMatch: undefined })` silently writes unconditionally.** That is why B lost as many scores as A with zero retries. Any code that relies on etags must refuse to write when the etag is missing, never pass `undefined`.
3. **The emulator's conditional write is check-then-write** across several `await`s, and its etag is derived from the file's mtime (ms resolution). Even with etags it would not be atomic under concurrency. Whether production Netlify Blobs is atomic was not tested.
4. **The emulator lists its own temporary files.** A write goes to `.{random}` and is then renamed. `list()` walks the directory without skipping dotfiles, so in-flight writes appear as keys like `s/.k3j2…`. Those sort before every real key (`.` < `0`), so strategy C saw them as the top entries and pruned real top-10 scores (the 4 losses at 100 players). Filtering to well-formed keys fixes it, and it is sensible hygiene in production too.
5. **Unbounded pruning collapses under bursts.** In strategy C, every submit deleted everything past 10th, so 100 simultaneous submits issued thousands of overlapping deletes (p95 49 s on the emulator). Bounding it (D) brought p95 down to 268 ms.
6. **`onlyIfNew` on a duplicate key returns `{ modified: false }` and does not throw.** The random id makes collisions practically impossible, but the function should still treat `modified: false` as a failed submit.
7. **Strong consistency needs `uncachedEdgeURL`** in the Blobs context. Without it, a `consistency: 'strong'` read throws. Locally, the context has to set it next to `edgeURL`.

## Design implications

- **New container: a Netlify Function** (for example `netlify/functions/scores.mjs` with `config.path = '/api/scores'`, GET = table, POST = submit). The browser can't talk to Blobs directly. `@netlify/blobs` becomes the project's first runtime dependency. It is server-side only, and the browser game stays dependency-free. The architecture brief's "no network calls besides the font" no longer holds and needs updating (DESIGN).
- **Same handler locally and in production.** `scripts/serve.mjs` can start a `BlobsServer` and mount the function's default export at `/api/scores`, so `npm start` and the Playwright suite run the real function and the real Blobs client, with no Netlify CLI and no account. The emulator's quirks (no read etags, temp files listed) mean local green doesn't prove the production behaviour of anything etag-based. Strategy D avoids depending on either.
- **Test isolation is a DESIGN question.** Today, three browser projects run in parallel against one `npm start` server. A shared leaderboard makes scenarios interfere. Options: a store name per scenario passed in from the page URL, a fresh emulator directory per worker, or one serial project for leaderboard scenarios.
- **Production vs deploy previews.** `getStore(name)` is site-wide, so a deploy preview writes to the production table. Use `getDeployStore()` for non-production contexts, or put the deploy context in the store name.
- **Anyone can post any score.** The game runs in the browser, so a score can't be proven. Cheap mitigations are strict validation (initials `^[A-Z]{3}$`, an integer that is a multiple of £50, below a plausible maximum), the function's `config.rateLimit`, and a short blocklist of 3-letter words. Accept the rest as the risk level of an internal game (DESIGN / product decision).
- **Arcade flow.** At game over, GET the table to decide whether the score qualifies (fewer than 10 entries, or above 10th). Only then ask for initials, POST them, and show the table with the player's row highlighted. The POST response should carry the new entry's id so the client can find that row. A score that misses the table is never asked for initials (classic behaviour).
- **The game must still work when the table can't be reached** (offline, a static host without the function, or a 5xx). Keep the local best in `localStorage` as today and show "table unavailable" instead of blocking.
- **Not yet covered**: real Netlify latency and `list` consistency (a deploy-preview smoke test belongs in DEVOPS), how many keys `list()` returns before paging matters (a non-issue at about 20 keys), and cold-start time of the function.
