import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { Given, When, Then } = createBdd();

// The game is driven through the real page and real keyboard events. Playwright's fake clock
// stands in for wall-clock time, so the test can fast-forward the game instead of waiting.
const START = new Date('2026-01-01T09:00:00Z');
const status = page => page.getByRole('status');
const hud = (page, field) => page.locator(`[data-hud="${field}"]`);

Given('I open the game on a desktop browser for the first time', async ({ page }) => {
  await page.clock.install({ time: START });
  await page.goto('/');   // each test gets a fresh browser context, so nothing is saved yet
  await page.clock.pauseAt(new Date(START.getTime() + 5000));
  await page.clock.runFor(100);
});

Then('the title screen shows a best deposit of {string}', async ({ page }, amount) => {
  await expect(status(page)).toContainText('Press Enter to start');
  await expect(hud(page, 'best')).toHaveText(amount);
});

When('I press Enter to start', async ({ page }) => {
  await page.keyboard.press('Enter');
  await page.clock.runFor(100);
  await expect(status(page)).toContainText('Game started');
});

// The player starts centred under the formation's middle column, whose bottom hurdle is
// Damp (£50). The shot gets there in under half a second, before any hurdle fires.
When('I tap Space to fire at the hurdle above me', async ({ page }) => {
  await page.keyboard.press('Space');
  await page.clock.runFor(1000);
});

Then('my deposit saved is {string}', async ({ page }, amount) => {
  await expect(hud(page, 'deposit')).toHaveText(amount);
});

// Standing still in the open, the player is shot or overrun. Allow up to ten minutes of game time.
When('I stop playing until the hurdles win', async ({ page }) => {
  for (let seconds = 0; seconds < 600; seconds += 10) {
    if ((await status(page).textContent()).includes('Game over')) return;
    await page.clock.runFor(10_000);
  }
});

Then('the game is over with a deposit saved of {string}', async ({ page }, amount) => {
  await expect(status(page)).toContainText('Game over');
  await expect(status(page)).toContainText(`Deposit saved ${amount}`);
});

When('I come back to the game later', async ({ page }) => {
  await page.reload();
  await page.clock.runFor(100);
});
