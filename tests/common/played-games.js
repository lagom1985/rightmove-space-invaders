import { createHash } from 'node:crypto';
import { createGame, PW, IW, DW } from '../../src/game/game.js';
import { STEP, W } from '../../src/game/config.js';
import { HURDLES } from '../../src/theme/theme.js';
import { GameEvent } from '../../src/game/events.js';
import { CONTROL, MAX_GAME_STEPS } from '../../src/game/record.js';

// Games played in Node on the real rules (ADR-013, rightmove-invaders-replay-verified-scores): one game per instance,
// made with createGame({ newSeed, particles: false }), and a scripted player that holds the three controls the rules
// read at each fixed step (left, right, fire). The record is the game's own, the one it hands its signing
// (initialsEntered, DDD-R8), so a server scenario signs exactly what a browser would send, and a recorder that drifts
// from the steps it played is caught here.
// Used by the acceptance harnesses (every deposit signed in a server scenario is a game really played), by the
// recorded-games corpus (tests/common/recorded-games.js) and, through it, by the preview smoke test (DEVOPS).
// The players read the game in play through the instance's g (DDD-R7) and its invaderX: g.player.x and .y, g.invaders
// (c, r, type, alive), g.bolts (x, y), g.shot, g.dream (x), g.score and g.state, plus the PW, IW and DW sizes the module
// exports. A rename there changes the games they play: a game worth a given deposit is still found (or the supply throws,
// naming the deposit), and the recorded games are re-recorded only with a rules version bump.

const { LEFT, RIGHT, FIRE } = CONTROL;
const NOTHING = 0;
const PAST_THE_GUARD_STEPS = 80;   // 0.67 s of game over: the entry takes typed presses only after 0.6 s (D11)
const SIGN_AS_BOT = Object.freeze([...'bot', 'Enter'].map(key => Object.freeze({ key })));
const TRIES = 600;                 // seeds tried for a game worth a given deposit, before giving up

// What the rules see of the keyboard at one step: which of the three controls are held.
const heldKeys = bits => Object.freeze({
  isDown: code => (code === 'ArrowLeft' && (bits & LEFT) !== 0) || (code === 'ArrowRight' && (bits & RIGHT) !== 0) ||
    (code === 'Space' && (bits & FIRE) !== 0),
});

// A seed (32 lowercase hex, as main.js makes them) named by a phrase, so every run plays the same games.
export const seedFor = phrase => createHash('sha256').update(phrase).digest('hex').slice(0, 32);

// The probe's greedy bot: under the nearest living hurdle (or the Dream Home), fire held, a step aside from a bolt
// about to land.
function greedyBits({ g, invaderX }) {
  const centre = g.player.x + PW / 2;
  let target = null, nearest = Infinity;
  for (const hurdle of g.invaders) {
    if (!hurdle.alive) continue;
    const x = invaderX(hurdle) + IW / 2, distance = Math.abs(x - centre);
    if (distance < nearest) { nearest = distance; target = x; }
  }
  if (g.dream && g.dream.x > 0 && g.dream.x < W) target = g.dream.x + DW / 2;
  const danger = g.bolts.find(bolt => bolt.y > g.player.y - 140 && bolt.y < g.player.y + 20 && Math.abs(bolt.x - centre) < PW);
  if (danger) return FIRE | (danger.x < centre ? RIGHT : LEFT);
  if (target !== null && Math.abs(target - centre) > 3) return FIRE | (target > centre ? RIGHT : LEFT);
  return FIRE;
}

// Players: (game, step) -> the controls held at that step.
export const players = Object.freeze({
  // Holds fire and never moves (the smoke test's scripted game, DEVOPS): short games, £1,450-£10,700.
  standStillFiring: () => () => FIRE,
  // The greedy bot, deciding every `decideEvery` steps (1: a program; 6: a fast human, D20).
  greedy: ({ decideEvery = 1 } = {}) => {
    let bits = NOTHING;
    return (game, step) => (step % decideEvery === 0 ? (bits = greedyBits(game)) : bits);
  },
  // Plays to exactly `target`: under the bottom hurdle of a column worth the most that still fits what is left, fire
  // once lined up, a step aside from a bolt about to land; once there, nothing until the hurdles win. A shot can still
  // miss its mark (the formation moves while it flies), so a seed that overshoots is simply not the game wanted.
  toDeposit: target => game => {
    const { g } = game;
    const left = target - g.score;
    if (left <= 0) return NOTHING;
    const centre = g.player.x + PW / 2;
    const danger = g.bolts.find(bolt => bolt.y > g.player.y - 140 && bolt.y < g.player.y + 20 && Math.abs(bolt.x - centre) < PW);
    if (danger) return danger.x < centre ? RIGHT : LEFT;
    const bottom = new Map();
    for (const hurdle of g.invaders) if (hurdle.alive && !(bottom.get(hurdle.c)?.r > hurdle.r)) bottom.set(hurdle.c, hurdle);
    const fits = [...bottom.values()].filter(hurdle => HURDLES[hurdle.type].value <= left);
    if (!fits.length) return NOTHING;
    const x = hurdle => game.invaderX(hurdle) + IW / 2;
    const mark = fits.reduce((a, b) => (HURDLES[b.type].value > HURDLES[a.type].value ||
      (HURDLES[b.type].value === HURDLES[a.type].value && Math.abs(x(b) - centre) < Math.abs(x(a) - centre)) ? b : a));
    const off = x(mark) - centre;
    if (Math.abs(off) <= 4) return g.shot ? NOTHING : FIRE;
    return off > 0 ? RIGHT : LEFT;
  },
});

