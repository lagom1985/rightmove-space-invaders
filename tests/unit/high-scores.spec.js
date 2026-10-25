import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { BLOCKED_INITIALS, isAllowedInitials } from '../../src/game/high-scores.js';

// The word filter (ADR-006, DDD-3), one rule on both sides of the wire: initials are allowed when they are three
// letters A-Z and not on the owner-reviewed list. Pure: no state to watch, so the properties check the answer alone.

const ARCADE_INITIALS = /^[A-Z]{3}$/;
const threeLetters = fc.stringMatching(ARCADE_INITIALS);

// Three letters A-Z broken in one place, the way a hand-made request or a bug would break them.
const NEAR_MISSES = [
  initials => initials.toLowerCase(),
  initials => initials.slice(1),                  // two letters
  initials => `${initials}A`,                     // four letters
  initials => ` ${initials}`,
  initials => `${initials}\n`,
  initials => initials.replace(/^./, 'É'),         // a letter outside A-Z
  initials => initials.replace(/.$/, '1'),
  initials => [...initials],                      // the letters, but not a string
];
const notArcadeInitials = fc.oneof(
  fc.tuple(threeLetters, fc.constantFrom(...NEAR_MISSES)).map(([initials, breakThem]) => breakThem(initials)),
  fc.string(),
  fc.anything(),
).filter(value => !(typeof value === 'string' && ARCADE_INITIALS.test(value)));

test('three letters A-Z are allowed unless they are on the word filter, and every word on it is refused', () => {
  fc.assert(fc.property(fc.oneof(threeLetters, fc.constantFrom(...BLOCKED_INITIALS)), initials => {
    expect(isAllowedInitials(initials)).toBe(!BLOCKED_INITIALS.includes(initials));
  }), { examples: BLOCKED_INITIALS.map(word => [word]) });
});

test('anything that isn\'t three letters A-Z is never allowed', () => {
  fc.assert(fc.property(notArcadeInitials, value => {
    expect(isAllowedInitials(value)).toBe(false);
  }));
});
