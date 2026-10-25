# SPIKE Decisions: rightmove-invaders-leaderboard

No DISCUSS artifacts exist for this feature. The brief came straight from the user (2026-10-24): save scores in Netlify Blobs; when a player finishes, ask for a name, then show the list the way every arcade does. Decisions below were made with the user on 2026-10-24.

## Concept
- **Arcade high-score table, shared by everyone who plays.** A deposit that makes the top 10 is signed with **3 initials** (A–Z, Up/Down change the letter, Enter takes it), the way arcade cabinets do it. A deposit that misses the table is never asked for initials.
- The table is kept server-side in Netlify Blobs behind a Netlify Function, so another computer sees the same table. The local best deposit (`localStorage`) stays as it is.

## Assumption Tested
- Can a Netlify Function keep an arcade top 10 in Netlify Blobs without losing a score when 20 players submit at the same moment? Budget: submit + read the table < 1 s at p95. Local only (user's choice): `BlobsServer` emulator, nothing deployed.

## Probe Verdict
- **WORKS** with one blob key per score and the table computed from the key listing: 0 scores lost across 50 rounds × 20 simultaneous players, and also at 50 and 100 players. Submit p95 was 20 ms locally (20 players). The single-`top10`-blob layout loses scores in every round, and its etag-guarded variant can't be tested on the emulator (it never returns etags on reads). See [findings.md](findings.md).

## Promotion Decision
- **PROMOTE** (user, 2026-10-24). The storage layout is proven and is the part with real risk. The rest (initials entry, table on screen) is ordinary game code to build around it.
- Built in an isolated worktree (`.claude/worktrees/leaderboard-spike`, branch `worktree-leaderboard-spike`), because another session was refactoring `main` at the same time. Rebased onto that refactor (`a2aaf50`) before any code was written.

## Walking Skeleton
- Driving adapter: the browser page, played with real keyboard events (Playwright `page.keyboard`), and a second browser context standing in for another computer.
- Driven adapters: the real Netlify Function (`netlify/functions/scores.mjs`) and the real `@netlify/blobs` client, mounted by `scripts/serve.mjs` against the local Blobs emulator, plus the DOM status mirror ("High scores" list). Nothing is mocked. Production Netlify is not exercised (local only, by decision).
- Slice: fresh table → play, score £50 → game over → "Enter your initials" → F, A, B → the table is topped by FAB £50 → another computer opens the game and sees FAB £50 at the top.
- Acceptance test: [walking-skeleton.feature](../../../../tests/e2e/rightmove-invaders-leaderboard/acceptance/walking-skeleton.feature). One `@walking_skeleton @driving_port` scenario, run in Chromium, Firefox and WebKit.
- Test isolation: each scenario gets a table of its own through a `test-board` cookie, which only the local server reads. A cookie and not an extra header, because Playwright's extra headers would also reach Google Fonts.
- Results: green in Chromium, Firefox and WebKit. Full suite 151 passed (unit 23, in-memory 23, 35 per browser); `npm run build` passed.
- Commit: `feat(rightmove-invaders-leaderboard): walking skeleton — sign the shared high-score table with arcade initials` (branch `worktree-leaderboard-spike`, not pushed)
- Demo command: `npm start`, then open http://localhost:4173, play until game over, sign, then open the game in a private window. Run the test with `npm test`.

## Design Implications
- **New container**: a Netlify Function (`/api/scores`: GET table, POST signature). `@netlify/blobs` is the project's first runtime dependency, server side only. The architecture brief's container diagram and its "no network calls besides the font" both need updating.
- **Storage layout is fixed by the probe**: one empty blob per score, with the score, time and initials encoded in the key. The table comes from the listing alone, only well-formed keys count, and pruning past 10th is bounded per submit. Don't switch to a single read-modify-write blob unless etag compare-and-swap is verified on real Netlify.
- **Same handler locally and in production**: `scripts/serve.mjs` mounts the function's handler against the emulator, so the suite needs no Netlify CLI and no account.
- **Production vs deploy previews**: `getStore('leaderboard')` is site-wide, so as built, a deploy preview writes to the production table. DESIGN should pick `getDeployStore()` or a store name by deploy context.
- **Abuse**: anyone can POST a score. The skeleton validates shape only (3 capital letters, an integer multiple of £50, below a cap). Rate limiting and a blocklist of 3-letter words are open DESIGN/product decisions.
- **Unreachable table**: the skeleton plays exactly as before when `/api/scores` fails (no prompt, no table). An explicit "table unavailable" message is DISTILL's. "Signed FAB." is announced before the server answers, even if the signing then fails.
- **Accessibility gap**: screen readers hear how to enter initials, but not the letter currently chosen.
- **Screen**: the compact game-over layout (initials or table below it) puts the title over the faded formation. It is readable, but needs a visual pass. The canvas is a manual check (waiver D10).
- **Docs out of date with the skeleton**: `CLAUDE.md` and `README.md` still say "no runtime dependencies", and the architecture brief has no function or Blobs container. DESIGN owns those updates.
- **Local server**: every start leaves an emulator directory (`make-the-right-move-blobs-*`) in the OS temp folder, and the emulator listens on all interfaces on a random port, protected by a random token.

## Constraints Discovered
- The local emulator returns no etag on reads, lists its own temp files as keys, and its conditional write is not atomic. Never rely on etags locally, and filter keys strictly.
- `setJSON(…, { onlyIfMatch: undefined })` writes unconditionally without any error.
- `consistency: 'strong'` needs `uncachedEdgeURL` in the Blobs context, locally as well.
- Presses of the same key within one frame count once (`takePressed` is a set), so initials entry in tests needs a frame per key.
- `playwright.config.js` now honours `PORT`, so two checkouts can run their suites side by side. `reuseExistingServer` would otherwise let one checkout's tests hit the other's server.
- Still open: real Netlify latency, cold starts and `list` consistency (a deploy-preview smoke test in DEVOPS), and how the table is shown when it can't be loaded.
