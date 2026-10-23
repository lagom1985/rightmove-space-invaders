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
//   A recipe's `wave` is an oscillator type, or 'noise' (white noise through a low-pass filter; `from` and `to`
//   are then the filter's cut-off pitches). One noise buffer is shared by every noise voice.
//   A recipe with `parts` is a jingle: one voice plays each part in turn, every part with its own attack and release.
//   A recipe with `loop: true` is played by `startLoop` (the Dream Home siren): an oscillator whose pitch swings
//   between `from` and `to` once every `duration` seconds, until `stopLoop` or `silence`. A loop is not an effect
//   voice: it is not counted in `voices` or `peakVoices` and the voice cap never cuts it; starting one writes a
//   journal entry (detail {}), and starting a loop that is already running does nothing.
//   So far the synth performs `play`, `startLoop`, `stopLoop` and `silence` (every voice and loop stops at once:
//   `voices` is 0 when perform returns); cues for sounds and operations without a recipe are skipped, the timers
//   and `music: 'playing'` arrive with the music slice.
import { CueOp } from './events.js';
import { SOUND_RECIPES, partsOf } from './theme.js';

const State = Object.freeze({ LOCKED: 'locked', RUNNING: 'running', SUSPENDED: 'suspended', UNAVAILABLE: 'unavailable' });
const VOICE_CAP = 8, JOURNAL_SIZE = 100;
const NOISE = 'noise', NOISE_SECONDS = 1;
const ATTACK = 0.004, RELEASE = 0.03;   // seconds: short ramps at both ends of a voice, so it never clicks

const valueOf = (pitch, detail) => (typeof pitch === 'function' ? pitch(detail) : pitch);

export function createSynth({ recipes = SOUND_RECIPES, createContext, now } = {}) {
  let state = State.LOCKED, context = null, noise = null, entries = 0, peakVoices = 0;
  const voices = [];
  const loops = new Map();   // sound -> a function that stops that loop
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

  // A shared second of white noise, from a private generator so it never disturbs Math.random.
  function noiseBuffer() {
    if (noise) return noise;
    noise = context.createBuffer(1, Math.round(context.sampleRate * NOISE_SECONDS), context.sampleRate);
    const samples = noise.getChannelData(0);
    let seed = 1;
    for (let i = 0; i < samples.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      samples[i] = seed / 2147483648 - 1;
    }
    return noise;
  }

  // The pitch a voice starts at, gliding to where it ends: the oscillator's frequency or the noise filter's cut-off.
  function glide(param, part, detail, start, end) {
    param.setValueAtTime(valueOf(part.from, detail), start);
    param.exponentialRampToValueAtTime(valueOf(part.to, detail), end);
  }

  // A sound source, the node its sound comes out of, and the parameter that sets its pitch.
  function makeSource(recipe) {
    if (recipe.wave === NOISE) {
      const source = context.createBufferSource(), filter = context.createBiquadFilter();
      source.buffer = noiseBuffer();
      source.loop = true;
      filter.type = 'lowpass';
      source.connect(filter);
      return { source, output: filter, pitch: filter.frequency };
    }
    const source = context.createOscillator();
    source.type = recipe.wave;
    return { source, output: source, pitch: source.frequency };
  }

  // Lays out the recipe's parts one after the other, each with its own short attack and release so it never
  // clicks. Returns the time the last part ends.
  function schedule(recipe, detail, pitch, level, start) {
    let from = start;
    for (const part of partsOf(recipe)) {
      const to = from + part.duration;
      glide(pitch, part, detail, from, to);
      level.setValueAtTime(0, from);
      level.linearRampToValueAtTime(recipe.level, from + ATTACK);
      level.setValueAtTime(recipe.level, to - RELEASE);
      level.linearRampToValueAtTime(0, to);
      from = to;
    }
    return from;
  }

  function startVoice(recipe, detail) {
    const { source, output, pitch } = makeSource(recipe), gain = context.createGain(), start = context.currentTime;
    const end = schedule(recipe, detail, pitch, gain.gain, start);
    output.connect(gain).connect(context.destination);
    const voice = { fadeOut: () => fadeOut(gain.gain) };
    source.onended = () => forget(voice);
    source.start(start);
    source.stop(end);
    voices.push(voice);
    peakVoices = Math.max(peakVoices, voices.length);
  }

  // A siren: a carrier whose pitch a slow oscillator swings up and down, running until it is stopped.
  function startLoopVoice(sound, recipe) {
    const start = context.currentTime, low = valueOf(recipe.from, {}), high = valueOf(recipe.to, {});
    const carrier = context.createOscillator(), swing = context.createOscillator();
    const swingDepth = context.createGain(), gain = context.createGain();
    carrier.type = recipe.wave;
    carrier.frequency.value = (low + high) / 2;
    swing.frequency.value = 1 / recipe.duration;
    swingDepth.gain.value = (high - low) / 2;
    swing.connect(swingDepth).connect(carrier.frequency);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(recipe.level, start + ATTACK);
    carrier.connect(gain).connect(context.destination);
    carrier.start(start);
    swing.start(start);
    loops.set(sound, () => {
      loops.delete(sound);
      fadeOut(gain.gain);
      const end = context.currentTime + 2 * RELEASE;   // after the fade, so it ends without a click
      carrier.stop(end);
      swing.stop(end);
    });
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

  function record(sound, detail, t) {
    journal.push({ seq: ++entries, sound, detail, t, at: now() });
    if (journal.length > JOURNAL_SIZE) journal.shift();
  }

  function play({ sound, detail = {}, t }) {
    const recipe = recipes[sound];
    if (!recipe) return;
    makeRoomForAVoice();
    startVoice(recipe, detail);
    record(sound, detail, t);
  }

  function startLoop({ sound, t }) {
    const recipe = recipes[sound];
    if (!recipe?.loop || loops.has(sound)) return;
    startLoopVoice(sound, recipe);
    record(sound, {}, t);
  }

  const stopLoop = ({ sound }) => loops.get(sound)?.();
  const silence = () => { cutVoicesDownTo(0); [...loops.values()].forEach(stop => stop()); };

  const OPERATIONS = { [CueOp.PLAY]: play, [CueOp.START_LOOP]: startLoop, [CueOp.STOP_LOOP]: stopLoop, [CueOp.SILENCE]: silence };

  function perform(cue) {
    if (state !== State.RUNNING) return;
    OPERATIONS[cue.op]?.(cue);
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
