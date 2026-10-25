import { isDeepStrictEqual, inspect } from 'node:util';
import { expect } from '@playwright/test';

// Universe-bound state-delta assertion (nWave Mandate 8): the project's JavaScript port, bootstrapped by DISTILL for
// rightmove-invaders-leaderboard (2026-10-24). A test snapshots the observable state before and after one action, names
// every slot it promises to watch (the universe), and says how the slots it expects to change change. Every other slot
// in the universe must be unchanged: a mutation nobody declared fails the test (fail-closed).
// Slot names are what a port exposes (store keys, read-model fields), never private fields.
//
//   assertStateDelta(before, after, { universe: ['table.scores', 'table.leftovers'], expected: { 'table.scores': appendedWith(key) } });

const show = value => inspect(value, { depth: 4, breakLength: Infinity });
const predicate = (description, holds) => Object.freeze({ description, holds });

export const unchanged = () => predicate('unchanged', (before, after) => isDeepStrictEqual(before, after));
export const setTo = value => predicate(`set to ${show(value)}`, (_, after) => isDeepStrictEqual(after, value));
export const appendedWith = (...items) => predicate(`appended with ${show(items)}`, (before, after) => isDeepStrictEqual(after, [...before, ...items]));
export const prependedWith = (...items) => predicate(`prepended with ${show(items)}`, (before, after) => isDeepStrictEqual(after, [...items, ...before]));
export const containing = (...items) => predicate(`containing ${show(items)}`, (_, after) => items.every(item => after.some(a => isDeepStrictEqual(a, item))));
export const normalizedTo = (normalize, value) => predicate(`normalized to ${show(value)}`, (_, after) => isDeepStrictEqual(normalize(after), value));
// For deltas that are rules rather than values (for example "at most 5 removed, all ranked 11th or lower").
export const satisfying = (description, holds) => predicate(description, holds);

export function assertStateDelta(before, after, { universe, expected = {} }) {
  const watched = new Set(universe);
  const problems = Object.keys(expected).filter(slot => !watched.has(slot)).map(slot => `${slot}: expected to change, but it is not in the universe`);
  for (const slot of watched) {
    const rule = expected[slot] ?? unchanged();
    if (!rule.holds(before[slot], after[slot])) problems.push(`${slot}: expected ${rule.description}; before ${show(before[slot])}, after ${show(after[slot])}`);
  }
  expect(problems, 'state delta').toEqual([]);
}
