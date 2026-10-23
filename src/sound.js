// Sound director (DDD-4): the sound policy. It holds no reference to the synth.
//   createSoundDirector({ sound, music }) -> { handle(event) -> Cue[] }
//   event: { type: GameEvent.*, t: simulation seconds, ...detail }   (src/events.js)
//   Cue:   { op: CueOp.*, sound?: Sound.*, detail?: { value? | note? }, t: event.t }
// Cues come out in the order the events go in. main.js passes each cue to synth.perform(cue).
// The policy table is in docs/feature/rightmove-invaders-sound/feature-delta.md (DESIGN).
import { CueOp, GameEvent, Sound } from './events.js';

const play = (sound, detail) => ({ op: CueOp.PLAY, sound, detail });

// What each event asks for while the sound is on. The rest of the policy table arrives with the later slices.
const SOUNDS = {
  [GameEvent.SHOT_FIRED]: () => play(Sound.SHOT),
  [GameEvent.HURDLE_HIT]: ({ value }) => play(Sound.HURDLE_HIT, { value }),
};

export function createSoundDirector({ sound }) {
  function handle(event) {
    const cue = sound && SOUNDS[event.type]?.(event);
    return cue ? [{ ...cue, t: event.t }] : [];
  }

  return { handle };
}
