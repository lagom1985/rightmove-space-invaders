// PROBE ONLY: replays the Node-recorded games in Chromium, Firefox and WebKit and compares every fingerprint with Node's.
// node browser-run.mjs <path to the worktree's node_modules/playwright-core or @playwright/test> games-3.json games-30.json
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(process.argv[2]);
const { chromium, firefox, webkit } = require('@playwright/test');
const files = process.argv.slice(3);
const games = files.flatMap(file => JSON.parse(readFileSync(join(here, file), 'utf8')));
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  const page = await browser.newPage();
  await page.route('http://probe.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>probe</title>' });
    return route.fulfill({ contentType: TYPES[extname(path)] ?? 'text/plain', body: readFileSync(join(here, path)) });
  });
  await page.goto('http://probe.test/');
  const results = await page.evaluate(async games => {
    const { replay } = await import('/replay.js');
    const out = [];
    let copies = 0;
    for (const game of games) {
      globalThis.PROBE_LIVES = game.lives;
      const m = await import(`/src/game/game.js?copy=${++copies}`);
      const t0 = performance.now();
      const r = replay(m, game.seed, game.log, game.steps, { particles: false });
      out.push({ seed: game.seed, ms: performance.now() - t0, score: r.score, steps: r.steps, over: r.over, checks: r.checks });
    }
    return out;
  }, games);
  for (const [i, r] of results.entries()) {
    const want = games[i];
    const firstDiff = want.checks.findIndex((check, k) => check !== r.checks[k]);
    console.log(JSON.stringify({ engine: name, seed: r.seed, lives: want.lives, score: r.score, nodeScore: want.score,
      steps: r.steps, over: r.over, identical: firstDiff < 0 && want.checks.length === r.checks.length,
      firstDiffAtCheck: firstDiff, ms: Math.round(r.ms) }));
  }
  await browser.close();
}
