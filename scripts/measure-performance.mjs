// K6 stress measurement: frame work with and without sound, in Chromium, Firefox and WebKit.
// Adapted from the spike's probe script (git show 6801c46:.spike/measure/measure.js) to the real game:
// the game itself is not instrumented; an init script times every requestAnimationFrame callback instead.
// "Without sound" removes Web Audio, so the synth takes its silent fallback while the rules and director still run.
// Usage: node scripts/measure-performance.mjs   (prints JSON; K6 target: sound adds <= 0.5 ms frame work,
// p95 in Chromium, mean in Firefox and WebKit, D11)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';

const PORT = Number(process.env.PORT) || 4181;
const PAGE_URL = `http://localhost:${PORT}/`;
const WINDOW_MS = Number(process.env.WINDOW_MS) || 12000;
const WARMUP_MS = 1500;

const timeFrames = () => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__frameWork = [];
  window.requestAnimationFrame = callback => raf(t => {
    const start = performance.now();
    try { callback(t); } finally { window.__frameWork.push(performance.now() - start); }
  });
};
const removeAudio = () => { delete window.AudioContext; delete window.webkitAudioContext; };

const stats = samples => {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const mean = sorted.reduce((sum, x) => sum + x, 0) / sorted.length;
  return { frames: sorted.length, mean: +mean.toFixed(3), p50: +at(0.5).toFixed(3), p95: +at(0.95).toFixed(3), max: +at(1).toFixed(3) };
};

// Stress scene: hold fire, sweep left and right, restart whenever the game ends.
async function stress(page, ms) {
  await page.keyboard.down('Space');
  const end = Date.now() + ms;
  for (let i = 0; Date.now() < end; i++) {
    const key = i % 2 ? 'ArrowLeft' : 'ArrowRight';
    await page.keyboard.down(key);
    await page.waitForTimeout(400);
    await page.keyboard.up(key);
    if (i % 8 === 7) await page.keyboard.press('Enter');
  }
  await page.keyboard.up('Space');
}

async function run(type, withSound) {
  const browser = await type.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(timeFrames);
  if (!withSound) await page.addInitScript(removeAudio);
  await page.goto(PAGE_URL);
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await stress(page, WARMUP_MS);
  await page.evaluate(() => { window.__frameWork.length = 0; });
  await stress(page, WINDOW_MS);
  const result = await page.evaluate(() => ({
    work: window.__frameWork.slice(),
    audio: window.makeTheRightMove.audio.state,
    sounds: window.makeTheRightMove.audio.journal.length,
  }));
  await browser.close();
  return { ...stats(result.work), audio: result.audio, sounds: result.sounds, errors };
}

const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url))], {
  env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
});
try {
  await new Promise(resolve => setTimeout(resolve, 500));
  const results = {};
  for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
    const silent = await run(type, false), sound = await run(type, true);
    const metric = name === 'chromium' ? 'p95' : 'mean';
    const addedMs = +(sound[metric] - silent[metric]).toFixed(3);
    results[name] = { metric, addedMs, pass: addedMs <= 0.5, withoutSound: silent, withSound: sound };
  }
  console.log(JSON.stringify(results, null, 1));
} finally {
  server.kill();
}
