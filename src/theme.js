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
