// The music scheduler for the synth (src/sound/synth.js): plays the tune in recipes.js (MUSIC) round and round.
//   createMusic({ builder, bus, setInterval, clearInterval, guard }) -> { start(), stop(), playing }
// `builder` is a voice builder (voices.js), `bus` the bus the tune plays on, `guard(work)` wraps the timer's
// callback so a failure of the audio graph never escapes it.
import { MUSIC } from './recipes.js';
import { track } from './voices.js';

const TICK_MS = 25, LOOK_AHEAD = 0.1;   // the timer wakes this often and schedules this far ahead (seconds)

// The tune as one recipe per eighth-note (a rest is null).
const TUNE = MUSIC.notes.map(pitch => pitch && { wave: MUSIC.wave, level: MUSIC.level, from: pitch, to: pitch, duration: MUSIC.noteSeconds });

export function createMusic({ builder, bus, setInterval, clearInterval, guard }) {
  const voices = [];
  let playing = false, timer = null, index = 0, nextAt = 0;

  function playNote(note, start) {
    if (note) track(voices, builder.launch(note, {}, start, bus));
  }

  // A timer wakes often and lays out the notes that fall in the next fraction of a second on the audio clock:
  // a late timer costs nothing, and a fast-forwarded one cannot pile notes up, because nothing is ever scheduled
  // before the clock's current time.
  function scheduleNotes() {
    const clock = builder.currentTime();
    nextAt = Math.max(nextAt, clock);   // behind the clock: carry on from now
    while (nextAt < clock + LOOK_AHEAD) {
      playNote(TUNE[index], nextAt);
      nextAt += MUSIC.step;
      index = (index + 1) % TUNE.length;
    }
  }

  function start() {
    if (playing) return;
    playing = true; index = 0; nextAt = 0;
    scheduleNotes();   // the first notes at once, not after the first tick
    timer = setInterval(guard(scheduleNotes), TICK_MS);
  }

  function stop() {
    if (!playing) return;
    clearInterval(timer);
    playing = false;
    voices.splice(0).forEach(voice => voice.fadeOut());
  }

  return { start, stop, get playing() { return playing; } };
}
