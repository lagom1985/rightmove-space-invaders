import { test } from '@playwright/test';
import fc from 'fast-check';
import { HURDLES, hitPitch } from '../../src/theme.js';

const HURDLE_VALUES = HURDLES.map(hurdle => hurdle.value);   // £300, £200, £150, £100, £50

// Any two different hurdle values: the lower one first, the higher one second.
const lowerThenHigher = fc.uniqueArray(fc.constantFrom(...HURDLE_VALUES), { minLength: 2, maxLength: 2 })
  .map(pair => pair.sort((a, b) => a - b));

test('a hit on a more valuable hurdle always sounds higher', () => {
  fc.assert(fc.property(lowerThenHigher, ([lower, higher]) => hitPitch(lower) < hitPitch(higher)));
});
