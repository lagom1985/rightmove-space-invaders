import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { assertStateDelta, setTo } from '../common/state-delta.js';
import { createRecorder, readRecord, RULES_VERSION, MAX_GAME_STEPS } from '../../src/game/record.js';

// The record (DDD-R5, C3, C9): exactly { rules: RULES_VERSION, steps, keys }, keys holding one entry per change of the
// held controls: the step delta in lowercase base 36 without a leading zero, then one capital A-H for the three control
// bits (left 1, right 2, fire 4; A holds none, H all three). The first entry is at step 0 (its delta exactly 0), every
// later delta is at least 1, every entry changes the controls, every change comes before steps, and steps is a safe
// integer of at least 1, so one game has one record (clarified in DELIVER, 2026-10-27). The 60-minute bound
// (MAX_GAME_STEPS) is the signing's check 13, not the reader's, so a longer record still reads. readRecord(record) ->
// { rules, steps, changes: [[step, controls], ...] }, or null.

const LETTERS = 'ABCDEFGH';
const controls = fc.integer({ min: 0, max: 7 });

// The controls a game holds, as stretches of one held set, from a step to about an hour of steps; two stretches in a row
// may hold the same controls, which is no change.
const stretch = fc.record({
  controls,
  steps: fc.oneof(
    { weight: 10, arbitrary: fc.integer({ min: 1, max: 40 }) },
    { weight: 10, arbitrary: fc.integer({ min: 41, max: 6000 }) },
    { weight: 1, arbitrary: fc.integer({ min: MAX_GAME_STEPS - 1000, max: MAX_GAME_STEPS + 1000 }) },
  ),
});
const heldStretches = maxLength => fc.array(stretch, { minLength: 1, maxLength });

// ---- the recorder, and the reader reading it back ----
// Each stretch the recorder is stepped through adds its steps, and one entry when its controls change: the steps since
// the last change in base 36, then the controls' letter. Universe: the record's three fields.
const UNIVERSE = ['rules', 'steps', 'keys'];

test('readRecord reads back every record the recorder writes: each change of the held controls, at its step', () => {
  let longerThanAnHour = 0;
  fc.assert(fc.property(heldStretches(30), stretches => {
    const recorder = createRecorder();
    const changes = [];
    let lastChange = 0;
    for (const stretch of stretches) {
      const before = recorder.record();
      for (let i = 0; i < stretch.steps; i++) recorder.step(stretch.controls);
      const changed = changes.length === 0 || changes.at(-1)[1] !== stretch.controls;
      const entry = changed ? `${(before.steps - lastChange).toString(36)}${LETTERS[stretch.controls]}` : '';
      if (changed) { changes.push([before.steps, stretch.controls]); lastChange = before.steps; }
      assertStateDelta(before, recorder.record(), {
        universe: UNIVERSE,
        expected: { steps: setTo(before.steps + stretch.steps), keys: setTo(before.keys + entry) },
      });
    }
    const record = recorder.record();
    expect(record).toEqual({ rules: RULES_VERSION, steps: stretches.reduce((sum, { steps }) => sum + steps, 0), keys: expect.any(String) });
    expect(readRecord(record)).toEqual({ rules: RULES_VERSION, steps: record.steps, changes });
    if (record.steps > MAX_GAME_STEPS) longerThanAnHour++;
  }));
  expect(longerThanAnHour, 'no run wrote a record longer than MAX_GAME_STEPS').toBeGreaterThan(0);
});

// ---- the reader's rules, each broken alone ----
// A readable record from the recorder, and each rule of the reader broken in it, alone where the rule allows, by a
// breaker: an arbitrary of (record, changes) -> what is no longer a record.
const notAnObject = fc.constantFrom(null, undefined, '0A', 7, true);
const notASafeInteger = fc.constantFrom(undefined, null, '1', 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, [1], {});
const notText = fc.constantFrom(undefined, null, 12345, ['0A'], { keys: '0A' });
const FOREIGN = [...'IZ- .,_+é\n'];
const RECORD_FIELDS = ['rules', 'steps', 'keys'];
const without = (record, field) => Object.fromEntries(Object.entries(record).filter(([name]) => name !== field));
const at = (keys, index, text) => `${keys.slice(0, index)}${text}${keys.slice(index)}`;
// Where each entry of keys ends: just after its letter.
const entryEnds = keys => [...keys].flatMap((character, index) => (LETTERS.includes(character) ? [index + 1] : []));

