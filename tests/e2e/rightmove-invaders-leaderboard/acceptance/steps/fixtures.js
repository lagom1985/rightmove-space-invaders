import { randomUUID } from 'node:crypto';
import { test as base } from 'playwright-bdd';

// table: this scenario's own high-score table, and the page of whoever is looking at it now.
// The local server (scripts/serve.mjs) keeps one table per `test-board` cookie, so scenarios running
// side by side in three browsers never see each other's scores. A cookie, unlike an extra header,
// never reaches Google Fonts.
// game: the real page against that table, played with the real keyboard (browser projects).
// tableService: the Score API's handler called from Node, on a Blobs emulator of its own (project in-memory, @server).
// rules: the game's rules on their own, with the table's answers handed over in any order (project in-memory, Tier B).
// The drivers are imported lazily, so a scenario only loads the one it uses.
export const test = base.extend({
  table: async ({}, use) => {
    const table = { board: randomUUID(), viewer: null, others: [] };
    await use(table);
    for (const context of table.others) await context.close();
  },
  // Every browser scenario plays at least one whole game until the hurdles win, and some play two.
  game: async ({ page, table, baseURL }, use, testInfo) => {
    testInfo.setTimeout(testInfo.timeout * 3);
    const { LeaderboardGame } = await import('./leaderboard-game.js');
    await use(new LeaderboardGame(page, table, baseURL));
  },
  tableService: async ({}, use) => {
    const { TableService } = await import('./table-service.js');
    const service = await TableService.start();
    await use(service);
    await service.stop();
  },
  rules: async ({}, use) => {
    const { SigningRules } = await import('../tier-b/signing-rules.js');
    await use(new SigningRules());
  },
});
