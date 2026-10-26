import { test as leaderboard } from '../../../rightmove-invaders-leaderboard/acceptance/steps/fixtures.js';

// The typed initials reuse the high-score table's fixtures and steps (the same page, table and signing), so this test
// extends the leaderboard's: playwright-bdd then picks it for any feature that mixes both features' steps.
// game: the leaderboard's page driver, extended with typing (steps/typed-entry-game.js). The leaderboard's own steps,
//   used by these scenarios, get this driver too; the leaderboard's own features keep theirs.
// entryRules: the game's rules on their own, typed into through handlePresses(pressed, typed) (project in-memory, Tier B).
// The drivers are imported lazily, so a scenario only loads the one it uses.
export const test = leaderboard.extend({
  game: async ({ page, table, baseURL }, use) => {
    const { TypedEntryGame } = await import('./typed-entry-game.js');
    await use(new TypedEntryGame(page, table, baseURL));
  },
  entryRules: async ({}, use) => {
    const { EntryRules } = await import('../tier-b/entry-rules.js');
    await use(new EntryRules());
  },
});
