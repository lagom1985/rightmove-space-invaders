import { createGame, keysHolding } from './game.js';
import { STEP } from './config.js';
import { readRecord, MAX_GAME_STEPS } from './record.js';

// The replay (ADR-013, DESIGN DDD-R9): a fresh game with the session's seed and no particles, Enter pressed on the
// title, then one fixed step per recorded step with that step's held controls, stopping at game over, at record.steps or
// at MAX_GAME_STEPS, whichever comes first, so it is bounded for every caller (the user, 2026-10-27). Pure and
// synchronous; never throws on a record readRecord accepted. Shared by both sides of the wire (layering rule 5 lets the
// function import it), and the recorded-games check loads it into each browser.

// The keyboard for each of the eight sets of controls a step can hold, made once.
const KEYBOARDS = Object.freeze(Array.from({ length: 8 }, (_, held) => keysHolding(held)));

// { seed: 32 lowercase hex, record: the raw { rules, steps, keys }, read through readRecord } -> { over, steps, deposit }
export function replay({ seed, record }) {
  const read = readRecord(record);
  if (!read) throw new Error('Not a record: replay plays only a record readRecord accepts');
  const game = createGame({ newSeed: () => seed, particles: false });
  game.handlePresses(new Set(['Enter']));
  game.takeEvents();
  const last = Math.min(read.steps, MAX_GAME_STEPS);
  let steps = 0, next = 0, held = 0;
  while (steps < last && game.g.state !== 'over') {
    if (next < read.changes.length && read.changes[next][0] === steps) held = read.changes[next++][1];
    game.update(STEP, KEYBOARDS[held]);
    game.takeEvents();
    steps++;
  }
  return { over: game.g.state === 'over', steps, deposit: game.g.score };
}