const BREAKERS = [
  ['the record is an object', notAnObject.map(value => () => value)],
  ['rules is named, a safe integer', notASafeInteger.map(value => record => (value === undefined ? without(record, 'rules') : { ...record, rules: value }))],
  ['steps is a safe integer', notASafeInteger.map(value => record => (value === undefined ? without(record, 'steps') : { ...record, steps: value }))],
  ['steps is at least 1', fc.integer({ min: Number.MIN_SAFE_INTEGER, max: 0 }).map(steps => record => ({ ...record, steps }))],
  ['keys is text', notText.map(value => record => (value === undefined ? without(record, 'keys') : { ...record, keys: value }))],
  ['keys is only base-36 digits and the letters A-H', fc.tuple(fc.constantFrom(...FOREIGN), fc.nat()).map(([foreign, where]) => record => ({ ...record, keys: at(record.keys, where % (record.keys.length + 1), foreign) }))],
  ['every entry ends with its letter', fc.stringMatching(/^[0-9a-z]{1,3}$/).map(delta => record => ({ ...record, keys: `${record.keys}${delta}` }))],
  ['every entry starts with its delta', fc.tuple(controls, fc.nat()).map(([extra, which]) => (record, changes) =>
    ({ ...record, keys: at(record.keys, [0, ...entryEnds(record.keys)][which % (changes.length + 1)], LETTERS[extra]) }))],
  ['no delta has a leading zero', fc.tuple(fc.nat(), fc.integer({ min: 1, max: 3 })).map(([which, zeros]) => (record, changes) =>
    ({ ...record, keys: at(record.keys, [0, ...entryEnds(record.keys)][which % changes.length], '0'.repeat(zeros)) }))],
  ['there is a first entry', fc.constant(record => ({ ...record, keys: '' }))],
  ['the first entry is at step 0', fc.integer({ min: 1, max: 5000 }).map(late => record => ({ ...record, steps: record.steps + late, keys: `${late.toString(36)}${record.keys.slice(1)}` }))],
  ['every later delta is at least 1', fc.integer({ min: 1, max: 7 }).map(other => (record, changes) =>
    ({ ...record, keys: at(record.keys, 2, `0${LETTERS[(changes[0][1] + other) % 8]}`) }))],
  ['every change comes before steps', fc.tuple(fc.nat({ max: 5000 }), fc.integer({ min: 1, max: 7 })).map(([after, other]) => (record, changes) => {
    const [lastStep, lastControls] = changes.at(-1);
    return { ...record, keys: `${record.keys}${(record.steps - lastStep + after).toString(36)}${LETTERS[(lastControls + other) % 8]}` };
  })],
  // An entry holding the controls already held, a gap after any entry, every later change as many steps later.
  ['every entry changes the controls', fc.tuple(fc.nat(), fc.integer({ min: 1, max: 5000 })).map(([which, gap]) => (record, changes) => {
    const entry = which % changes.length;
    return { ...record, steps: record.steps + gap, keys: at(record.keys, entryEnds(record.keys)[entry], `${gap.toString(36)}${LETTERS[changes[entry][1]]}`) };
  })],
  ['the record holds nothing but rules, steps and keys', fc.tuple(fc.string({ maxLength: 8 }).filter(field => !RECORD_FIELDS.includes(field)), fc.jsonValue({ maxDepth: 1 }))
    .map(([field, value]) => record => ({ ...record, [field]: value }))],
];

test('a record with any one rule of the reader broken reads as null', () => {
  const breakers = fc.tuple(...BREAKERS.map(([, breaker]) => breaker));
  fc.assert(fc.property(fc.array(fc.record({ controls, steps: fc.integer({ min: 1, max: 300 }) }), { minLength: 1, maxLength: 12 }), breakers, (stretches, breaks) => {
    const recorder = createRecorder();
    for (const { controls: held, steps } of stretches) for (let i = 0; i < steps; i++) recorder.step(held);
    const record = recorder.record();
    const read = readRecord(record);
    expect(read, 'arranging: the recorder wrote a record the reader reads').not.toBeNull();
    for (const [index, [rule]] of BREAKERS.entries()) {
      const broken = breaks[index](record, read.changes);
      expect(readRecord(broken), `${rule}: ${JSON.stringify(broken)}`).toBeNull();
    }
  }));
});
