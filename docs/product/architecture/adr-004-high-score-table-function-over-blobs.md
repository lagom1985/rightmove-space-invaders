# ADR-004: The shared high-score table is a Netlify Function over Netlify Blobs, one blob key per score

**Status**: Accepted (2026-10-24, revision 3) · **Feature**: rightmove-invaders-leaderboard

## Context
The user asked for an arcade high-score table that everyone shares: a deposit that makes the top 10 is signed with three initials, and another computer sees the same table. The game is static files on Netlify. The browser can't talk to Netlify Blobs directly, so something server side has to own the table. The table must not lose or overwrite a score when players sign at the same moment.

The SPIKE ([findings](../../feature/rightmove-invaders-leaderboard/spike/findings.md)) ran 20, 50 and 100 simultaneous submissions against the `BlobsServer` emulator from `@netlify/blobs` 11.1.6:
- **Single `top10` blob, read-modify-write**: lost scores in 30 of 30 rounds.
- **The same with an `onlyIfMatch` etag and retries**: also lost scores in 30 of 30 rounds. The emulator returns no etag on reads, `onlyIfMatch: undefined` writes unconditionally, and its conditional write is not atomic.
- **One key per score**, with well-formed keys only and pruning of at most 5 per submit: lost 0, with a p95 submit time of 20 ms at 20 players and 268 ms at 100.

Nothing was deployed.

## Decision
- **One Netlify Function (v2)**, `netlify/functions/scores.mjs`, at `/api/scores`. GET returns the table. POST signs it and returns the table plus the new row's id.
- **Storage layout D.** Each score is an empty blob whose key holds everything: `s/{9999999 − score, 7 digits}-{epoch ms, 15 digits}-{initials}-{random id}`.
  - A key is written only if it is new. An existing key means the score was not saved (503 `not-saved`).
  - Sorting the keys as strings gives the arcade order: higher score first, then the earlier signature.
  - The table is computed from a strong-consistency listing of `s/`, with no blob bodies read.
  - Only keys matching `^s/\d{7}-\d{15}-[A-Z]{3}-[a-z0-9]+$` count.
- **Bounded, best-effort pruning.** Once there are more than 20 well-formed keys, each POST deletes k = min(5, n − 20) of those ranked 11th or lower in its listing, n being the well-formed keys in the listing taken after its write (exact rule accepted: user, 2026-10-24; DELIVER replaces the skeleton's fixed delete-5). A row only ever leaves the table by being pruned, so a key ranked below 10th can never climb back, and any instance may delete it without coordination. A store failure during a delete is caught and logged with a fixed reason (`prune-failed`), and the POST still answers 200: the next POST prunes again.
- **Listing time.** Every answer that carries rows also carries `listedAt`, the function's `Date.now()` in ms, taken right after its `list` call returns. The browser orders answers by it (ADR-008).
- **A restricted table-store port.** The handler never holds a `@netlify/blobs` `Store`.
  - The composition roots (the Netlify entry, and `scripts/serve.mjs` locally) build the port around the store they chose, from one factory in the function file.
  - The port has three operations: `list` (the well-formed keys under `s/` only), `putIfNew(key)` and `remove(key)`. `putIfNew` and `remove` throw a refusal for any key that isn't well-formed. The handler maps a refusal to 500 `unexpected`, even during pruning: a refusal is a bug, not a store failure, so it is never swallowed as `prune-failed`.
  - It has no `deleteAll` and no other store access.
  - The read path (GET) receives `list` alone.
- **`@netlify/blobs` is a runtime dependency of the function only.** The browser keeps no runtime dependencies.
- **The same handler runs locally.** `scripts/serve.mjs` mounts it against a `BlobsServer` emulator, through the same port. `npm start` and the test suite therefore run the real function and the real Blobs client without the Netlify CLI or an account. The handler's unit tests use the port over the real emulator, not a hand-written fake.

## Alternatives considered
- **A single `top10` blob with read-modify-write**: the obvious layout. It lost scores in every concurrent round.
- **A single blob guarded by etag compare-and-swap**: it can't be proven locally (the emulator gives no read etags and has no atomic conditional write), and a missing etag silently turns into an unconditional write. Revisit only if compare-and-swap is verified on real Netlify.
- **Handing the handler the full `Store`** (the skeleton): simpler, but a bug in the handler could delete anything in the store (`deleteAll`, junk keys, other prefixes). The port makes that impossible, rather than merely untested.
- **An external hosted database** (Supabase, Turso, Upstash): it would work, but adds a vendor, an account, a secret in the Netlify environment and another network hop, for a table of 10 rows.
- **A JSON file in the repo, committed by a bot**: needs a write token and a deploy per score, and takes minutes to show.
- **`localStorage` only**: not shared, so it fails the brief.

## Consequences
- **Positive**: no lost signatures, by construction rather than by retries. The store stays at about 20 keys. A GET is one listing; a POST is one write, one listing and at most 5 deletes. Whatever the handler does, it can only add or remove well-formed score keys.
- The key format is now a persisted schema. Changing it means a new prefix, which also starts a new, empty table. The 7-digit score field caps a score at £9,999,999.
- If pruning keeps failing, keys accumulate. The log's key count shows it, and above 40 something is wrong.
- **Negative**: the emulator is not production. Real Netlify latency, cold starts and `list` consistency right after a write are only verified by the DEVOPS smoke test, which includes a concurrent burst on a preview.
- `consistency: 'strong'` needs `uncachedEdgeURL` in the Blobs context, locally too.
- The production store has no backup. Losing it means an empty table again, and that loss is accepted.
- The game now makes a network call to its own origin, and the project has its first runtime dependency (server side only).
