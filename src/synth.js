// RED scaffold (created by DISTILL for rightmove-invaders-sound). Replaced in DELIVER.
//
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
export const __SCAFFOLD__ = true;

export function createSynth({ recipes, createContext, now, setInterval, clearInterval } = {}) {
  throw new Error('Not yet implemented -- RED scaffold');
}
