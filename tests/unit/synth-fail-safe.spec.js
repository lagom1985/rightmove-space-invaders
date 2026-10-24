import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { unlockedSynth } from './support/fake-audio.js';
import { CueOp, Sound } from '../../src/game/events.js';
import { SOUND_RECIPES } from '../../src/theme/theme.js';

// The audio graph is the browser's, and it can fail whenever it likes (out of resources, a closed context).
// A failure must never reach the game loop, which would freeze the game: the synth goes silent and
// 'unavailable' for good, prints nothing, and the game carries on without sound.

const EFFECTS = Object.keys(SOUND_RECIPES).filter(sound => !SOUND_RECIPES[sound].loop);
const play = sound => ({ op: CueOp.PLAY, sound, detail: { value: 100, note: 0 } });
const startSiren = { op: CueOp.START_LOOP, sound: Sound.SIREN };
const startMusic = { op: CueOp.START_MUSIC };
const stopMusic = { op: CueOp.STOP_MUSIC };
const silence = { op: CueOp.SILENCE };

const anyCue = fc.oneof(
  fc.constantFrom(...EFFECTS).map(play),
  fc.constantFrom(startSiren, startMusic, stopMusic, silence),
);

// What the page console was told while `work` ran.
function printedDuring(work) {
  const methods = ['log', 'info', 'warn', 'error', 'debug'], original = {}, printed = [];
  for (const method of methods) {
    original[method] = console[method];
    console[method] = (...args) => { printed.push([method, ...args]); };
  }
  try { work(); } finally { for (const method of methods) console[method] = original[method]; }
  return printed;
}

test('a cue the broken audio graph cannot play leaves the synth unavailable, silent and quiet, and it stays so', () => {
  fc.assert(fc.property(fc.constantFrom(...EFFECTS).map(play), fc.array(anyCue, { maxLength: 10 }), (failing, later) => {
    const { synth, audio } = unlockedSynth();
    const built = audio.nodes().length;   // what the unlocked synth needs before any sound
    audio.breakGraph();
    const printed = printedDuring(() => {
      expect(() => synth.perform(failing)).not.toThrow();
      later.forEach(cue => synth.perform(cue));
      audio.changeState('running');   // the browser reports the context as fine again: the synth does not trust it
      synth.unlock();
      later.forEach(cue => synth.perform(cue));
    });
    expect({ printed, state: synth.diagnostics.state, music: synth.diagnostics.music, voices: synth.diagnostics.voices, journal: synth.diagnostics.journal, nodes: audio.nodes().length })
      .toEqual({ printed: [], state: 'unavailable', music: 'stopped', voices: 0, journal: [], nodes: built });
  }));
});

test('a failure while the siren and the music sound stops them as far as it can', () => {
  fc.assert(fc.property(fc.constantFrom(...EFFECTS).map(play), failing => {
    const { synth, audio, timers } = unlockedSynth();
    synth.perform(startSiren);
    const sirenNodes = audio.nodes().filter(node => node.kind === 'oscillator');
    synth.perform(startMusic);
    audio.breakGraph();
    expect(() => synth.perform(failing)).not.toThrow();
    expect({ state: synth.diagnostics.state, music: synth.diagnostics.music, musicTimers: timers.running(), sirenStopped: sirenNodes.every(node => node.stops.length > 0) })
      .toEqual({ state: 'unavailable', music: 'stopped', musicTimers: 0, sirenStopped: true });
  }));
});

test('a failure inside the music timer ends the music and the synth, and the timer stops', () => {
  fc.assert(fc.property(fc.double({ min: 0.25, max: 5, noNaN: true }), seconds => {
    const { synth, audio, timers } = unlockedSynth();
    synth.perform(startMusic);
    audio.breakGraph();
    audio.advanceClock(seconds);   // the next notes have to be laid out, which the broken graph cannot do
    const printed = printedDuring(() => expect(() => timers.tick()).not.toThrow());
    expect({ printed, state: synth.diagnostics.state, music: synth.diagnostics.music, musicTimers: timers.running() })
      .toEqual({ printed: [], state: 'unavailable', music: 'stopped', musicTimers: 0 });
  }));
});