// One game, from its start to its game over, then signed as BOT so the game hands over its record.
// -> { seed, record, deposit, steps }; record is null when the game asked no initials (no deposit, or above the ceiling).
export function playGame({ seed, player, maxSteps = MAX_GAME_STEPS }) {
  const game = createGame({ newSeed: () => seed, particles: false });
  game.tableAnswered({ scores: [], listedAt: 0 });   // an empty table: a deposit is asked for initials
  game.handlePresses(new Set(['Enter']));
  const started = game.takeEvents().find(event => event.type === GameEvent.GAME_STARTED);
  if (started?.seed !== seed) throw new Error(`the game started on seed ${started?.seed}, not on the one it was given (gameStarted carries { seed }, DDD-R6)`);
  let steps = 0;
  while (game.g.state !== 'over' && steps < maxSteps) {
    game.update(STEP, heldKeys(player(game, steps)));
    game.takeEvents();
    steps++;
  }
  if (game.g.state !== 'over') throw new Error(`no game over within ${maxSteps} steps`);
  const deposit = game.g.score;
  for (let i = 0; i < PAST_THE_GUARD_STEPS; i++) game.update(STEP, heldKeys(NOTHING));
  game.takeEvents();
  game.handlePresses(new Set(), SIGN_AS_BOT);
  const signed = game.takeEvents().find(event => event.type === GameEvent.INITIALS_ENTERED);
  if (!signed) return Object.freeze({ seed, record: null, deposit, steps });
  if (signed.record?.steps !== steps) {
    throw new Error(`the record says ${signed.record?.steps} steps, but the game took ${steps}: step k is the k-th update after the start, the game-over one included (DDD-R8)`);
  }
  return Object.freeze({ seed, record: signed.record, deposit, steps });
}

// Games worth exactly `deposit`, found by playing seeds in a fixed order with players.toDeposit. Kept per worker.
const found = new Map();   // deposit -> { tried, games }

// Yields the games found so far, then plays further seeds, until TRIES seeds have been played for this deposit.
function* gamesWorth(deposit) {
  const shelf = found.get(deposit) ?? { tried: 0, games: [] };
  found.set(deposit, shelf);
  for (let i = 0; i < shelf.games.length || shelf.tried < TRIES;) {
    if (i < shelf.games.length) { yield shelf.games[i++]; continue; }
    const game = playGame({ seed: seedFor(`a game worth £${deposit}, try ${shelf.tried++}`), player: players.toDeposit(deposit) });
    if (game.deposit === deposit && game.record) shelf.games.push(game);
  }
}

// A table's own supply of played games: each take() hands over a game it hasn't handed over before, so two signings
// never share a game (one game, one row, D7) unless a scenario means them to.
export function createGameSupply() {
  const handed = new Set();
  return {
    // -> a played game worth exactly `deposit` that `where(game)` accepts
    take(deposit, where = () => true) {
      for (const game of gamesWorth(deposit)) {
        if (handed.has(game.seed) || !where(game)) continue;
        handed.add(game.seed);
        return game;
      }
      throw new Error(`no game worth £${deposit} found in ${TRIES} seeds: pick a deposit a game can end on`);
    },
  };
}

// `count` short scripted games with different deposits, the same ones every run. Kept per worker.
let scripted = [], scriptedTried = 0;
export function scriptedGames(count) {
  const deposits = new Set(scripted.map(game => game.deposit));
  while (scripted.length < count && scriptedTried < TRIES) {
    const game = playGame({ seed: seedFor(`a scripted game, try ${scriptedTried++}`), player: players.standStillFiring() });
    if (!game.record || deposits.has(game.deposit)) continue;
    deposits.add(game.deposit);
    scripted = [...scripted, game];
  }
  if (scripted.length < count) throw new Error(`only ${scripted.length} scripted games with different deposits in ${TRIES} seeds`);
  return scripted.slice(0, count);
}
