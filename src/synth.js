// Web Audio adapter (ADR-002): resource operations only; the decisions are the director's.
//   createSynth({
//     recipes,                        // optional: defaults to the sound recipes in theme.js
//     createContext,                  // () => new AudioContext()  (webkitAudioContext fallback); may throw
//     now,                            // () => performance.now()   (journal 'at')
//     setInterval, clearInterval,     // timers for the music look-ahead scheduler (needed once music starts)
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
//   While state is 'locked' or 'unavailable', perform() changes nothing and writes no journal entry. While it is
//   'suspended' the context still holds what it was playing, so the stop operations (stopLoop, stopMusic,
//   silence) act as they do when running: the director has forgotten those sounds and would never stop them,
//   and they would be heard again on resume. The start and play operations do nothing while suspended.
//   The look-ahead scheduler never schedules a note before the audio clock's current time, so fast-forwarded
//   timers (Playwright's fake clock) cannot build a backlog: the audio clock runs on real time.
//   A recipe's `wave` is an oscillator type, or 'noise' (white noise through a low-pass filter; `from` and `to`
//   are then the filter's cut-off pitches). One noise buffer is shared by every noise voice.
//   A recipe with `parts` is a jingle: one voice plays each part in turn, every part with its own attack and release.
//   A recipe with `loop: true` is played by `startLoop` (the Dream Home siren): an oscillator whose pitch swings
//   between `from` and `to` once every `duration` seconds, until `stopLoop` or `silence`. A loop is not an effect
//   voice: it is not counted in `voices` or `peakVoices` and the voice cap never cuts it; starting one writes a
//   journal entry (detail {}), and starting a loop that is already running does nothing.
//   `startMusic` plays the tune in theme.js (MUSIC) round and round on its own bus, `stopMusic` stops it; both do
//   nothing when already so, and neither writes a journal entry. Music voices are not effect voices: they are not
//   counted in `voices` or `peakVoices`. Every effect plays on the effects bus, the music on a bus 6 dB or more
//   below it (BUS_LEVELS in theme.js). `silence` stops every voice, loop and the music at once (`voices` is 0 and
//   `music` is 'stopped' when perform returns); cues for sounds and operations without a recipe are skipped.
import { CueOp } from './events.js';
import { SOUND_RECIPES, MUSIC, BUS_LEVELS, partsOf } from './theme.js';

const State = Object.freeze({ LOCKED: 'locked', RUNNING: 'running', SUSPENDED: 'suspended', UNAVAILABLE: 'unavailable' });
const VOICE_CAP = 8, JOURNAL_SIZE = 100;
const STOPS = new Set([CueOp.STOP_LOOP, CueOp.STOP_MUSIC, CueOp.SILENCE]);   // these reach a suspended context too (see the header)
const NOISE = 'noise', NOISE_SECONDS = 1;
const ATTACK = 0.004, RELEASE = 0.03;   // seconds: short ramps at both ends of a voice, so it never clicks
const MUSIC_TICK_MS = 25, MUSIC_LOOK_AHEAD = 0.1;   // the music timer wakes this often and schedules this far ahead (seconds)

// A recipe's pitch is a number, or a function of the cue's detail.
const resolvePitch = (pitch, detail) => (typeof pitch === 'function' ? pitch(detail) : pitch);

// The tune as one recipe per eighth-note (a rest is null).
const TUNE = MUSIC.notes.map(pitch => pitch && { wave: MUSIC.wave, level: MUSIC.level, from: pitch, to: pitch, duration: MUSIC.noteSeconds });

