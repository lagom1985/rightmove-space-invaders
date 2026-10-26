import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { assertStateDelta, setTo } from '../common/state-delta.js';
import { createKeyboard, preventsDefault } from '../../src/platform/input.js';

// The keyboard (src/platform/input.js, ADR-009) over a plain EventTarget. Node has EventTarget but no KeyboardEvent, so
// each keydown is an Event with the fields the keyboard reads set on it (DDD-T11: key, code, repeat and the modifiers).
// Its two channels: the typed presses, every keydown in order as { key }, except repeats and chords (Cmd, Ctrl or
// Alt/Option held; DDD-T1, DDD-T4), and the positions, as they always were (Cmd and Ctrl left alone, Alt not). On every
// keydown it applies the default policy (DDD-T8), a pure function of the event's fields.
// Universe: what the keyboard reports, `typed` (takeTyped()), `pressed` (takePressed(), sorted) and `held` (the codes
// isDown answers true for), read before and after each batch of keydowns, and `prevented`, what it left the browser to
// do with the batch's keydowns (each event's defaultPrevented, in order; none before the batch).

const KEYS = ['a', 'Z', 'm', 'é', 'ß', ' ', '/', "'", 'Enter', 'Backspace', 'Escape', 'ArrowUp', 'Dead', 'Shift'];
const CODES = ['KeyA', 'KeyZ', 'KeyM', 'KeyQ', 'Digit2', 'Minus', 'Space', 'Slash', 'Enter', 'Backspace', 'Escape', 'ArrowUp', 'ShiftLeft'];
const sometimes = fc.oneof({ arbitrary: fc.constant(false), weight: 3 }, { arbitrary: fc.constant(true), weight: 1 });
const keydown = fc.record({
  key: fc.oneof({ arbitrary: fc.constantFrom(...KEYS), weight: 4 }, { arbitrary: fc.string({ minLength: 1, maxLength: 2 }), weight: 1 }),
  code: fc.constantFrom(...CODES),
  repeat: sometimes, metaKey: sometimes, ctrlKey: sometimes, altKey: sometimes, shiftKey: sometimes,
});
// A plain keydown of A: no modifier held, not a repeat.
const A_KEYDOWN = { key: 'a', code: 'KeyA', repeat: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
// fast-check's usual number of generated runs. A property whose rarest moment the generated runs can all miss tries an
// example that reaches it first, on top of these.
const GENERATED_RUNS = 100;

// Dispatches one event and tells whether its default was prevented.
function dispatchKey(target, type, fields) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, fields);
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

const observe = keyboard => ({
  typed: keyboard.takeTyped(),
  pressed: [...keyboard.takePressed()].sort(),
  held: CODES.filter(code => keyboard.isDown(code)).sort(),
});

const isChord = ({ metaKey, ctrlKey, altKey }) => metaKey || ctrlKey || altKey;
const types = press => !press.repeat && !isChord(press);
const isPositional = ({ metaKey, ctrlKey }) => !metaKey && !ctrlKey;   // the positions leave Cmd and Ctrl to the browser
const codesOf = presses => [...new Set(presses.map(({ code }) => code))].sort();

// Moments every run together must reach.
const WITNESSES = [
  'typed', 'the same key typed twice in one go', 'a repeat left out', 'Cmd left out', 'Ctrl left out', 'Alt left out',
  'a default prevented', 'a default left to the browser',
];

function noteMoments(seen, batch) {
  const typed = batch.filter(types).map(({ key }) => key);
  if (typed.length) seen.add('typed');
  if (new Set(typed).size < typed.length) seen.add('the same key typed twice in one go');
  if (batch.some(press => press.repeat)) seen.add('a repeat left out');
  if (batch.some(press => press.metaKey)) seen.add('Cmd left out');
  if (batch.some(press => press.ctrlKey)) seen.add('Ctrl left out');
  if (batch.some(press => press.altKey)) seen.add('Alt left out');
  if (batch.some(press => preventsDefault(press))) seen.add('a default prevented');
  if (batch.some(press => !preventsDefault(press))) seen.add('a default left to the browser');
}

// The same key typed twice in one go takes two plain keydowns of one key in one batch, and about three test runs in a
// thousand generated none. So one batch of A typed twice is tried first on every test run. With it, the witness check
// holds by construction for that moment, and for 'typed' and 'a default prevented', which the batch reaches too: it no
// longer shows that the generated batches reach them.
const A_TYPED_TWICE_IN_ONE_GO = [[A_KEYDOWN, A_KEYDOWN]];

