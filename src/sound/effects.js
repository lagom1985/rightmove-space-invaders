// The effect voices of the synth (src/sound/synth.js), all on the effects bus.
//   createEffects({ builder, bus }) -> {
//     play(recipe, detail),            // starts a voice; at most VOICE_CAP sound at once, the oldest cut first
//     startLoop(sound, recipe),        // a siren, running until stopLoop or stopLoops; isLooping(sound) says if it is
//     stopLoop(sound), stopLoops(), stopVoices(),
//     voices, peakVoices,              // effect voices sounding now, and the highest ever
//   }
// A loop is not an effect voice: it is not counted in `voices` or `peakVoices` and the cap never cuts it.
// `builder` is a voice builder (voices.js).
import { track } from './voices.js';

const VOICE_CAP = 8;

export function createEffects({ builder, bus }) {
  const voices = [];
  const loops = new Map();   // sound -> a function that stops that loop
  let peakVoices = 0;

  // The oldest voices go first.
  function cutVoicesDownTo(count) {
    while (voices.length > count) voices.shift().fadeOut();
  }

  function play(recipe, detail) {
    cutVoicesDownTo(VOICE_CAP - 1);
    track(voices, builder.launch(recipe, detail, builder.currentTime(), bus));
    peakVoices = Math.max(peakVoices, voices.length);
  }

  function startLoop(sound, recipe) {
    const stopSiren = builder.startSiren(recipe, bus);
    loops.set(sound, () => {
      loops.delete(sound);
      stopSiren();
    });
  }

  const isLooping = sound => loops.has(sound);
  const stopLoop = sound => loops.get(sound)?.();
  const stopLoops = () => [...loops.values()].forEach(stop => stop());   // a copy: each stop takes its loop out of `loops`
  const stopVoices = () => cutVoicesDownTo(0);

  return {
    play, startLoop, isLooping, stopLoop, stopLoops, stopVoices,
    get voices() { return voices.length; },
    get peakVoices() { return peakVoices; },
  };
}