export function createSynth({ recipes = SOUND_RECIPES, createContext, now, setInterval, clearInterval } = {}) {
  let state = State.LOCKED, context = null, buses = null, noise = null, lastSeq = 0, peakVoices = 0;
  const voices = [];
  const music = { playing: false, timer: null, voices: [], index: 0, nextAt: 0 };
  const loops = new Map();   // sound -> a function that stops that loop
  const journal = [];

  // The context settles asynchronously after resume(); a browser may also suspend it later.
  function followContext() { state = context.state === 'running' ? State.RUNNING : State.SUSPENDED; }

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
      buses = { effects: makeBus(BUS_LEVELS.effects), music: makeBus(BUS_LEVELS.music) };
    } catch {
      state = State.UNAVAILABLE;
      return;
    }
    context.addEventListener('statechange', followContext);
    resume();
  }

  function makeBus(level) {
    const bus = context.createGain();
    bus.gain.value = level;
    bus.connect(context.destination);
    return bus;
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
    param.setValueAtTime(resolvePitch(part.from, detail), start);
    param.exponentialRampToValueAtTime(resolvePitch(part.to, detail), end);
  }

  // A sound source, the node its sound comes out of, and the parameter that sets its pitch.
  function makeSource(recipe) {
    if (recipe.wave === NOISE) {
      const source = context.createBufferSource(), filter = context.createBiquadFilter();
      source.buffer = noiseBuffer();
      source.loop = true;
      filter.type = 'lowpass';
      source.connect(filter);
      return { source, output: filter, pitchParam: filter.frequency };
    }
    const source = context.createOscillator();
    source.type = recipe.wave;
    return { source, output: source, pitchParam: source.frequency };
  }

  // Lays out the recipe's parts one after the other, each with its own short attack and release so it never
  // clicks. Returns the time the last part ends.
  function schedule(recipe, detail, pitchParam, gainParam, start) {
    let from = start;
    for (const part of partsOf(recipe)) {
      const to = from + part.duration;
      glide(pitchParam, part, detail, from, to);
      gainParam.setValueAtTime(0, from);
      gainParam.linearRampToValueAtTime(recipe.level, from + ATTACK);
      gainParam.setValueAtTime(recipe.level, to - RELEASE);
      gainParam.linearRampToValueAtTime(0, to);
      from = to;
    }
    return from;
  }

  // One voice of a recipe, laid out from `start` and sent to `bus`.
  function launch(recipe, detail, start, bus) {
    const { source, output, pitchParam } = makeSource(recipe), gain = context.createGain();
    const end = schedule(recipe, detail, pitchParam, gain.gain, start);
    output.connect(gain).connect(bus);
    source.start(start);
    source.stop(end);
    return { source, fadeOut: () => fadeOut(gain.gain) };
  }

  // Keeps `voice` in `list` for as long as it sounds.
  function track(list, voice) {
    voice.source.onended = () => forget(list, voice);
    list.push(voice);
  }

  function startVoice(recipe, detail) {
    track(voices, launch(recipe, detail, context.currentTime, buses.effects));
    peakVoices = Math.max(peakVoices, voices.length);
  }

  // A siren: a carrier whose pitch a slow oscillator swings up and down, running until it is stopped.
  function startLoopVoice(sound, recipe) {
    const start = context.currentTime, low = resolvePitch(recipe.from, {}), high = resolvePitch(recipe.to, {});
    const carrier = context.createOscillator(), swing = context.createOscillator();
    const swingDepth = context.createGain(), gain = context.createGain();
    carrier.type = recipe.wave;
    carrier.frequency.value = (low + high) / 2;
    swing.frequency.value = 1 / recipe.duration;
    swingDepth.gain.value = (high - low) / 2;
    swing.connect(swingDepth).connect(carrier.frequency);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(recipe.level, start + ATTACK);
    carrier.connect(gain).connect(buses.effects);
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

  function fadeOut(gainParam) {
    gainParam.cancelScheduledValues(context.currentTime);
    gainParam.setTargetAtTime(0, context.currentTime, RELEASE / 3);
  }

  function forget(list, voice) {
    const at = list.indexOf(voice);
    if (at >= 0) list.splice(at, 1);
  }

  // The oldest voices go first.
  function cutVoicesDownTo(count) {
    while (voices.length > count) voices.shift().fadeOut();
  }

  const makeRoomForAVoice = () => cutVoicesDownTo(VOICE_CAP - 1);

  // A timer wakes often and lays out the notes that fall in the next fraction of a second on the audio clock:
  // a late timer costs nothing, and a fast-forwarded one cannot pile notes up, because nothing is ever scheduled
  // before the clock's current time.
  function playNote(note, start) {
    if (note) track(music.voices, launch(note, {}, start, buses.music));
  }

  function scheduleMusic() {
    const clock = context.currentTime;
    music.nextAt = Math.max(music.nextAt, clock);   // behind the clock: carry on from now
    while (music.nextAt < clock + MUSIC_LOOK_AHEAD) {
      playNote(TUNE[music.index], music.nextAt);
      music.nextAt += MUSIC.step;
      music.index = (music.index + 1) % TUNE.length;
    }
  }

  function startMusic() {
    if (music.playing) return;
    Object.assign(music, { playing: true, index: 0, nextAt: 0 });
    scheduleMusic();   // the first notes at once, not after the first tick
    music.timer = setInterval(scheduleMusic, MUSIC_TICK_MS);
  }

  function stopMusic() {
    if (!music.playing) return;
    clearInterval(music.timer);
    music.playing = false;
    music.voices.splice(0).forEach(voice => voice.fadeOut());
  }

  function record(sound, detail, t) {
    journal.push({ seq: ++lastSeq, sound, detail, t, at: now() });
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

  function silence() {
    cutVoicesDownTo(0);
    [...loops.values()].forEach(stop => stop());   // a copy: each stop takes its loop out of `loops`
    stopMusic();
  }

  const operations = {
    [CueOp.PLAY]: play, [CueOp.START_LOOP]: startLoop, [CueOp.STOP_LOOP]: stopLoop,
    [CueOp.START_MUSIC]: startMusic, [CueOp.STOP_MUSIC]: stopMusic, [CueOp.SILENCE]: silence,
  };

  const mayPerform = op => state === State.RUNNING || (state === State.SUSPENDED && STOPS.has(op));

  function perform(cue) {
    if (mayPerform(cue.op)) operations[cue.op]?.(cue);
  }

  const frozenCopy = entry => Object.freeze({ ...entry, detail: Object.freeze({ ...entry.detail }) });
  const copyOfJournal = () => Object.freeze(journal.map(frozenCopy));

  const diagnostics = Object.freeze({
    get state() { return state; },
    get journal() { return copyOfJournal(); },
    get music() { return music.playing ? 'playing' : 'stopped'; },
    get voices() { return voices.length; },
    get peakVoices() { return peakVoices; },
  });

  return { unlock, perform, diagnostics };
}
