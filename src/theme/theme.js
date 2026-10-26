// Everything that makes this "Rightmove" rather than "Space Invaders" lives here as plain data.
// Brand colours are approximations: replace them with values from the official brand kit.

// `outline` is drawn round the names in the title's hurdle legend, so they keep their contrast whatever the backdrop.
export const COLORS = {
  green: '#00deb6', text: '#ffffff', dim: '#a9a9c8', danger: '#ff5a5f',
  brick: '#d9774b', window: '#ffe9a8', door: '#8a4a33', dream: '#ff7eb6', outline: '#141420',
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

// Each rung's backdrop, in the ladder's order: a neighbourhood at its time of day, its look (the map and skyline drawn,
// src/view/backdrop.js) and its palette. Every palette colour stays at relative luminance 0.05 or less, so the hurdles
// and the houses keep 3:1 contrast against the backdrop and the HUD text 4.5:1 (spike findings).
export const NEIGHBOURHOODS = [
  { name: 'City centre at dawn', look: 'city', palette: {
    bg: '#262339', grid: '#2f2b47', block: '#2d2944', road: '#3a3557', water: '#2b3360', park: '#28343a',
    sky: '#322e4c', light: '#3f3a58', accent: '#47304a' } },
  { name: 'Terraced streets in the morning', look: 'terraces', palette: {
    bg: '#1f2a3a', grid: '#263447', block: '#253246', road: '#2e3e56', water: '#233e67', park: '#23392f',
    sky: '#2a3a50', light: '#2f3e55', accent: '#3a3a52' } },
  { name: 'Suburbs at midday', look: 'suburbs', palette: {
    bg: '#212f30', grid: '#293a3b', block: '#283839', road: '#2f4142', water: '#22405a', park: '#26402f',
    sky: '#2e4142', light: '#32403c', accent: '#2b4335' } },
  { name: 'Leafy avenue in the afternoon', look: 'leafy', palette: {
    bg: '#2b2b24', grid: '#35352b', block: '#33332a', road: '#3f3e32', water: '#2a3a4a', park: '#2c3b26',
    sky: '#38382d', light: '#423e2c', accent: '#3d3a26' } },
  { name: 'Countryside at sunset', look: 'country', palette: {
    bg: '#30232b', grid: '#3a2a33', block: '#382830', road: '#463039', water: '#2c2c48', park: '#2a3326',
    sky: '#3c2934', light: '#523636', accent: '#3a2e26' } },
  { name: 'Seaside at night', look: 'coast', palette: {
    bg: '#151a2b', grid: '#1b2134', block: '#1d2336', road: '#232b40', water: '#142a44', park: '#182a26',
    sky: '#1f2539', light: '#333c5a', accent: '#2a2a30' } },
];
export const neighbourhood = level => NEIGHBOURHOODS[Math.min(level, NEIGHBOURHOODS.length - 1)];

export const pounds = n => '£' + n.toLocaleString('en-GB');
