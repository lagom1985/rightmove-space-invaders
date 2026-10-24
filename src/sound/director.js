// Sound director (DDD-4): the sound policy. It holds no reference to the synth.
//   createSoundDirector({ sound, music }) -> { handle(event) -> Cue[] }
//   event: { type: GameEvent.*, t: simulation seconds, ...detail }   (src/game/events.js)
//   Cue:   { op: CueOp.*, sound?: Sound.*, detail?: { value? | note? }, t: event.t }
// The director learns the settings from `soundToggled { on }` and `musicToggled { on }`: switching the sound
// off yields a `silence` cue, and while it is off no event yields anything audible.
// Audible = sound on, a game in progress (started, not over) and not paused. Restore = what a pause or a mute
// took away, started again: the music if it is on, then the Dream Home siren if the Dream Home is on screen.
// Cues come out in the order the events go in. main.js passes each cue to synth.perform(cue).
// The policy table is in docs/feature/rightmove-invaders-sound/feature-delta.md (DESIGN).
import { CueOp, GameEvent, Sound } from '../game/events.js';

const THUD_GAP = 0.05;     // seconds of game time between two house thuds (DDD-7)
const TOLERANCE = 1e-6;    // seconds: a gap this close to the limit counts as reached, so no float flakiness
const MARCH_CYCLE = 4;     // the beat cycles through four notes

const play = (sound, detail) => ({ op: CueOp.PLAY, sound, detail });
const SILENCE = { op: CueOp.SILENCE };
const START_SIREN = { op: CueOp.START_LOOP, sound: Sound.SIREN };
const STOP_SIREN = { op: CueOp.STOP_LOOP, sound: Sound.SIREN };

const audible = state => state.sound && state.inGame && !state.paused;
const whenAudible = (state, ...cues) => (audible(state) ? cues : []);
const oneShot = sound => state => whenAudible(state, play(sound));

// ---- MUSIC: every row that starts or stops the tune lives in this block. Dropping music = delete the block, ----
// ---- the two `startMusic` calls (gameStarted, restore) and the `...MUSIC_ROWS` line in ROWS.               ----
const startMusic = state => (state.music ? [{ op: CueOp.START_MUSIC }] : []);

const MUSIC_ROWS = {
  [GameEvent.MUSIC_TOGGLED]: (state, { on }) => {
    state.music = on;
    if (!on) return [{ op: CueOp.STOP_MUSIC }];
    return whenAudible(state, ...startMusic(state));
  },
};
// ---- end of MUSIC block ----

function restore(state) {
  const siren = state.dream ? [START_SIREN] : [];
  return [...startMusic(state), ...siren];
}

const beforeAnyGame = { inGame: false, paused: false, dream: false, marchIndex: 0, lastThud: null };
const startOfGame = { ...beforeAnyGame, inGame: true };

function thudAllowed(state, t) {
  return state.lastThud === null || t - state.lastThud >= THUD_GAP - TOLERANCE;
}

function dreamLeft(state) {   // the Dream Home leaves the screen: the siren stops, whether or not it was heard
  state.dream = false;
  return [STOP_SIREN];
}

// What each event asks for. A row may change the policy state, then returns the cues (without their time).
const ROWS = {
  [GameEvent.GAME_STARTED]: state => {
    Object.assign(state, startOfGame);
    if (!state.sound) return [];
    return [play(Sound.DOORBELL), ...startMusic(state)];
  },
  [GameEvent.SHOT_FIRED]: oneShot(Sound.SHOT),
  [GameEvent.HURDLE_HIT]: (state, { value }) => whenAudible(state, play(Sound.HURDLE_HIT, { value })),
  [GameEvent.BOLT_STOPPED]: oneShot(Sound.BOLT_STOPPED),
  [GameEvent.HOME_LOST]: oneShot(Sound.HOME_LOST),
  [GameEvent.SHIELD_HIT]: (state, { t }) => {
    if (!audible(state) || !thudAllowed(state, t)) return [];
    state.lastThud = t;
    return [play(Sound.SHIELD_HIT)];
  },
  [GameEvent.FORMATION_STEPPED]: state => {   // the beat counts while muted, so the notes stay in step
    if (!state.inGame || state.paused) return [];
    const note = state.marchIndex++ % MARCH_CYCLE;
    return whenAudible(state, play(Sound.MARCH, { note }));
  },
  [GameEvent.DREAM_APPEARED]: state => {
    state.dream = true;
    return whenAudible(state, START_SIREN);
  },
  [GameEvent.DREAM_GONE]: dreamLeft,
  [GameEvent.DREAM_SAVED]: state => [...dreamLeft(state), ...whenAudible(state, play(Sound.KA_CHING))],
  [GameEvent.WAVE_CLEARED]: state => [...dreamLeft(state), ...whenAudible(state, play(Sound.FANFARE))],
  [GameEvent.GAME_OVER]: state => {
    const wasAudible = audible(state);
    Object.assign(state, { inGame: false, dream: false });
    return [SILENCE, ...(wasAudible ? [play(Sound.GAME_OVER)] : [])];
  },
  [GameEvent.PAUSED]: state => {
    state.paused = true;
    return [SILENCE];
  },
  [GameEvent.RESUMED]: state => {
    state.paused = false;
    return state.sound && state.inGame ? restore(state) : [];
  },
  [GameEvent.SOUND_TOGGLED]: (state, { on }) => {
    state.sound = on;
    if (!on) return [SILENCE];
    return state.inGame && !state.paused ? restore(state) : [];   // unmuting while paused waits for `resumed`
  },
  ...MUSIC_ROWS,
};

export function createSoundDirector({ sound, music }) {
  const state = { sound, music, ...beforeAnyGame };

  function handle(event) {
    const cues = ROWS[event.type]?.(state, event) ?? [];
    return cues.map(cue => ({ ...cue, t: event.t }));
  }

  return { handle };
}
