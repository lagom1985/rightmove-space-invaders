// Web Audio adapter (ADR-002): resource operations only; the decisions are the director's.
//   createSynth({
//     recipes,                        // optional: defaults to the sound recipes in recipes.js
//     createContext,                  // () => new AudioContext()  (webkitAudioContext fallback); may throw
//     now,                            // () => performance.now()   (journal 'at')
//     setInterval, clearInterval,     // timers for the music look-ahead scheduler (needed once music starts)
//   }) -> {
//     unlock(),          // call only from a keydown handler: creates/resumes the AudioContext
//     perform(cue),      // a cue from src/sound/director.js (see the per-operation table in the feature delta)
//     diagnostics,       // read-only view, exposed as window.makeTheRightMove.audio (ADR-003)
//   }
//   diagnostics (getters returning frozen copies, no functions):
//     state:      'locked' | 'running' | 'suspended' | 'unavailable'
//     journal:    [{ seq, sound, detail, t, at }]  the last 100 sounds actually started;
//                 seq increases by one per entry and never repeats (use it, not the array index, as a cursor)
//     music:      'playing' | 'stopped'
//     voices:     effect voices sounding now (updated synchronously by perform);  peakVoices: highest ever (cap: 8)
//   While state is 'locked' or 'unavailable', perform() changes nothing and writes no journal entry. While it is
//   'suspended' the context still holds what it was playing, so the stop operations (stopLoop, stopMusic,
//   silence) act as they do when running: the director has forgotten those sounds and would never stop them,
//   and they would be heard again on resume. The start and play operations do nothing while suspended.
//   The audio graph is the browser's and may fail at any time: when it throws inside perform() or the music timer,
//   the synth stops what it can, goes 'unavailable' for good (silent fallback) and prints nothing, so the failure
//   never reaches the game loop.
//   The look-ahead scheduler never schedules a note before the audio clock's current time, so fast-forwarded
//   timers (Playwright's fake clock) cannot build a backlog: the audio clock runs on real time.
//   A recipe's `wave` is an oscillator type, or 'noise' (white noise through a low-pass filter; `from` and `to`
//   are then the filter's cut-off pitches). One noise buffer is shared by every noise voice.
//   A recipe with `parts` is a jingle: one voice plays each part in turn, every part with its own attack and release.
//   A recipe with `loop: true` is played by `startLoop` (the Dream Home siren): an oscillator whose pitch swings
//   between `from` and `to` once every `duration` seconds, until `stopLoop` or `silence`. A loop is not an effect
//   voice: it is not counted in `voices` or `peakVoices` and the voice cap never cuts it; starting one writes a
//   journal entry (detail {}), and starting a loop that is already running does nothing.
//   `startMusic` plays the tune in recipes.js (MUSIC) round and round on its own bus, `stopMusic` stops it; both do
//   nothing when already so, and neither writes a journal entry. Music voices are not effect voices: they are not
//   counted in `voices` or `peakVoices`. Every effect plays on the effects bus, the music on a bus 6 dB or more
//   below it (BUS_LEVELS in recipes.js). `silence` stops every voice, loop and the music at once (`voices` is 0 and
//   `music` is 'stopped' when perform returns); cues for sounds and operations without a recipe are skipped.
//   The parts live next to this file: voices.js (building voices from recipes), effects.js (the voice cap and the
//   loops), music.js (the music scheduler) and journal.js. This module keeps the lifecycle and routes the cues.
import { CueOp } from '../game/events.js';
import { SOUND_RECIPES, BUS_LEVELS } from './recipes.js';
import { createVoiceBuilder } from './voices.js';
import { createEffects } from './effects.js';
import { createMusic } from './music.js';
import { createJournal } from './journal.js';

const State = Object.freeze({ LOCKED: 'locked', RUNNING: 'running', SUSPENDED: 'suspended', UNAVAILABLE: 'unavailable' });
const STOPS = new Set([CueOp.STOP_LOOP, CueOp.STOP_MUSIC, CueOp.SILENCE]);   // these reach a suspended context too (see the header)

export function createSynth({ recipes = SOUND_RECIPES, createContext, now, setInterval, clearInterval } = {}) {
  let state = State.LOCKED, context = null, effects = null, music = null;   // effects and music exist once the context is open
  const journal = createJournal(now);

  // The context settles asynchronously after resume(); a browser may also suspend it later.
  function followContext() {
    if (state === State.UNAVAILABLE) return;   // a context that failed once is not trusted again
    state = context.state === 'running' ? State.RUNNING : State.SUSPENDED;
  }

  function resume() {
    state = State.RUNNING;
    context.resume().then(followContext, followContext);
  }

  function unlock() {
    if (state === State.SUSPENDED) resume();
    else if (state === State.LOCKED) openContext();
  }

  function openContext() {
    try {
      context = createContext();
      const builder = createVoiceBuilder(context);
      const buses = { effects: builder.makeBus(BUS_LEVELS.effects), music: builder.makeBus(BUS_LEVELS.music) };
      effects = createEffects({ builder, bus: buses.effects });
      music = createMusic({ builder, bus: buses.music, setInterval, clearInterval, guard: failSafe });
    } catch {
      state = State.UNAVAILABLE;
      return;
    }
    context.addEventListener('statechange', followContext);
    resume();
  }

  function play({ sound, detail = {}, t }) {
    const recipe = recipes[sound];
    if (!recipe) return;
    effects.play(recipe, detail);
    journal.record(sound, detail, t);
  }

  function startLoop({ sound, t }) {
    const recipe = recipes[sound];
    if (!recipe?.loop || effects.isLooping(sound)) return;
    effects.startLoop(sound, recipe);
    journal.record(sound, {}, t);
  }

  function silence() {
    effects.stopVoices();
    effects.stopLoops();
    music.stop();
  }

  const operations = {
    [CueOp.PLAY]: play, [CueOp.START_LOOP]: startLoop, [CueOp.STOP_LOOP]: ({ sound }) => effects.stopLoop(sound),
    [CueOp.START_MUSIC]: () => music.start(), [CueOp.STOP_MUSIC]: () => music.stop(), [CueOp.SILENCE]: silence,
  };

  const mayPerform = op => state === State.RUNNING || (state === State.SUSPENDED && STOPS.has(op));

  // The synth silences what it still can, one kind of sound at a time (a broken graph may refuse any of them).
  function giveUp() {
    state = State.UNAVAILABLE;
    for (const stop of [() => effects.stopVoices(), () => effects.stopLoops(), () => music.stop()]) {
      try { stop(); } catch { /* the graph is beyond reach: nothing more can be stopped */ }
    }
  }

  // Runs `work`; a failure of the audio graph inside it ends the synth instead of reaching the caller.
  function failSafe(work) {
    return (...args) => {
      try { work(...args); } catch { giveUp(); }
    };
  }

  const perform = failSafe(cue => { if (mayPerform(cue.op)) operations[cue.op]?.(cue); });

  const diagnostics = Object.freeze({
    get state() { return state; },
    get journal() { return journal.snapshot(); },
    get music() { return music?.playing ? 'playing' : 'stopped'; },
    get voices() { return effects?.voices ?? 0; },
    get peakVoices() { return effects?.peakVoices ?? 0; },
  });

  return { unlock, perform, diagnostics };
}