test('takeTyped() reports every keydown since the last call, in order, as { key } only, leaving out repeats and Cmd, Ctrl and Alt chords, the positions are reported as before, and each keydown\'s default is prevented as the default policy says', () => {
  const seen = new Set();
  const examples = [[A_TYPED_TWICE_IN_ONE_GO]];
  fc.assert(fc.property(fc.array(fc.array(keydown, { maxLength: 6 }), { minLength: 1, maxLength: 4 }), batches => {
    const target = new EventTarget();
    const keyboard = createKeyboard(target);
    let held = [];
    for (const batch of batches) {
      const before = { ...observe(keyboard), prevented: [] };
      const prevented = batch.map(press => dispatchKey(target, 'keydown', press));
      held = [...new Set([...held, ...codesOf(batch.filter(isPositional))])].sort();
      assertStateDelta(before, { ...observe(keyboard), prevented }, {
        universe: ['typed', 'pressed', 'held', 'prevented'],
        expected: {
          typed: setTo(batch.filter(types).map(({ key }) => ({ key }))),
          pressed: setTo(codesOf(batch.filter(press => isPositional(press) && !press.repeat))),
          held: setTo(held),
          // The POLICY table below pins preventsDefault itself; this checks only that every keydown gets its answer.
          prevented: setTo(batch.map(press => preventsDefault(press))),
        },
      });
      noteMoments(seen, batch);
    }
  }), { examples, numRuns: GENERATED_RUNS + examples.length });
  expect(WITNESSES.filter(witness => !seen.has(witness)), 'moments no run reached').toEqual([]);
});

// releaseAll(), which main.js calls on blur and on a hidden tab (DDD-T1, D20): keyups never arrive while the window lacks
// focus, so every key held is forgotten, and a press not yet taken is dropped, never typed once the player comes back.
// The positions pressed are left as they were (the positional channel keeps its meaning). Two keyboards hear the same
// keydowns, keyups and fixed steps and only one is released, so the other shows what it would have reported.
const keyEvent = fc.oneof(
  { arbitrary: keydown.map(fields => ({ type: 'keydown', fields })), weight: 4 },
  { arbitrary: fc.record({ code: fc.constantFrom(...CODES) }).map(fields => ({ type: 'keyup', fields })), weight: 2 },
  { arbitrary: fc.constant({ type: 'endStep' }), weight: 1 },
);

function hear({ target, keyboard }, { type, fields }) {
  if (type === 'endStep') keyboard.endStep();
  else dispatchKey(target, type, fields);
}

const listening = () => {
  const target = new EventTarget();
  return { target, keyboard: createKeyboard(target) };
};

// The last thing that happened to a code: a held code whose last event is a keyup is a tap no fixed step has seen yet.
const lastEventOf = (events, code) => events.findLast(({ fields }) => fields?.code === code)?.type;

const RELEASE_WITNESSES = ['a key held', 'a press not yet taken', 'a tap no step has seen', 'a position pressed'];

// A tap no step has seen takes a keydown with neither Cmd nor Ctrl held, then its keyup before any fixed step, and about
// one test run in a hundred (6 in 500) generated none. So a tap of A is tried first on every test run: it reaches every
// one of the moments above, so the witness check holds by construction for all four and no longer shows that the
// generated events reach any of them.
const A_TAP_NO_STEP_HAS_SEEN = [{ type: 'keydown', fields: A_KEYDOWN }, { type: 'keyup', fields: { code: 'KeyA' } }];

test('releaseAll() forgets every key held and drops every press not yet taken, and leaves the positions pressed as they were', () => {
  const seen = new Set();
  const examples = [[A_TAP_NO_STEP_HAS_SEEN]];
  fc.assert(fc.property(fc.array(keyEvent, { minLength: 1, maxLength: 12 }), events => {
    const released = listening(), kept = listening();
    events.forEach(event => { hear(released, event); hear(kept, event); });
    released.keyboard.releaseAll();
    const before = observe(kept.keyboard);
    assertStateDelta(before, observe(released.keyboard), {
      universe: ['typed', 'pressed', 'held'],
      expected: { typed: setTo([]), held: setTo([]) },
    });
    if (before.held.length) seen.add('a key held');
    if (before.typed.length) seen.add('a press not yet taken');
    if (before.held.some(code => lastEventOf(events, code) === 'keyup')) seen.add('a tap no step has seen');
    if (before.pressed.length) seen.add('a position pressed');
  }), { examples, numRuns: GENERATED_RUNS + examples.length });
  expect(RELEASE_WITNESSES.filter(witness => !seen.has(witness)), 'moments no run reached').toEqual([]);
});

