// Web Audio adapter (ADR-002): resource operations only; the decisions are the director's.
//   createSynth({
//     recipes,                        // optional: defaults to the sound recipes in theme.js
//     createContext,                  // () => new AudioContext()  (webkitAudioContext fallback); may throw
//     now,                            // () => performance.now()   (journal 'at')
//     setInterval, clearInterval,     // timers for the music look-ahead scheduler
//   }) -> {
//     unlock(),          // call only from a keydown handler: creates/resumes the AudioContext
//     perform(cue),      // a cue from src/sound.js (see the per-operation table in the feature delta)
//     diagnostics,       // read-only view, exposed as window.makeTheRightMove.audio (ADR-003)
//   }
//   diagnostics (getters returning frozen copies, no functions):
//     state:      'locked' | 'running' | 'suspended' | 'unavailable'
//     journal:    [{ seq, sound, detail, t, at }]  the last 100 sounds actually started;
//                 seq increases by one per entry and never repeats (use it, not the array index, as a cursor)
//     music:      'playing' | 'stopped'
//     voices:     effect voices sounding now (updated synchronously by perform);  peakVoices: highest ever (cap: 8)
//   While state is 'locked', 'suspended' or 'unavailable', perform() changes nothing and writes no journal entry.
//   The look-ahead scheduler never schedules a note before the audio clock's current time, so fast-forwarded
//   timers (Playwright's fake clock) cannot build a backlog: the audio clock runs on real time.
//   So far the synth performs `play` and `silence` (every voice stops at once: `voices` is 0 when perform returns);
//   cues for sounds and operations without a recipe are skipped, the timers and `music: 'playing'` arrive
//   with the music slice.
import { CueOp } from './events.js';
import { SOUND_RECIPES } from './theme.js';

const State = Object.freeze({ LOCKED: 'locked', RUNNING: 'running', SUSPENDED: 'suspended', UNAVAILABLE: 'unavailable' });
const VOICE_CAP = 8, JOURNAL_SIZE = 100;
const ATTACK = 0.004, RELEASE = 0.03;   // seconds: short ramps at both ends of a voice, so it never clicks

const valueOf = (pitch, detail) => (typeof pitch === 'function' ? pitch(detail) : pitch);

export function createSynth({ recipes = SOUND_RECIPES, createContext, now } = {}) {
  let state = State.LOCKED, context = null, entries = 0, peakVoices = 0;
  const voices = [];
  const journal = [];

  // The context settles asynchronously after resume(); a browser may also suspend it later.
  function followContext() { state = context.state === 'running' ? State.RUNNING : State.SUSPENDED; }

  function resume() {
    state = State.RUNNING;
    context.resume().then(followContext, followContext);
  }

  function unlock() {
    if (state === State.SUSPENDED) return resume();
    if (state !== State.LOCKED) return;
    try {
      context = createContext();
    } catch {
      state = State.UNAVAILABLE;
      return;
    }
    context.addEventListener('statechange', followContext);
    resume();
  }

  function startVoice(recipe, detail) {
    const start = context.currentTime, end = start + recipe.duration;
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = recipe.wave;
    oscillator.frequency.setValueAtTime(valueOf(recipe.from, detail), start);
    oscillator.frequency.exponentialRampToValueAtTime(valueOf(recipe.to, detail), end);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(recipe.level, start + ATTACK);
    gain.gain.setValueAtTime(recipe.level, end - RELEASE);
    gain.gain.linearRampToValueAtTime(0, end);
    oscillator.connect(gain).connect(context.destination);
    const voice = { fadeOut: () => fadeOut(gain.gain) };
    oscillator.onended = () => forget(voice);
    oscillator.start(start);
    oscillator.stop(end);
    voices.push(voice);
    peakVoices = Math.max(peakVoices, voices.length);
  }

  function fadeOut(level) {
    level.cancelScheduledValues(context.currentTime);
    level.setTargetAtTime(0, context.currentTime, RELEASE / 3);
  }

  function forget(voice) {
    const at = voices.indexOf(voice);
    if (at >= 0) voices.splice(at, 1);
  }

  // The oldest voices go first.
  function cutVoicesDownTo(count) {
    while (voices.length > count) voices.shift().fadeOut();
  }

  const makeRoomForAVoice = () => cutVoicesDownTo(VOICE_CAP - 1);
  const silence = () => cutVoicesDownTo(0);

  function play({ sound, detail = {}, t }) {
    const recipe = recipes[sound];
    if (!recipe) return;
    makeRoomForAVoice();
    startVoice(recipe, detail);
    journal.push({ seq: ++entries, sound, detail, t, at: now() });
    if (journal.length > JOURNAL_SIZE) journal.shift();
  }

  function perform(cue) {
    if (state !== State.RUNNING) return;
    if (cue.op === CueOp.PLAY) play(cue);
    if (cue.op === CueOp.SILENCE) silence();
  }

  const copyOfJournal = () => Object.freeze(journal.map(entry => Object.freeze({ ...entry, detail: Object.freeze({ ...entry.detail }) })));

  const diagnostics = Object.freeze({
    get state() { return state; },
    get journal() { return copyOfJournal(); },
    get music() { return 'stopped'; },
    get voices() { return voices.length; },
    get peakVoices() { return peakVoices; },
  });

  return { unlock, perform, diagnostics };
}
