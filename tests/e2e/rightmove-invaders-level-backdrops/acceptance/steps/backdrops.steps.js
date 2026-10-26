import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import { W, STEP } from '../../../../../src/game/config.js';
import { PLAYER_SPEED, RESPAWN_TIME, houseCentreX } from '../../../../../src/game/game.js';

const { Given, When, Then } = createBdd();

// The real page, played with real key presses (docs/architecture/atdd-infrastructure-policy.md): game time is
// Playwright's fake clock and Math.random is seeded, so every run plays the same game in every browser. The canvas is
// not asserted on: the backdrop's neighbourhood is read from the status mirror, like the rest of the HUD.
const START = new Date('2026-01-01T09:00:00Z');
const SEED = 20261023;
const TICK_MS = 100;
const SHELTERS = [1, 2];          // the second and third houses from the left
const SHELTER_MS = 12_000;        // how long the pin stays under one house before moving to the other
const MAX_WAVE_MS = 240_000;      // game time allowed for the first wave
const hud = (page, field) => page.locator(`[data-hud="${field}"]`);
const status = page => page.getByRole('status');
// The ladder, the homes left and the announcement, read in one round trip: the wave is watched every tick.
const watch = page => page.evaluate(() => Object.fromEntries(['ladder', 'homes', 'announcement']
  .map(field => [field, document.querySelector(`[data-hud="${field}"]`).textContent])));

Given('I start a game on the first rung of the property ladder', async ({ page }) => {
  await page.addInitScript(seed => {
    let a = seed;   // mulberry32
    Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }, SEED);
  await page.clock.install({ time: START });
  await page.goto('/');
  await page.clock.pauseAt(new Date(START.getTime() + 5000));
  await page.clock.runFor(TICK_MS);
  await page.keyboard.press('Enter');
  await page.clock.runFor(TICK_MS);
  await expect(status(page)).toContainText('Game started');
  await expect(hud(page, 'ladder')).toHaveText('Studio flat');
});

// The houses stop the hurdles' bolts, and the pin's own shots soon wear a way up through the house above it. Space is
// held throughout (the pin fires whenever its last shot has gone). The pin's position is worked out from the keys held
// and its speed; after a lost home it comes back in the middle once it respawns.
When('I clear the first wave by sheltering under the middle houses', async ({ page }) => {
  let x = W / 2, { homes } = await watch(page), shelter = 0, sheltered = 0;
  await page.keyboard.down('Space');
  for (let elapsed = 0; elapsed < MAX_WAVE_MS; elapsed += TICK_MS) {
    const offset = houseCentreX(SHELTERS[shelter]) - x;
    const walkMs = Math.min(TICK_MS, Math.abs(offset) / PLAYER_SPEED * 1000);
    const walk = offset < 0 ? 'ArrowLeft' : 'ArrowRight';
    if (walkMs >= STEP * 1000) {
      await page.keyboard.down(walk);
      await page.clock.runFor(Math.round(walkMs));
      await page.keyboard.up(walk);
      x += Math.sign(offset) * Math.round(walkMs) / 1000 * PLAYER_SPEED;
    } else x += offset;
    await page.clock.runFor(TICK_MS - Math.round(walkMs));
    if ((sheltered += TICK_MS) >= SHELTER_MS) { sheltered = 0; shelter = (shelter + 1) % SHELTERS.length; }

    const now = await watch(page);
    if (now.ladder !== 'Studio flat') break;
    expect(now.announcement, 'the hurdles won the first wave').not.toContain('Game over');
    if (now.homes !== homes) {
      homes = now.homes;
      await page.clock.runFor(RESPAWN_TIME * 1000);
      x = W / 2;
    }
  }
  await page.keyboard.up('Space');
});

Then('I have moved up the property ladder to {string}', async ({ page }, rung) => {
  await expect(hud(page, 'ladder')).toHaveText(rung);
});

Then('the neighbourhood is {string}', async ({ page }, neighbourhood) => {
  await expect(hud(page, 'neighbourhood')).toHaveText(neighbourhood);
});
