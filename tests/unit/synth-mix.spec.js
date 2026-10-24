import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { unlockedSynth } from './support/fake-audio.js';
import { CueOp, Sound } from '../../src/game/events.js';
import { SOUND_RECIPES } from '../../src/sound/recipes.js';

// US-06: the music sits at least 6 dB below every effect. music-level.spec.js checks the numbers in the recipes;
// this one checks the mix the synth really builds: how loud each voice can get at the speakers, which is its
// own gain times the gain of every node it passes through, the bus it plays on included.

const MINIMUM_GAP_DB = 6;
const decibelsBetween = (louder, quieter) => 20 * Math.log10(louder / quieter);

// The cue that makes a recipe's sound: a siren loops, every other effect is played once.
const cueFor = sound => (SOUND_RECIPES[sound].loop
  ? { op: CueOp.START_LOOP, sound }
  : { op: CueOp.PLAY, sound, detail: { value: 100, note: 0 } });

const loudestVoiceAfter = cue => {
  const { synth, audio } = unlockedSynth();
  synth.perform(cue);
  return Math.max(...audio.voices().map(voice => voice.peak));
};

test('the music is at least 6 dB below every effect, as the synth mixes them', () => {
  const music = loudestVoiceAfter({ op: CueOp.START_MUSIC });
  fc.assert(fc.property(fc.constantFrom(...Object.keys(SOUND_RECIPES)), sound => {
    expect(decibelsBetween(loudestVoiceAfter(cueFor(sound)), music)).toBeGreaterThanOrEqual(MINIMUM_GAP_DB);
  }));
});
