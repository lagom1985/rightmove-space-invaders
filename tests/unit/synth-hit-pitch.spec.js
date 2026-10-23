import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { unlockedSynth } from './support/fake-audio.js';
import { CueOp, Sound } from '../../src/events.js';
import { HURDLES, hitPitch } from '../../src/theme.js';

// Hitting a more valuable hurdle sounds higher (US-01). hit-pitch.spec.js covers the pitch function on its own;
// this one covers the wiring: the pitch the synth really starts the voice at, for the value the cue carries.

const HURDLE_VALUES = HURDLES.map(hurdle => hurdle.value);   // £300, £200, £150, £100, £50

const lowerThenHigher = fc.uniqueArray(fc.constantFrom(...HURDLE_VALUES), { minLength: 2, maxLength: 2 })
  .map(pair => pair.sort((a, b) => a - b));

// The pitch the voice of a hit on a hurdle worth `value` starts at.
function startPitchOfHit(value) {
  const { synth, audio } = unlockedSynth();
  synth.perform({ op: CueOp.PLAY, sound: Sound.HURDLE_HIT, detail: { value } });
  const [voice, ...others] = audio.voices();
  expect(others, 'a hit is one voice').toEqual([]);
  return voice.startPitch;
}

test('the synth starts a hurdle hit at the pitch for that hurdle\'s value, and higher for the more valuable one', () => {
  fc.assert(fc.property(lowerThenHigher, ([lower, higher]) => {
    expect(startPitchOfHit(lower)).toBe(hitPitch(lower));
    expect(startPitchOfHit(higher)).toBe(hitPitch(higher));
    expect(startPitchOfHit(higher)).toBeGreaterThan(startPitchOfHit(lower));
  }));
});
