// The walking skeleton's "I enter the initials" step, on the page and its fake clock: the initials are typed
// (rightmove-invaders-typed-initials). Each key gets a frame of its own.
const KEY_GAP_MS = 50;
// No key acts on the typed entry for the first 0.6 s of game over (typed-initials D11, DDD-T5), and the skeleton's
// previous step ("I stop playing until the hurdles win") can return as little as 0 s after game over: wait first.
const GUARD_WAIT_MS = 700;

async function press(page, key) {
  await page.keyboard.press(key);
  await page.clock.runFor(KEY_GAP_MS);
}

// The letters as a player types them (lowercase is fine), then Enter signs.
async function typeAndSign(page, initials) {
  await page.clock.runFor(GUARD_WAIT_MS);
  for (const letter of initials.toLowerCase()) await press(page, letter);
  await press(page, 'Enter');
}

export const enterInitials = (page, initials) => typeAndSign(page, initials);
