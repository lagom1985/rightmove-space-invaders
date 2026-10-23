// RED scaffold (created by DISTILL for rightmove-invaders-sound). Replaced in DELIVER.
//
// Sound director (DDD-4): the sound policy. It holds no reference to the synth.
//   createSoundDirector({ sound, music }) -> { handle(event) -> Cue[] }
//   event: { type: GameEvent.*, t: simulation seconds, ...detail }   (src/events.js)
//   Cue:   { op: CueOp.*, sound?: Sound.*, detail?: { value? | note? }, t: event.t }
// Cues come out in the order the events go in. main.js passes each cue to synth.perform(cue).
// The policy table is in docs/feature/rightmove-invaders-sound/feature-delta.md (DESIGN).
export const __SCAFFOLD__ = true;

export function createSoundDirector({ sound, music }) {
  throw new Error('Not yet implemented -- RED scaffold');
}
