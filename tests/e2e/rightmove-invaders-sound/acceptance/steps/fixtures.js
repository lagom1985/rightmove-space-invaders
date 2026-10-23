import { test as base } from 'playwright-bdd';

// game: the real page, played with the real keyboard (browser projects).
// director: the sound director against an in-memory cue model (in-memory project, no browser).
// Imported lazily, so in-memory scenarios never load the browser driver and vice versa.
export const test = base.extend({
  game: async ({ page }, use) => {
    const { GameDriver } = await import('./game-driver.js');
    await use(new GameDriver(page));
  },
  director: async ({}, use) => {
    const { DirectorHarness } = await import('./director-harness.js');
    await use(new DirectorHarness());
  },
});
