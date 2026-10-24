// Voice building for the synth (src/sound/synth.js): turns a recipe into nodes on an audio context.
//   createVoiceBuilder(context) -> {
//     currentTime(),                          // the context's clock (s)
//     makeBus(level),                         // a gain node wired to the speakers
//     launch(recipe, detail, start, bus),     // one voice, laid out from `start` -> { source, fadeOut() }
//     startSiren(recipe, bus),                // a looping voice, running until the returned function is called
//   }
// plus track(list, voice), which keeps a voice in a list for as long as it sounds.
import { partsOf } from './recipes.js';

const NOISE = 'noise', NOISE_SECONDS = 1;
const ATTACK = 0.004, RELEASE = 0.03;   // seconds: short ramps at both ends of a voice, so it never clicks

// A recipe's pitch is a number, or a function of the cue's detail.
const resolvePitch = (pitch, detail) => (typeof pitch === 'function' ? pitch(detail) : pitch);

// A second of white noise from a private linear congruential generator, so it never disturbs Math.random.
function whiteNoise(context) {
  const buffer = context.createBuffer(1, Math.round(context.sampleRate * NOISE_SECONDS), context.sampleRate);
  const samples = buffer.getChannelData(0);
  let seed = 1;
  for (let i = 0; i < samples.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    samples[i] = seed / 2147483648 - 1;
  }
  return buffer;
}

// The pitch a voice starts at, gliding to where it ends: the oscillator's frequency or the noise filter's cut-off.
function glide(param, part, detail, start, end) {
  param.setValueAtTime(resolvePitch(part.from, detail), start);
  param.exponentialRampToValueAtTime(resolvePitch(part.to, detail), end);
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

// Keeps `voice` in `list` for as long as it sounds.
export function track(list, voice) {
  voice.source.onended = () => forget(list, voice);
  list.push(voice);
}

function forget(list, voice) {
  const at = list.indexOf(voice);
  if (at >= 0) list.splice(at, 1);
}

export function createVoiceBuilder(context) {
  let noise = null;   // one buffer, shared by every noise voice

  // A sound source, the node its sound comes out of, and the parameter that sets its pitch.
  function makeSource(recipe) {
    if (recipe.wave === NOISE) {
      const source = context.createBufferSource(), filter = context.createBiquadFilter();
      noise ??= whiteNoise(context);
      source.buffer = noise;
      source.loop = true;
      filter.type = 'lowpass';
      source.connect(filter);
      return { source, output: filter, pitchParam: filter.frequency };
    }
    const source = context.createOscillator();
    source.type = recipe.wave;
    return { source, output: source, pitchParam: source.frequency };
  }

  function fadeOut(gainParam) {
    gainParam.cancelScheduledValues(context.currentTime);
    gainParam.setTargetAtTime(0, context.currentTime, RELEASE / 3);
  }

  function makeBus(level) {
    const bus = context.createGain();
    bus.gain.value = level;
    bus.connect(context.destination);
    return bus;
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

  // A siren: a carrier whose pitch a slow oscillator swings up and down, running until it is stopped.
  function startSiren(recipe, bus) {
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
    carrier.connect(gain).connect(bus);
    carrier.start(start);
    swing.start(start);
    return function stopSiren() {
      fadeOut(gain.gain);
      const end = context.currentTime + 2 * RELEASE;   // after the fade, so it ends without a click
      carrier.stop(end);
      swing.stop(end);
    };
  }

  return { currentTime: () => context.currentTime, makeBus, launch, startSiren };
}
