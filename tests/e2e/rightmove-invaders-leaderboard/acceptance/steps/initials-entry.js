import { ALPHABET, EntryMethod, INITIALS_ENTRY } from './domain-types.js';

// The walking skeleton's "I enter the initials" step, on the page and its fake clock, the way INITIALS_ENTRY says
// (domain-types.js: the switch DELIVER flips in roadmap step 01-01 of rightmove-invaders-typed-initials).
// Each key gets a frame of its own.
const KEY_GAP_MS = 50;
// No key acts on the typed entry for the first 0.6 s of game over (typed-initials D11, DDD-T5), and the skeleton's
// previous step ("I stop playing until the hurdles win") can return as little as 0 s after game over: wait first.
const GUARD_WAIT_MS = 700;

async function press(page, key) {
  await page.keyboard.press(key);
  await page.clock.runFor(KEY_GAP_MS);
}

// Arcade controls: every letter starts at A, Up moves it on through the alphabet, Enter takes it.
async function chooseOnTheLetterWheel(page, initials) {
  for (const letter of initials) {
    for (let i = 0; i < ALPHABET.indexOf(letter); i++) await press(page, 'ArrowUp');
    await press(page, 'Enter');
  }
}

// Typed: the letters as a player types them (lowercase is fine), then Enter signs.
async function typeAndSign(page, initials) {
  await page.clock.runFor(GUARD_WAIT_MS);
  for (const letter of initials.toLowerCase()) await press(page, letter);
  await press(page, 'Enter');
}

const ENTER_INITIALS = Object.freeze({ [EntryMethod.LETTER_WHEEL]: chooseOnTheLetterWheel, [EntryMethod.TYPED]: typeAndSign });

export const enterInitials = (page, initials, method = INITIALS_ENTRY) => ENTER_INITIALS[method](page, initials);
