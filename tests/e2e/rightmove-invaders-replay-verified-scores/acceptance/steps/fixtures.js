import { test as leaderboard } from '../../../rightmove-invaders-leaderboard/acceptance/steps/fixtures.js';

// The replay-verified table reuses the high-score table's fixtures and steps (the same page, the same table, the same
// table service), so this test extends the leaderboard's: playwright-bdd then picks it for any feature that mixes both
// features' steps, and the leaderboard's own steps get these drivers in these features. Its own features keep theirs.
// game: the leaderboard's page driver, extended for sessions, forgeries and real time (steps/verified-game.js).
// tableService: the leaderboard's table service, extended for sessions, records and the clock (steps/score-api.js).
// recordedGames: the recorded-games check, in Node (project in-memory) or in the page of a browser scenario.
// The drivers are imported lazily, so a scenario only loads the one it uses, and no browser scenario loads a scaffold.
export const test = leaderboard.extend({
  game: async ({ page, table, baseURL }, use) => {
    const { VerifiedGame } = await import('./verified-game.js');
    await use(new VerifiedGame(page, table, baseURL));
  },
  tableService: async ({}, use) => {
    const { ScoreApi } = await import('./score-api.js');
    const service = await ScoreApi.start();
    await use(service);
    await service.stop();
  },
  recordedGames: async ({}, use) => {
    const { RecordedGamesCheck } = await import('./recorded-games-check.js');
    await use(new RecordedGamesCheck());
  },
});
