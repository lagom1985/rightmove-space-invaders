// PROBE ONLY: bot games recorded in Node, replayed in Node without particles; timings, log sizes, fingerprints.
// node node-run.mjs <lives> <seeds...>  -> writes games-<lives>.json next to this file
import { writeFileSync } from 'node:fs';
import { playBot, replay } from './replay.js';

let copies = 0;
const fresh = () => import(`./src/game/game.js?copy=${++copies}`);
const lives = Number(process.argv[2] ?? 3);
const seeds = process.argv.slice(3).map(Number);
globalThis.PROBE_LIVES = lives;

const games = [];
for (const seed of seeds) {
  const played = playBot(await fresh(), seed, { particles: true });
  const m = await fresh();
  const t0 = performance.now();
  const replayed = replay(m, seed, played.log, played.steps, { particles: false });
  const ms = performance.now() - t0;
  const m2 = await fresh();
  const t1 = performance.now();
  replay(m2, seed, played.log, played.steps, { particles: true });
  const msWithParticles = performance.now() - t1;
  const json = JSON.stringify(played.log);
  const same = JSON.stringify(played.checks) === JSON.stringify(replayed.checks);
  console.log(JSON.stringify({ seed, lives, steps: played.steps, minutes: +(played.steps / 120 / 60).toFixed(2), score: played.score,
    level: played.level, changes: played.log.length, logBytes: json.length, replayMs: +ms.toFixed(1),
    replayMsWithParticles: +msWithParticles.toFixed(1), stepsPerMs: +(played.steps / ms).toFixed(0), sameAsPlayed: same,
    replayScore: replayed.score, over: replayed.over }));
  games.push({ seed, lives, log: played.log, steps: played.steps, score: played.score, checks: played.checks });
}
writeFileSync(new URL(`./games-${lives}.json`, import.meta.url), JSON.stringify(games));
