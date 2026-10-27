import { expect } from '@playwright/test';
import * as module from '../../../src/game/game.js';

// Every property run plays a game of its own: the module's exports (its sizes and pure rules) merged with a fresh game
// from createGame (DDD-R7), so the harnesses keep reading rules.g, rules.update and rules.IW. Its seeds are drawn as
// main.js draws them: 128 bits from Math.random, as 32 lowercase hex.
const randomWord = () => Math.floor(Math.random() * 0x1_0000_0000).toString(16).padStart(8, '0');
const newSeed = () => `${randomWord()}${randomWord()}${randomWord()}${randomWord()}`;

export async function loadFreshGame() {
  return { ...module, ...module.createGame({ newSeed }) };
}

// Plays with a deterministic Math.random, which picks each game's seed and so every draw it plays (enemy fire, the Dream
// Home, the houses' erosion), so a failing run can be replayed.
export async function withDeterministicChance(play) {
  const random = Math.random;
  let seed = 7;
  Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  try {
    return await play();
  } finally {
    Math.random = random;
  }
}

// Moments that random play seldom reaches, set up by writing the rules' state directly. Each one checks, as it
// goes, that the write took: a renamed field would otherwise be written to a new, unread one, and the property
// would silently stop reaching the banner, the respawn or game over.
const hasOwn = (target, key) => expect(Object.hasOwn(target, key), `the game state no longer has "${key}"`).toBe(true);

export const arrange = {
  // The deposit saved so far in the game in play: the next game over is decided on it (the high-score acceptance model,
  // tests/e2e/rightmove-invaders-leaderboard/acceptance/tier-b/signing-rules.js).
  deposit({ g }, amount) {
    hasOwn(g, 'score');
    g.score = amount;
    expect(g.score, 'the deposit did not take').toBe(amount);
  },
  // A bolt right on the pin: the next step loses a home.
  boltOnPin({ g, PW }) {
    const bolt = { x: g.player.x + PW / 2 - 1, y: g.player.y, vy: 240, color: '#ffffff' };
    g.bolts.push(bolt);
    expect(g.bolts.at(-1), 'the bolt is not in flight').toBe(bolt);
  },
  // One hurdle left, with the shot on it: the next step clears the wave.
  lastHurdleShot({ g, invaderX, invaderY, IW, IH }) {
    const alive = g.invaders.filter(hurdle => hurdle.alive);
    const last = alive.pop();
    alive.forEach(hurdle => { hurdle.alive = false; });
    hasOwn(g, 'shot');
    g.shot = { x: invaderX(last) + IW / 2, y: invaderY(last) + IH / 2 };
    expect(g.invaders.filter(hurdle => hurdle.alive), 'exactly one hurdle should be left').toEqual([last]);
    expect(g.shot, 'the shot is not on the last hurdle').toEqual({ x: invaderX(last) + IW / 2, y: invaderY(last) + IH / 2 });
  },
  // The formation about to step onto the pin's row: the next step ends the game.
  formationOnPin({ g }) {
    hasOwn(g.formation, 'y');
    hasOwn(g.formation, 'timer');
    g.formation.y = g.player.y;
    g.formation.timer = 0;
    expect(g.formation, 'the formation is not about to step onto the pin').toMatchObject({ y: g.player.y, timer: 0 });
  },
};
