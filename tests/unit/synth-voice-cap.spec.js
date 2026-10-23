import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { unlockedSynth } from './support/fake-audio.js';
import { CueOp } from '../../src/events.js';
import { SOUND_RECIPES } from '../../src/theme.js';

// At most eight effects sound at once; when a ninth arrives the oldest are cut first, so the sound a player
// has just caused is always heard. A cut voice fades out; one that is still sounding is not touched.

const VOICE_CAP = 8;
const EFFECTS = Object.keys(SOUND_RECIPES).filter(sound => !SOUND_RECIPES[sound].loop);
const play = sound => ({ op: CueOp.PLAY, sound, detail: { value: 100, note: 0 } });

test('past eight effects at once the oldest are the ones cut and the newest keep sounding', () => {
  fc.assert(fc.property(fc.array(fc.constantFrom(...EFFECTS), { minLength: VOICE_CAP + 1, maxLength: 24 }), sounds => {
    const { synth, audio } = unlockedSynth();
    sounds.forEach(sound => synth.perform(play(sound)));
    const cut = sounds.length - VOICE_CAP;
    expect(audio.voices().map(voice => voice.faded)).toEqual(sounds.map((_, started) => started < cut));
    expect(synth.diagnostics.voices).toBe(VOICE_CAP);
  }));
});
