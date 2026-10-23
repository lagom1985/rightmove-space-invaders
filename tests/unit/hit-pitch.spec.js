import { test } from '@playwright/test';
import fc from 'fast-check';
import { HURDLES, hitPitch } from '../../src/theme.js';

// The pure pitch function (hitPitch in theme.js) alone: synth-hit-pitch.spec.js covers the pitch the synth really plays.
const HURDLE_VALUES = HURDLES.map(hurdle => hurdle.value);   // £300, £200, £150, £100, £50

// Any two different hurdle values: the lower one first, the higher one second.
const lowerThenHigher = fc.uniqueArray(fc.constantFrom(...HURDLE_VALUES), { minLength: 2, maxLength: 2 })
  .map(pair => pair.sort((a, b) => a - b));

test('the pitch function gives a more valuable hurdle a higher pitch', () => {
  fc.assert(fc.property(lowerThenHigher, ([lower, higher]) => hitPitch(lower) < hitPitch(higher)));
});
