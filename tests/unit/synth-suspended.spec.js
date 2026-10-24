import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { unlockedSynth } from './support/fake-audio.js';
import { CueOp, Sound } from '../../src/game/events.js';
import { SOUND_RECIPES } from '../../src/sound/recipes.js';

// A browser may suspend the audio context at any moment (Safari does after an interruption). The director
// forgets whatever a pause, a mute or the end of a game stopped, so a stop that arrives while the context is
// suspended must still reach the sound: otherwise the siren or the music is heard again on resume, over the
// game, the pause or the game-over screen. Starting a sound while suspended must still do nothing.

const EFFECTS = Object.keys(SOUND_RECIPES).filter(sound => !SOUND_RECIPES[sound].loop);
const play = sound => ({ op: CueOp.PLAY, sound, detail: { value: 100, note: 0 } });
const startSiren = { op: CueOp.START_LOOP, sound: Sound.SIREN };
const startMusic = { op: CueOp.START_MUSIC };

const STOPS = {
  stopLoop: { op: CueOp.STOP_LOOP, sound: Sound.SIREN },
  stopMusic: { op: CueOp.STOP_MUSIC },
  silence: { op: CueOp.SILENCE },
};

// What a stop leaves behind, by how many effects were sounding.
const afterStop = {
  stopLoop: effects => ({ sirenStopped: true, music: 'playing', musicTimers: 1, musicFaded: false, effectsFaded: 0, effectsSounding: effects }),
  stopMusic: effects => ({ sirenStopped: false, music: 'stopped', musicTimers: 0, musicFaded: true, effectsFaded: 0, effectsSounding: effects }),
  silence: effects => ({ sirenStopped: true, music: 'stopped', musicTimers: 0, musicFaded: true, effectsFaded: effects, effectsSounding: 0 }),
};

// Starts the given effects, the siren and the music, and says which nodes belong to which.
function soundingSynth(effects) {
  const { synth, audio, timers } = unlockedSynth();
  const slice = cue => {
    const before = audio.nodes().length;
    synth.perform(cue);
    return audio.nodes().slice(before);
  };
  const effectNodes = effects.flatMap(sound => slice(play(sound)));
  const sirenNodes = slice(startSiren), musicNodes = slice(startMusic);
  return { synth, audio, timers, effectNodes, sirenNodes, musicNodes };
}

const fadedAmong = (audio, nodes) => audio.voices().filter(({ source, faded }) => faded && nodes.includes(source));

test('a stop that arrives while the context is suspended still stops what it stops, before the context resumes', () => {
  fc.assert(fc.property(fc.constantFrom(...Object.keys(STOPS)), fc.array(fc.constantFrom(...EFFECTS), { minLength: 1, maxLength: 6 }), (stop, effects) => {
    const { synth, audio, timers, effectNodes, sirenNodes, musicNodes } = soundingSynth(effects);
    audio.changeState('suspended');
    synth.perform(STOPS[stop]);
    synth.unlock();   // the next key press resumes the context
    expect({
      sirenStopped: sirenNodes.filter(node => node.kind === 'oscillator').every(node => node.stops.length > 0),
      music: synth.diagnostics.music,
      musicTimers: timers.running(),
      musicFaded: fadedAmong(audio, musicNodes).length > 0,
      effectsFaded: fadedAmong(audio, effectNodes).length,
      effectsSounding: synth.diagnostics.voices,
    }).toEqual(afterStop[stop](effects.length));
  }));
});

const startCue = fc.oneof(
  fc.constantFrom(...EFFECTS).map(play),
  fc.constantFrom(startSiren, startMusic),
);

test('while the context is suspended nothing starts: no node, no journal entry, no music', () => {
  fc.assert(fc.property(fc.array(startCue, { minLength: 1, maxLength: 10 }), cues => {
    const { synth, audio, timers } = unlockedSynth();
    audio.changeState('suspended');
    const before = { nodes: audio.nodes().length, journal: synth.diagnostics.journal, music: synth.diagnostics.music, timers: timers.running(), voices: synth.diagnostics.voices };
    cues.forEach(cue => synth.perform(cue));
    expect({ nodes: audio.nodes().length, journal: synth.diagnostics.journal, music: synth.diagnostics.music, timers: timers.running(), voices: synth.diagnostics.voices }).toEqual(before);
  }));
});
