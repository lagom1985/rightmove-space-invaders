import { test, expect } from '@playwright/test';
import { COLORS, HURDLES } from '../../src/theme/theme.js';
import { contrastRatio, luminance } from './support/contrast.js';

// The title's hurdle legend names each hurdle in its own colour, and the Dream home in dream pink, as 16 px text. The
// pixel font isn't large text, so each name needs 4.5:1 (WCAG 1.4.3). Gazumper red has only 3.51:1 against Studio flat,
// the title's backdrop, so each name is drawn on a dark outline (COLORS.outline, render.js) and checked against it,
// whatever backdrop is behind. The outline is one solid colour: it needs none of the allowance the palettes get for
// anti-aliased backdrop pixels (ADR-011).

const TEXT = 4.5;
const NAMES = [...HURDLES.map(({ name, color }) => ({ name, color })), { name: 'Dream home', color: COLORS.dream }];
const ratio = (a, b) => contrastRatio(luminance(a), luminance(b));

test('the contrast maths gives the ratios WCAG publishes', () => {
  expect(ratio('#ffffff', '#000000')).toBe(21);
  expect(ratio('#000000', '#ffffff')).toBe(21);
  expect(ratio('#ff5a5f', '#ff5a5f')).toBe(1);
  expect(ratio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);   // the darkest grey that passes 4.5:1 on white
});

test(`every name in the title legend has ${TEXT}:1 against its outline`, () => {
  const short = NAMES.map(({ name, color }) => ({ name, ratio: ratio(color, COLORS.outline) })).filter(n => n.ratio < TEXT);
  expect(short).toEqual([]);
});
