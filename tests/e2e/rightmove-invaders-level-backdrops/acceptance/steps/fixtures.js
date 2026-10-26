import { test as base } from 'playwright-bdd';

// The level backdrops' in-memory drivers (project in-memory; no browser). The walking skeleton keeps playwright-bdd's
// own test and its page: these fixtures are for the milestone features only. Each driver is imported lazily, so a
// scenario loads only the one it uses.
// screen: the screen's store of backdrops on its own, with a stand-in canvas factory (screen-backdrops.js).
// game: the game's rules on their own, with the real status mirror and, once the window shows the game, the backdrop
//   drawn each frame through `screen` (in-memory-game.js). It plays with a deterministic Math.random, as the unit
//   properties do, so every run plays the same game.
// painter: every neighbourhood painted on a recording context (backdrop-painter.js); the game's luck is put back after.
// legibility: the legibility rule on the theme's data (legibility.js).
export const test = base.extend({
  screen: async ({}, use) => {
    const { ScreenBackdrops } = await import('./screen-backdrops.js');
    await use(new ScreenBackdrops());
  },
  game: async ({ screen }, use) => {
    const [{ InMemoryGame }, { withDeterministicChance }] = await Promise.all([
      import('./in-memory-game.js'), import('../../../../unit/support/fresh-game.js'),
    ]);
    const game = await InMemoryGame.fresh(screen);
    await withDeterministicChance(() => use(game));
  },
  painter: async ({}, use) => {
    const { BackdropPainter } = await import('./backdrop-painter.js');
    const painter = new BackdropPainter();
    try {
      await use(painter);
    } finally {
      painter.unlockTheLuck();
    }
  },
  legibility: async ({}, use) => {
    const { LegibilityCheck } = await import('./legibility.js');
    await use(new LegibilityCheck());
  },
});
