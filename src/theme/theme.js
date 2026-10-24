import { Sound } from '../game/events.js';

// Everything that makes this "Rightmove" rather than "Space Invaders" lives here as plain data.
// Brand colours are approximations: replace them with values from the official brand kit.

export const COLORS = {
  bg: '#262637', grid: '#2d2d43', road: '#323250', river: '#2b3758',
  green: '#00deb6', text: '#ffffff', dim: '#a9a9c8', danger: '#ff5a5f',
  brick: '#d9774b', window: '#ffe9a8', door: '#8a4a33', dream: '#ff7eb6',
};

// One per formation row, top to bottom. Two animation frames each, 12 x 8 pixels.
export const HURDLES = [
  { name: 'Gazumper', value: 300, color: '#ff5a5f', frames: [
    ['...XXXXXX...', '...XXXXXX...', '.XXXXXXXXXX.', '..XXXXXXXX..', '..X..XX..X..', '..XXXXXXXX..', '.X.X....X.X.', 'X..........X'],
    ['...XXXXXX...', '...XXXXXX...', '.XXXXXXXXXX.', '..XXXXXXXX..', '..X..XX..X..', '..XXXXXXXX..', '..X.X..X.X..', '.X........X.']] },
  { name: 'Stamp Duty', value: 200, color: '#ffc94d', frames: [
    ['X.X.X.X.X.X.', 'XXXXXXXXXXXX', 'XXXXX...XXXX', 'XXXX.XXXXXXX', 'XXX.....XXXX', 'XXXX.XXXXXXX', 'XXX......XXX', '.X.X.X.X.X.X'],
    ['.X.X.X.X.X.X', 'XXXXXXXXXXXX', 'XXXXX...XXXX', 'XXXX.XXXXXXX', 'XXX.....XXXX', 'XXXX.XXXXXXX', 'XXX......XXX', 'X.X.X.X.X.X.']] },
  { name: 'Rate Rise', value: 150, color: '#ff8a3d', frames: [
    ['.....XX.....', '....XXXX....', '...X.XX.X...', '..XXXXXXXX..', '.XXXXXXXXXX.', '....XXXX....', '...XX..XX...', '..XX....XX..'],
    ['.....XX.....', '....XXXX....', '...X.XX.X...', '..XXXXXXXX..', '.XXXXXXXXXX.', '....XXXX....', '....XXXX....', '...X.XX.X...']] },
  { name: 'Broken Chain', value: 100, color: '#b9b9d0', frames: [
    ['.XXX....XXX.', 'X...X..X...X', 'X...XX.X...X', 'X...X.XX...X', '.XXX....XXX.', '..X......X..', '.X........X.', '............'],
    ['.XXX....XXX.', 'X...X..X...X', 'X...X.XX...X', 'X...XX.X...X', '.XXX....XXX.', '..X......X..', '..X......X..', '............']] },
  { name: 'Damp', value: 50, color: '#c9a97a', frames: [
    ['...XXXXXX...', '.XXXXXXXXXX.', 'XXX..XX..XXX', 'XXXXXXXXXXXX', 'XXXXXXXXXXXX', '.XX.XX.XX.XX', 'X..X..X..X..', '............'],
    ['...XXXXXX...', '.XXXXXXXXXX.', 'XXX..XX..XXX', 'XXXXXXXXXXXX', 'XXXXXXXXXXXX', 'XX.XX.XX.XX.', '.X..X..X..X.', '..........X.']] },
];

// The player: a map pin with a house cut out of it.
export const PIN_ART = ['....XXXXX....', '..XXXXXXXXX..', '.XXXXX.XXXXX.', '.XXXX...XXXX.', 'XXXX.....XXXX', 'XXXXX...XXXXX',
  'XXXXX.X.XXXXX', '.XXXX.X.XXXX.', '..XXXXXXXXX..', '....XXXXX....', '......X......'];

// The bonus "ship": a house with a heart-shaped window.
export const DREAM_ART = ['..........XX....', '......XX..XX....', '.....XXXX.XX....', '....XXXXXXXX....', '...XXXXXXXXXX...', '..XXXXXXXXXXXX..',
  '.XXXXXXXXXXXXXX.', '..XX.X.XXXXXXX..', '..X.....XX..XX..', '..XX...XXX..XX..', '..XXX.XXXX..XX..', '..XXXXXXXXXXXX..'];
export const DREAM_BONUSES = [500, 1000, 1500, 3000];

// Levels: each cleared wave moves the player up the property ladder.
export const LADDER = ['Studio flat', 'Terrace', 'Semi-detached', 'Detached', 'Country pile', 'Forever home'];
export const ladderName = level => LADDER[Math.min(level, LADDER.length - 1)];

export const pounds = n => '£' + n.toLocaleString('en-GB');

// A hurdle hit is a "pop" whose start pitch rises with the hurdle's value.
export const hitPitch = value => Math.round(300 * 2 ** (value / 300));

// The marching beat: four descending bass notes (A2, G#2, G2, F#2), picked by the cue's detail.note (0 to 3).
export const MARCH_NOTES = [110, 103.83, 98, 92.5];
const marchPitch = ({ note }) => MARCH_NOTES[note];

// The parts a recipe plays in turn: a jingle's own, or the recipe itself as its only part.
export const partsOf = recipe => recipe.parts ?? [recipe];

