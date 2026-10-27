import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import { test } from './fixtures.js';
import { enterInitials } from './initials-entry.js';

const { Given, When, Then } = createBdd(test);

// Opening the game, playing and the fake clock are the game's own steps (rightmove-invaders/game.steps.js).
// The table is the real one: the page calls /api/scores, which scripts/serve.mjs answers with the real
// Netlify Function and the real Blobs client, against the local Blobs emulator.
const START = new Date('2026-01-01T09:00:00Z');
const BOARD_COOKIE = 'test-board';
// The skeleton plays on the fake clock, much faster than real time, so once the table checks a game against the clock
// (rightmove-invaders-replay-verified-scores, slice 03) its page carries the local server's lenient clock (DDD-R11, E6),
// as every page of the leaderboard's driver does. Before that, the local server ignores it.
const LENIENT_CLOCK = 'test-clock';
const status = page => page.getByRole('status');
const highScores = page => page.getByRole('list', { name: 'High scores' }).getByRole('listitem');

const useBoard = (context, table, baseURL) => context.addCookies([
  { name: BOARD_COOKIE, value: table.board, url: baseURL },
  { name: LENIENT_CLOCK, value: 'lenient', url: baseURL },
]);

// A board nobody has used yet is empty.
Given('the high-score table is empty', async ({ page, table, $testInfo }) => {
  await useBoard(page.context(), table, $testInfo.project.use.baseURL);
  table.viewer = page;
});

Then('I am asked for my initials for a deposit saved of {string}', async ({ page }, amount) => {
  await expect(status(page)).toContainText(`Deposit saved ${amount}`);
  await expect(status(page)).toContainText('Enter your initials');
});

// Typed, as a player types them (steps/initials-entry.js; rightmove-invaders-typed-initials).
When('I enter the initials {string}', ({ page }, initials) => enterInitials(page, initials));

// The table arrives over the network, and the page only redraws on frames, so keep the clock going until it shows.
Then('the high-score table is topped by {string} with {string}', async ({ table }, initials, amount) => {
  const top = highScores(table.viewer).first();
  await expect(async () => {
    await table.viewer.clock.runFor(100);
    await expect(top).toContainText(initials, { timeout: 100 });
    await expect(top).toContainText(amount, { timeout: 100 });
  }).toPass({ timeout: 5000 });
});

// Another computer: a browser context of its own (no shared storage), looking at the same table.
When('another house-hunter opens the game on their own computer', async ({ browser, table, $testInfo }) => {
  const baseURL = $testInfo.project.use.baseURL;
  const context = await browser.newContext({ baseURL });
  table.others.push(context);
  await useBoard(context, table, baseURL);
  const page = await context.newPage();
  await page.clock.install({ time: START });
  await page.goto('/');
  await page.clock.pauseAt(new Date(START.getTime() + 5000));
  await page.clock.runFor(100);
  table.viewer = page;
});
