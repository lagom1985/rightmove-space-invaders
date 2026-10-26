import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { assertStateDelta, setTo } from '../common/state-delta.js';
import { createKeyboard } from '../../src/platform/input.js';

// The keyboard (src/platform/input.js, ADR-009) over a plain EventTarget. Node has EventTarget but no KeyboardEvent, so
// each keydown is an Event with the fields the keyboard reads set on it (DDD-T11: key, code, repeat and the modifiers).
// Its two channels: the typed presses, every keydown in order as { key }, except repeats and chords (Cmd, Ctrl or
// Alt/Option held; DDD-T1, DDD-T4), and the positions, as they always were (Cmd and Ctrl left alone, Alt not).
// Universe: what the keyboard reports, `typed` (takeTyped()), `pressed` (takePressed(), sorted) and `held` (the codes
// isDown answers true for), read before and after each batch of keydowns.

const KEYS = ['a', 'Z', 'm', 'é', 'ß', ' ', '/', 'Enter', 'Backspace', 'Escape', 'ArrowUp', 'Dead', 'Shift'];
const CODES = ['KeyA', 'KeyZ', 'KeyM', 'KeyQ', 'Digit2', 'Minus', 'Space', 'Slash', 'Enter', 'Backspace', 'Escape', 'ArrowUp', 'ShiftLeft'];
const sometimes = fc.oneof({ arbitrary: fc.constant(false), weight: 3 }, { arbitrary: fc.constant(true), weight: 1 });
const keydown = fc.record({
  key: fc.oneof({ arbitrary: fc.constantFrom(...KEYS), weight: 4 }, { arbitrary: fc.string({ minLength: 1, maxLength: 2 }), weight: 1 }),
  code: fc.constantFrom(...CODES),
  repeat: sometimes, metaKey: sometimes, ctrlKey: sometimes, altKey: sometimes, shiftKey: sometimes,
});

function dispatchKeydown(target, fields) {
  const event = new Event('keydown', { cancelable: true });
  Object.assign(event, fields);
  target.dispatchEvent(event);
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
const WITNESSES = ['typed', 'the same key typed twice in one go', 'a repeat left out', 'Cmd left out', 'Ctrl left out', 'Alt left out'];

function noteMoments(seen, batch) {
  const typed = batch.filter(types).map(({ key }) => key);
  if (typed.length) seen.add('typed');
  if (new Set(typed).size < typed.length) seen.add('the same key typed twice in one go');
  if (batch.some(press => press.repeat)) seen.add('a repeat left out');
  if (batch.some(press => press.metaKey)) seen.add('Cmd left out');
  if (batch.some(press => press.ctrlKey)) seen.add('Ctrl left out');
  if (batch.some(press => press.altKey)) seen.add('Alt left out');
}

test('takeTyped() reports every keydown since the last call, in order, as { key } only, leaving out repeats and Cmd, Ctrl and Alt chords, and the positions are reported as before', () => {
  const seen = new Set();
  fc.assert(fc.property(fc.array(fc.array(keydown, { maxLength: 6 }), { minLength: 1, maxLength: 4 }), batches => {
    const target = new EventTarget();
    const keyboard = createKeyboard(target);
    let held = [];
    for (const batch of batches) {
      const before = observe(keyboard);
      batch.forEach(press => dispatchKeydown(target, press));
      held = [...new Set([...held, ...codesOf(batch.filter(isPositional))])].sort();
      assertStateDelta(before, observe(keyboard), {
        universe: ['typed', 'pressed', 'held'],
        expected: {
          typed: setTo(batch.filter(types).map(({ key }) => ({ key }))),
          pressed: setTo(codesOf(batch.filter(press => isPositional(press) && !press.repeat))),
          held: setTo(held),
        },
      });
      noteMoments(seen, batch);
    }
  }));
  expect(WITNESSES.filter(witness => !seen.has(witness)), 'moments no run reached').toEqual([]);
});
