import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { loadFreshGame, arrange } from './support/fresh-game.js';
import { assertStateDelta, satisfying, setTo } from '../common/state-delta.js';
import { ALPHABET, BLOCKED_INITIALS, INITIALS_LENGTH } from '../../src/game/high-scores.js';
import { entryStep } from '../../src/game/game.js';

// The typed entry (DDD-T6) through its shell, handlePresses(pressed, typed), on the real rules (a fresh copy of
// src/game/game.js per run), each frame handed over as main.js hands it: the positions as a set of codes and the typed
// presses in order, as { key } (DDD-T1). Roadmap step 01-07 adds the entry step's enumerated table.
// Universe: the rules' read-only snapshot() and the events they publish, read through takeEvents().
// The entry step's own rows (DESIGN, Rules operations) are checked on the step itself, which is pure: its plan, against
// the identity plan for the same entry. Universe: the plan's letters, notice, skip and signing.

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

// ---- the entry step's rows: Backspace, a fourth letter and Enter too early (DDD-T6, D13, D14) ----
const PLAN = ['letters', 'notice', 'skip', 'signing'];
const capitals = (minLength, maxLength) => fc.array(fc.constantFrom(...ALPHABET), { minLength, maxLength }).map(letters => letters.join(''));
// No notice, or Enter's answer with the number the shell gave it.
const aNotice = fc.option(fc.record({ kind: fc.constantFrom('too-few', 'refused'), n: fc.integer({ min: 1, max: 1000 }) }), { nil: null });
const anEntry = letters => fc.record({ letters, notice: aNotice });
const aLetterPress = fc.tuple(fc.constantFrom(...ALPHABET), fc.boolean()).map(([letter, capital]) => ({ key: capital ? letter : letter.toLowerCase() }));
const BACKSPACE = { key: 'Backspace' };
const ENTER_PRESS = { key: 'Enter' };

// What a press the entry doesn't act on plans: the same letters and notice, no skip and no signing.
const identityOf = ({ letters, notice }) => ({ letters, notice, skip: false, signing: null });
// The notice object passed in, not a copy: the shell would number a copy again, and the mirror announce it again.
const theVeryNotice = satisfying('the very notice passed in', (was, now) => now === was);

test('Backspace with letters in takes back the last one and clears the notice: no skip and no signing', () => {
  fc.assert(fc.property(anEntry(capitals(1, INITIALS_LENGTH)), entry => {
    assertStateDelta(identityOf(entry), entryStep(entry, BACKSPACE), {
      universe: PLAN,
      expected: { letters: setTo(entry.letters.slice(0, -1)), notice: setTo(null) },
    });
  }));
});

test('Backspace on an empty entry changes nothing: the plan is the identity, its notice the very one passed in', () => {
  fc.assert(fc.property(anEntry(fc.constant('')), entry => {
    assertStateDelta(identityOf(entry), entryStep(entry, BACKSPACE), { universe: PLAN, expected: { notice: theVeryNotice } });
  }));
});

test('a fourth letter, in either case, changes nothing: the plan is the identity, its notice the very one passed in', () => {
  fc.assert(fc.property(anEntry(capitals(INITIALS_LENGTH, INITIALS_LENGTH)), aLetterPress, (entry, press) => {
    assertStateDelta(identityOf(entry), entryStep(entry, press), { universe: PLAN, expected: { notice: theVeryNotice } });
  }));
});

// A fresh hint, without a number, even when one is already on show: the shell numbers it, and the mirror announces it.
test('Enter with fewer than 3 letters keeps them and shows a fresh too-few hint, without a number, whatever notice was on show: no skip and no signing', () => {
  fc.assert(fc.property(anEntry(capitals(0, INITIALS_LENGTH - 1)), entry => {
    assertStateDelta(identityOf(entry), entryStep(entry, ENTER_PRESS), { universe: PLAN, expected: { notice: setTo({ kind: 'too-few' }) } });
  }));
});
