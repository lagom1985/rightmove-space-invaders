import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { formationStepInterval } from '../../src/game.js';

// How long the formation waits between steps (US-03): the beat follows this pace, so it must only
// ever get quicker as hurdles fall. First wave only; later waves speed the formation up further.

const FIRST_WAVE = 0;
const interval = hurdlesLeft => formationStepInterval(hurdlesLeft, FIRST_WAVE);
const within10Percent = (seconds, target) => Math.abs(seconds - target) <= target * 0.1;

// A formation of 11..55 hurdles, then some of them fall, leaving at least 10.
const hurdlesFalling = fc.integer({ min: 11, max: 55 }).chain(before =>
  fc.integer({ min: 1, max: before - 10 }).map(fallen => ({ before, after: before - fallen })));

test('the formation never takes longer between steps as hurdles fall', () => {
  fc.assert(fc.property(hurdlesFalling, ({ before, after }) => interval(after) <= interval(before)));
});

// bypass: the two tempos are named points in the story (0.53 s with 55 hurdles, 0.12 s with 10 left);
// a property would only restate the interval formula, so they are checked as plain examples.
test('the first wave steps every 0.53 s with 55 hurdles and every 0.12 s with 10 left', () => {
  expect(within10Percent(interval(55), 0.53), `55 hurdles: ${interval(55)} s`).toBe(true);
  expect(within10Percent(interval(10), 0.12), `10 hurdles: ${interval(10)} s`).toBe(true);
});
