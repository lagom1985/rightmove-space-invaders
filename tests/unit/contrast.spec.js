import { test, expect } from '@playwright/test';
import { contrastRatio, relativeLuminance } from './support/contrast.js';

// The WCAG maths every legibility check rests on (ADR-011): the helper gives the ratios WCAG publishes. The checks
// themselves, the backdrops' and the title legend's, are milestone 5 of the level-backdrops acceptance suite.

const ratio = (a, b) => contrastRatio(relativeLuminance(a), relativeLuminance(b));

test('the contrast maths gives the ratios WCAG publishes', () => {
  expect(ratio('#ffffff', '#000000')).toBe(21);
  expect(ratio('#000000', '#ffffff')).toBe(21);
  expect(ratio('#ff5a5f', '#ff5a5f')).toBe(1);
  expect(ratio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);   // the darkest grey that passes 4.5:1 on white
});