// The mix: a voice's peak gain is its recipe's level times the level of the bus it plays on. The effects are
// the foreground; the music bus keeps the tune at least 6 dB (a factor of two) under the quietest effect.
export const BUS_LEVELS = { effects: 1, music: 0.25 };

// Background music (US-06): one chiptune loop of 16 bars in A minor, a key that fits the beat's falling
// A, G#, G, F#. Each bar is a chord and eight eighth-notes ('.' is a rest) that pick the chord's tones by
// position, low to high. The notes stay above the beat's bass so the two never fight.
const midiHz = note => 440 * 2 ** ((note - 69) / 12);
const CHORDS = {
  Am: [69, 72, 76, 81], F: [65, 69, 72, 77], C: [72, 76, 79, 84],
  G: [67, 71, 74, 79], Dm: [74, 77, 81, 86], E: [64, 68, 71, 76],
};
const BARS = [
  ['Am', '01232123'], ['F', '01232123'], ['C', '01232123'], ['G', '23.32.10'],
  ['Am', '01232123'], ['F', '01232123'], ['G', '23232101'], ['E', '3.2.3.2.'],
  ['Dm', '01232123'], ['Am', '01232123'], ['F', '01232123'], ['E', '01232123'],
  ['Dm', '3.2.1.0.'], ['Am', '3.2.1.0.'], ['E', '23232323'], ['E', '3.2.1.0.'],
];
// `notes` are the loop's eighth-notes in order, each a pitch in Hz or null for a rest; every one starts `step`
// seconds after the one before and sounds for `noteSeconds`, so the tune is crisp and the loop runs on for ever.
export const MUSIC = {
  wave: 'square', level: 0.12, step: 0.2, noteSeconds: 0.17,
  notes: BARS.flatMap(([chord, pattern]) => [...pattern].map(tone => (tone === '.' ? null : midiHz(CHORDS[chord][tone])))),
};

// Sounds, as recipes the synth plays (src/sound/synth.js): one voice each, pitches in Hz, times in seconds.
// `from` and `to` may be a function of the cue's detail (the hit pitch depends on the hurdle's value).
// `wave: 'noise'` is filtered noise: `from` and `to` are then the filter's cut-off, and `level` is the gain
// after the filter, so it runs above 1 to make up for what the filter takes out.
// A jingle has `parts` instead of `from` / `to` / `duration`: the same voice plays each part in turn.
// `loop: true` is a sound that runs until it is stopped: its pitch then swings between `from` and `to`,
// once every `duration` seconds.
export const SOUND_RECIPES = {
  [Sound.SHOT]: { wave: 'square', from: 440, to: 1320, duration: 0.12, level: 0.12 },
  [Sound.HURDLE_HIT]: { wave: 'triangle', from: ({ value }) => hitPitch(value), to: 90, duration: 0.18, level: 0.3 },
  [Sound.MARCH]: { wave: 'square', from: marchPitch, to: marchPitch, duration: 0.08, level: 0.18 },
  // A shot or bolt into a house: a dull, short crunch of low-passed noise.
  [Sound.SHIELD_HIT]: { wave: 'noise', from: 1100, to: 140, duration: 0.09, level: 1.3 },
  // A shot meeting a bolt: a small bright ping, far above everything else.
  [Sound.BOLT_STOPPED]: { wave: 'sine', from: 2600, to: 2100, duration: 0.07, level: 0.1 },
  // Losing a home: an explosion whose noise falls from a bright crash to a rumble over about a second.
  [Sound.HOME_LOST]: { wave: 'noise', from: 2400, to: 70, duration: 1, level: 0.9 },
  // Starting a game: "ding-dong", a high note then a lower one that rings on.
  [Sound.DOORBELL]: { wave: 'sine', level: 0.28, parts: [
    { from: 659.25, to: 659.25, duration: 0.3 },     // E5
    { from: 523.25, to: 523.25, duration: 0.6 },     // C5
  ] },
  // The Dream Home on screen: a wailing siren, warbling twice a second until it is stopped.
  [Sound.SIREN]: { wave: 'square', from: 620, to: 900, duration: 0.5, level: 0.07, loop: true },
  // Saving the Dream Home: a short "ka" and a bright ringing "ching".
  [Sound.KA_CHING]: { wave: 'square', level: 0.1, parts: [
    { from: 1046.5, to: 1046.5, duration: 0.07 },    // C6
    { from: 2093, to: 2093, duration: 0.5 },         // C7
  ] },
  // Clearing a wave: a rising run that lands on a held top note, well inside the banner's 2.4 s.
  [Sound.FANFARE]: { wave: 'square', level: 0.14, parts: [
    { from: 392, to: 392, duration: 0.16 },          // G4
    { from: 523.25, to: 523.25, duration: 0.16 },    // C5
    { from: 659.25, to: 659.25, duration: 0.16 },    // E5
    { from: 783.99, to: 783.99, duration: 0.16 },    // G5
    { from: 1046.5, to: 1046.5, duration: 0.9 },     // C6
  ] },
  // Losing the game: a falling tune that sinks away on its last note.
  [Sound.GAME_OVER]: { wave: 'square', level: 0.14, parts: [
    { from: 392, to: 392, duration: 0.25 },          // G4
    { from: 329.63, to: 329.63, duration: 0.25 },    // E4
    { from: 261.63, to: 261.63, duration: 0.25 },    // C4
    { from: 196, to: 98, duration: 0.9 },            // G3, sliding down
  ] },
};
