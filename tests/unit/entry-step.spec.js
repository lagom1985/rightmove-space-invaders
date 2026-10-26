import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { loadFreshGame, arrange } from './support/fresh-game.js';
import { assertStateDelta, satisfying, setTo } from '../common/state-delta.js';
import { ALPHABET, BLOCKED_INITIALS, INITIALS_LENGTH } from '../../src/game/high-scores.js';
import { entryStep } from '../../src/game/game.js';

// The typed entry (DDD-T6) through its shell, handlePresses(pressed, typed), on the real rules (a fresh copy of
// src/game/game.js per run), each frame handed over as main.js hands it: the positions as a set of codes and the typed
// presses in order, as { key } (DDD-T1).
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

// ---- the entry step, enumerated against its oracle: DESIGN's Rules operations table ("the entry step", DDD-T3, DDD-T6) ----
// bypass: an enumerated table rather than a property, because its oracle is a table of rows: each row is checked by name
// over one representative of every entry state and of every press class, DDD-T3's traps among them, the plan compared
// whole. Rows to come: 01-08 adds the word filter (3 letters on it, and Enter on them); 02-01 turns Esc into the skip.
const CAPITAL_OF = { j: 'J', Z: 'Z' };
const LETTERS_IN = [
  { letters: '', withoutLast: null },
  { letters: 'C', withoutLast: '' },
  { letters: 'CA', withoutLast: 'C' },
  { letters: 'CAM', withoutLast: 'CA' },   // allowed
];
// No notice, a hint or a refusal, each with the number the shell gave it. Frozen, so a step that wrote to one would throw.
const NOTICES_ON_SHOW = [null, Object.freeze({ kind: 'too-few', n: 7 }), Object.freeze({ kind: 'refused', n: 12 })];
const ENTRY_STATES = LETTERS_IN.flatMap(({ letters, withoutLast }) => NOTICES_ON_SHOW.map(notice => ({ entry: Object.freeze({ letters, notice }), withoutLast })));
const KELVIN_SIGN = 'K';
const DECOMPOSED_E_ACUTE = 'é';
const NOT_ONE_ASCII_LETTER = ['é', 'ü', 'ß', 'å', 'ı', 'ſ', KELVIN_SIGN, DECOMPOSED_E_ACUTE, 'Dead', 'Process', 'Unidentified', ' ', ...'0123456789', '/', 'ab'];
const OTHER_KEY_NAMES = ['Tab', 'Shift', 'CapsLock', 'Meta', 'Control', 'Alt', 'F5', 'ArrowLeft', 'ArrowUp', 'Delete', 'Home'];
const planned = ({ letters, notice = null, signing = null }) => ({ letters, notice, skip: false, signing });
const identity = ({ entry }) => identityOf(entry);

const ENTRY_STEP_TABLE = [
  {
    operation: 'a letter, lower or upper case: with fewer than 3 in, its capital is appended and the notice cleared; with 3 in, the identity',
    keys: Object.keys(CAPITAL_OF),
    plan: ({ entry }, key) => (entry.letters.length < INITIALS_LENGTH ? planned({ letters: entry.letters + CAPITAL_OF[key] }) : identityOf(entry)),
  },
  {
    operation: 'Backspace: with letters in, the last one is taken back and the notice cleared; on an empty entry, the identity',
    keys: ['Backspace'],
    plan: ({ entry, withoutLast }) => (entry.letters ? planned({ letters: withoutLast }) : identityOf(entry)),
  },
  {
    operation: 'Enter: on 3 allowed letters, the entry closes and signs them; with fewer, the letters are kept with a fresh too-few hint, without a number',
    keys: ['Enter'],
    plan: ({ entry }) => (entry.letters.length === INITIALS_LENGTH ? planned({ letters: null, signing: entry.letters }) : planned({ letters: entry.letters, notice: { kind: 'too-few' } })),
  },
  { operation: 'Esc, in slice 01: the identity', keys: ['Escape'], plan: identity },
  { operation: "a key that isn't one ASCII letter (DDD-T3's traps, a space, the digits, '/', 'ab'): the identity", keys: NOT_ONE_ASCII_LETTER, plan: identity },
  { operation: 'any other key name: the identity', keys: OTHER_KEY_NAMES, plan: identity },
];

for (const { operation, keys, plan } of ENTRY_STEP_TABLE) {
  test(`the entry step, as DESIGN's table says: ${operation}`, () => {
    const cases = ENTRY_STATES.flatMap(state => keys.map(key => ({ state, key })));
    const actual = cases.map(({ state: { entry }, key }) => ({ entry, key, plan: entryStep(entry, { key }) }));
    const expected = cases.map(({ state, key }) => ({ entry: state.entry, key, plan: plan(state, key) }));
    expect(actual).toStrictEqual(expected);
    const renumbered = actual.filter(({ entry, plan: { notice } }, i) => expected[i].plan.notice === entry.notice && notice !== entry.notice);
    expect(renumbered, 'an identity plan returns the very notice passed in, so the shell never numbers it again').toEqual([]);
  });
}

// Every other key, generated: anything but one ASCII letter, Backspace or Enter (Esc too, in slice 01), whatever the
// entry. One ASCII letter is checked by membership of the 52, not by a pattern, and the generators lean on the traps:
// DDD-T3's characters, a letter with something before or after it, key names, and arbitrary strings.
const ONE_ASCII_LETTER = [...ALPHABET, ...ALPHABET.toLowerCase()];
const isActedOn = key => ONE_ASCII_LETTER.includes(key) || key === 'Backspace' || key === 'Enter';
const besideALetter = fc.tuple(
  fc.constantFrom(...ONE_ASCII_LETTER),
  fc.oneof({ arbitrary: fc.constantFrom(' ', '\n', '\t', '́', '​'), weight: 2 }, fc.string({ unit: 'grapheme', minLength: 1, maxLength: 2 })),
  fc.boolean(),
).map(([letter, beside, before]) => (before ? beside + letter : letter + beside));
const aKeyTheEntryIgnores = fc.oneof(
  { arbitrary: fc.constantFrom(...NOT_ONE_ASCII_LETTER), weight: 3 },
  { arbitrary: besideALetter, weight: 3 },
  fc.constantFrom(...OTHER_KEY_NAMES, 'Escape'),
  fc.string({ unit: 'grapheme', maxLength: 3 }),
  fc.string({ unit: 'binary', maxLength: 12 }),
).filter(key => !isActedOn(key));

test('every key the table does not act on gives the identity plan, its notice the very one passed in, whatever the entry', () => {
  fc.assert(fc.property(anEntry(capitals(0, INITIALS_LENGTH)), aKeyTheEntryIgnores, (entry, key) => {
    assertStateDelta(identityOf(entry), entryStep(entry, { key }), { universe: PLAN, expected: { notice: theVeryNotice } });
  }), { numRuns: 300 });   // a pure step, so cheap: more runs reach the rarer traps (a newline beside a letter, ı and ſ)
});
