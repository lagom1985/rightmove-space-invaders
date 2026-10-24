import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { BANNER_TIME } from '../../src/game/game.js';
import { Sound } from '../../src/game/events.js';
import { SOUND_RECIPES, partsOf } from '../../src/theme/theme.js';

// The fanfare plays when a wave is cleared, while the "Wave cleared!" banner shows (US-05): it must be over
// before the next wave starts, and it must sound like going up.

const fanfare = SOUND_RECIPES[Sound.FANFARE];
const secondsOf = recipe => partsOf(recipe).reduce((seconds, part) => seconds + part.duration, 0);
const notes = () => {
  expect(fanfare, 'the wave-cleared fanfare has no recipe').toBeDefined();
  return fanfare.parts;
};

test('no stretch of the fanfare, up to any note, outlasts the Wave cleared banner', () => {
  const upToNote = fc.integer({ min: 1, max: notes().length });
  fc.assert(fc.property(upToNote, count => secondsOf({ parts: notes().slice(0, count) }) <= BANNER_TIME));
});

test('every note of the fanfare is higher than the notes before it', () => {
  const earlierThenLater = fc.tuple(fc.nat(notes().length - 1), fc.nat(notes().length - 1)).filter(([earlier, later]) => earlier < later);
  fc.assert(fc.property(earlierThenLater, ([earlier, later]) => notes()[earlier].from < notes()[later].from));
});
