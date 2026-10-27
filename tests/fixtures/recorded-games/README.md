# Recorded games

The recorded-games corpus (rightmove-invaders-replay-verified-scores, DESIGN DDD-R12, K21): bot games played in Node on
the real rules, one JSON file per game, `{ seed, record, deposit, steps }` and nothing else (no session, token or time).

- **Made** on demand, once the rules are deterministic (DELIVER, enabling task E5), and again after every `RULES_VERSION`
  bump: `node scripts/record-corpus.mjs`. It refuses to overwrite a game recorded on the rules version the game plays
  now: a game that plays back differently on the same rules version is a change to how the game plays, and the check
  is right to fail. The check itself never records.
- **Checked** in every build (Node, where the table replays it) and in every `npm test` (Chromium, Firefox and WebKit):
  `tests/e2e/rightmove-invaders-replay-verified-scores/acceptance/milestone-6-the-same-game-everywhere.feature`
  (`npx playwright test --grep @corpus`).
- **Signed** by the preview smoke test (the longest one, K22) and by the server scenarios of long games.

The players and the bands are in `tests/common/recorded-games.js` and `tests/common/played-games.js`.
