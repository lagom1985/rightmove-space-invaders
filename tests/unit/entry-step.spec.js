import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { loadFreshGame, arrange } from './support/fresh-game.js';
import { assertStateDelta, satisfying } from '../common/state-delta.js';
import { BLOCKED_INITIALS } from '../../src/game/high-scores.js';

// The typed entry (DDD-T6) through its shell, handlePresses(pressed, typed), on the real rules (a fresh copy of
// src/game/game.js per run), each frame handed over as main.js hands it: the positions as a set of codes and the typed
// presses in order, as { key } (DDD-T1). Roadmap step 01-07 adds the entry step's enumerated table.
// Universe: the rules' read-only snapshot() and the events they publish, read through takeEvents().

const STEP = 1 / 120;
const SETTLE_S = 0.7;   // the entry takes typed presses only 0.6 s after game over
const keyboard = { isDown: () => false };
const UNIVERSE = ['screen', 'table', 'entry', 'skipped', 'signing', 'settled', 'lastListedAt', 'events'];

const frame = (rules, keys) => rules.handlePresses(new Set(keys.map(({ code }) => code)), keys.map(({ key }) => ({ key })));
const letterKey = (letter, capital) => ({ key: capital ? letter : letter.toLowerCase(), code: `Key${letter}` });
const ENTER = { key: 'Enter', code: 'Enter' };

// A game over on an empty table with £50: the entry is open, 0.6 s have passed and nothing is waiting in the outbox.
async function entryOpen() {
  const rules = await loadFreshGame();
  rules.tableAnswered({ scores: [], listedAt: 1 });
  rules.handlePresses(new Set(['Enter']));
  arrange.deposit(rules, 50);
  arrange.formationOnPin(rules);
  rules.update(STEP, keyboard);
  rules.update(SETTLE_S, keyboard);
  rules.takeEvents();
  expect(rules.snapshot().entry, 'arranging: £50 should make an empty table').not.toBeNull();
  return rules;
}

const observe = rules => ({ ...rules.snapshot(), events: rules.takeEvents() });

test('Enter on three letters on the word filter, typed in any case and in any frames, never signs: the entry stays open and no initialsEntered is published', async () => {
  const run = fc.record({
    blocked: fc.constantFrom(...BLOCKED_INITIALS),
    capitals: fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
    withinOneFrame: fc.boolean(),
  });
  await fc.assert(fc.asyncProperty(run, async ({ blocked, capitals, withinOneFrame }) => {
    const rules = await entryOpen();
    const letters = [...blocked].map((letter, i) => letterKey(letter, capitals[i]));
    if (!withinOneFrame) letters.forEach(key => frame(rules, [key]));
    const before = observe(rules);
    frame(rules, withinOneFrame ? [...letters, ENTER] : [ENTER]);
    assertStateDelta(before, observe(rules), {
      universe: UNIVERSE,
      expected: { entry: satisfying('still open', (_, after) => after !== null) },
    });
  }));
});
