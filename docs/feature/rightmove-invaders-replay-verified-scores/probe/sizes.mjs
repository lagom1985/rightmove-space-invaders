// PROBE ONLY: (1) Math.hypot vs squared distances give the same game; (2) log sizes, naive JSON vs a compact string,
// for the greedy bot and for a bot that decides at most every 100 ms (12 steps, about a fast human's pace).
import { gzipSync } from 'node:zlib';
import { playBot } from './replay.js';

let copies = 0;
const fresh = () => import(`./src/game/game.js?copy=${++copies}`);

// Compact: each change is the step delta in base 36 followed by one letter A-H for the held bits (0-7).
const compact = log => {
  let last = 0, out = '';
  for (const [step, bits] of log) { out += (step - last).toString(36) + 'ABCDEFGH'[bits]; last = step; }
  return out;
};

for (const seed of [1, 2, 4]) {
  globalThis.PROBE_HYPOT = true;
  const a = playBot(await fresh(), seed);
  globalThis.PROBE_HYPOT = false;
  const b = playBot(await fresh(), seed);
  console.log(JSON.stringify({ seed, hypotVsSquaredSameGame: JSON.stringify(a.checks) === JSON.stringify(b.checks), score: b.score }));
}

for (const decideEvery of [1, 6, 12]) {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const p = playBot(await fresh(), seed, { decideEvery });
    const c = compact(p.log);
    const minutes = p.steps / 7200;
    console.log(JSON.stringify({ decideEvery, seed, minutes: +minutes.toFixed(1), score: p.score, changes: p.log.length,
      changesPerSecond: +(p.log.length / (p.steps / 120)).toFixed(1), jsonBytes: JSON.stringify(p.log).length,
      compactBytes: c.length, compactBytesPerMinute: Math.round(c.length / minutes), gzipCompact: gzipSync(c).length }));
  }
}
