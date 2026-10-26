// PROBE ONLY: how much does choosing the seed help a program? The same greedy bot plays N seeds; compare the best with
// the median, and the deposit per minute of game time.
import { playBot } from './replay.js';

let copies = 0;
const fresh = () => import(`./src/game/game.js?copy=${++copies}`);
const n = Number(process.argv[2] ?? 100);
const games = [];
for (let seed = 1000; seed < 1000 + n; seed++) {
  const p = playBot(await fresh(), seed);
  games.push({ seed, deposit: p.score, minutes: p.steps / 7200, level: p.level });
}
const by = key => [...games].sort((a, b) => a[key] - b[key]);
const q = (sorted, key, f) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))][key];
const deposits = by('deposit');
const perMinute = games.map(g => ({ ...g, rate: g.deposit / g.minutes })).sort((a, b) => a.rate - b.rate);
console.log(JSON.stringify({
  n,
  deposit: { min: deposits[0].deposit, p25: q(deposits, 'deposit', 0.25), median: q(deposits, 'deposit', 0.5), p75: q(deposits, 'deposit', 0.75), p90: q(deposits, 'deposit', 0.9), max: deposits.at(-1).deposit },
  bestOf10Expected: (() => { let s = 0; for (let i = 0; i < n; i += 10) s += Math.max(...games.slice(i, i + 10).map(g => g.deposit)); return Math.round(s / (n / 10)); })(),
  ratePerMinute: { min: Math.round(perMinute[0].rate), median: Math.round(q(perMinute, 'rate', 0.5)), max: Math.round(perMinute.at(-1).rate) },
  longest: games.reduce((a, b) => (b.minutes > a.minutes ? b : a)),
}));
