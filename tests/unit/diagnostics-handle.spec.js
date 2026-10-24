import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { createSynth } from '../../src/sound/synth.js';
import { CueOp, Sound } from '../../src/game/events.js';
import { HURDLES } from '../../src/theme/theme.js';

// Contract of the read-only handle (ADR-003, DDD-10): window.makeTheRightMove.audio is plain data.
// Nothing reachable through it is a function, everything is frozen, reads are snapshots, and no
// write through it can change what a later read returns.

const param = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} });
const node = () => ({ connect: target => target, start() {}, stop() {}, frequency: param(), gain: param() });
const fakeContext = () => ({
  state: 'running', currentTime: 0, destination: {},
  createOscillator: node, createGain: node,
  addEventListener() {}, resume: () => Promise.resolve(),
});

// A synth that is unlocked and has started the given sounds.
function synthThatPlayed(sounds) {
  const synth = createSynth({ createContext: fakeContext, now: () => 0 });
  synth.unlock();
  sounds.forEach((cue, i) => synth.perform({ op: CueOp.PLAY, t: i, ...cue }));
  return synth;
}

const cue = fc.oneof(
  fc.constant({ sound: Sound.SHOT }),
  fc.constantFrom(...HURDLES.map(hurdle => hurdle.value)).map(value => ({ sound: Sound.HURDLE_HIT, detail: { value } })),
);

// Everything a reader can reach through the handle, as [path, value] pairs.
function reachable(value, path = 'audio') {
  if (value === null || typeof value !== 'object') return [[path, value]];
  return [[path, value], ...Object.keys(value).flatMap(key => reachable(value[key], `${path}.${key}`))];
}

// What a reader sees through the handle right now.
const readings = audio => ({ state: audio.state, journal: audio.journal, music: audio.music, voices: audio.voices, peakVoices: audio.peakVoices });

// Tries every kind of write a careless reader might attempt. A rejected write (frozen object) and a
// silently ignored one both count: only the later read matters.
function scribbleOn(audio) {
  const attempts = [
    () => { audio.state = 'running'; },
    () => { audio.voices = 99; },
    () => { audio.peakVoices = 99; },
    () => { audio.music = 'playing'; },
    () => { audio.journal = []; },
    () => { audio.extra = 1; },
    () => { delete audio.state; },
    () => audio.journal.push({ seq: 0, sound: 'forged' }),
    () => audio.journal.pop(),
    () => { audio.journal[0].sound = 'forged'; },
    () => { audio.journal[0].detail.value = 1; },
    () => { audio.journal[0].detail.extra = 1; },
  ];
  for (const attempt of attempts) {
    try { attempt(); } catch { /* frozen: the write was refused, which is fine */ }
  }
}

test('the diagnostics handle is data only: no function anywhere, everything frozen', () => {
  fc.assert(fc.property(fc.array(cue, { maxLength: 30 }), sounds => {
    const { diagnostics } = synthThatPlayed(sounds);
    const everything = reachable(diagnostics);
    expect(everything.filter(([, value]) => typeof value === 'function').map(([path]) => path)).toEqual([]);
    expect(everything.filter(([, value]) => typeof value === 'object' && value !== null && !Object.isFrozen(value)).map(([path]) => path)).toEqual([]);
    expect(Object.values(Object.getOwnPropertyDescriptors(diagnostics)).filter(d => d.set || typeof d.value === 'function')).toEqual([]);
  }));
});

test('writes through the diagnostics handle never change what a later read returns', () => {
  fc.assert(fc.property(fc.array(cue, { minLength: 1, maxLength: 30 }), sounds => {
    const { diagnostics } = synthThatPlayed(sounds);
    const before = structuredClone(readings(diagnostics));
    scribbleOn(diagnostics);
    expect(readings(diagnostics)).toEqual(before);
  }));
});

test('a journal read is a snapshot: sounds started later do not change it', () => {
  fc.assert(fc.property(fc.array(cue, { minLength: 1, maxLength: 20 }), fc.array(cue, { minLength: 1, maxLength: 20 }), (first, later) => {
    const synth = synthThatPlayed(first);
    const snapshot = synth.diagnostics.journal;
    const copy = structuredClone(snapshot);
    later.forEach(next => synth.perform({ op: CueOp.PLAY, t: 99, ...next }));
    expect(snapshot).toEqual(copy);
  }));
});