// ---- the default policy (DDD-T8) ----
// The rows are tried in order and the first that matches answers; the answer depends on the modifiers held, by column:
// none or Shift (plain), Cmd or Ctrl, AltGr (Ctrl+Alt) included (shortcut), and Alt/Option without Cmd or Ctrl (alt).
const PREVENT = true, KEEP = false;
const keyOn = (key, code) => ({ key, code });
// bypass: the policy is a fixed table, so it is enumerated, each row by its representatives, under each modifier, with
// and without repeat; the property after it covers repeat over arbitrary keydowns.
const POLICY = [
  { row: 'Space or an arrow', presses: [keyOn(' ', 'Space'), keyOn('ArrowLeft', 'ArrowLeft')], plain: PREVENT, shortcut: KEEP, alt: PREVENT },
  {
    row: 'a key that is one character',
    presses: [keyOn('a', 'KeyA'), keyOn('Z', 'KeyZ'), keyOn('7', 'Digit7'), keyOn('/', 'Slash'), keyOn("'", 'Quote'), keyOn('é', 'Digit2'), keyOn('å', 'BracketLeft')],
    plain: PREVENT, shortcut: KEEP, alt: KEEP,
  },
  { row: 'Backspace', presses: [keyOn('Backspace', 'Backspace')], plain: PREVENT, shortcut: KEEP, alt: KEEP },
  {
    row: 'any other key name',
    presses: [keyOn('Enter', 'Enter'), keyOn('Escape', 'Escape'), keyOn('Tab', 'Tab'), keyOn('F5', 'F5'), keyOn('Dead', 'BracketLeft'), keyOn('Process', 'KeyA'), keyOn('Unidentified', '')],
    plain: KEEP, shortcut: KEEP, alt: KEEP,
  },
];
const NO_MODIFIER = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
const MODIFIERS = [
  { held: 'no modifier', fields: {}, column: 'plain' },
  { held: 'Shift', fields: { shiftKey: true }, column: 'plain' },
  { held: 'Cmd', fields: { metaKey: true }, column: 'shortcut' },
  { held: 'Ctrl', fields: { ctrlKey: true }, column: 'shortcut' },
  { held: 'Ctrl+Alt (AltGr)', fields: { ctrlKey: true, altKey: true }, column: 'shortcut' },
  { held: 'Alt/Option', fields: { altKey: true }, column: 'alt' },
];
const CASES = POLICY.flatMap(row => row.presses.flatMap(({ key, code }) => MODIFIERS.flatMap(({ held, fields, column }) => [false, true]
  .map(repeat => ({
    keydown: { key, code, repeat, ...NO_MODIFIER, ...fields },
    prevents: row[column],
    named: `${JSON.stringify(key)} (${row.row}) with ${held}${repeat ? ', repeating' : ''}`,
  })))));
const answer = prevents => (prevents ? 'prevented' : 'kept');

test('the default policy prevents or keeps each keydown as its table says, on every row, under every modifier, repeat or not', () => {
  const wrong = CASES.filter(({ keydown, prevents }) => preventsDefault(keydown) !== prevents)
    .map(({ named, prevents }) => `${named}: ${answer(!prevents)}, not ${answer(prevents)}`);
  expect(wrong, 'keydowns the policy answers wrongly').toEqual([]);
});

test('a repeat gets the same answer as its first press, so a held key never changes what the browser is left to do', () => {
  const representatives = POLICY.flatMap(({ presses }) => presses);
  const anyKeydown = fc.record({
    key: fc.oneof(fc.constantFrom(...representatives.map(({ key }) => key)), fc.string({ minLength: 1, maxLength: 3 })),
    code: fc.oneof(fc.constantFrom(...representatives.map(({ code }) => code), ...CODES), fc.string({ maxLength: 6 })),
    metaKey: fc.boolean(), ctrlKey: fc.boolean(), altKey: fc.boolean(), shiftKey: fc.boolean(),
  });
  fc.assert(fc.property(anyKeydown, keydown => {
    expect(preventsDefault({ ...keydown, repeat: true })).toBe(preventsDefault({ ...keydown, repeat: false }));
  }));
});
