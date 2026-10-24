import { randomUUID } from 'node:crypto';
import { test as base } from 'playwright-bdd';

// table: this scenario's own high-score table, and the page of whoever is looking at it now.
// The local server (scripts/serve.mjs) keeps one table per `test-board` cookie, so scenarios running
// side by side in three browsers never see each other's scores. A cookie, unlike an extra header,
// never reaches Google Fonts.
export const test = base.extend({
  table: async ({}, use) => {
    const table = { board: randomUUID(), viewer: null, others: [] };
    await use(table);
    for (const context of table.others) await context.close();
  },
});
