import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES_VERSION } from '../../src/game/record.js';
import { playGame, players, seedFor } from './played-games.js';

// The recorded-games corpus (DESIGN DDD-R12, K21): bot games played in Node on the real rules, kept as fixtures in
// tests/fixtures/recorded-games/, one JSON file per game, { seed, record, deposit, steps } and nothing else (no session,
// token or time). The acceptance scenarios replay every one in Node (the build gate) and in Chromium, Firefox and
// WebKit, so a change to how the game plays fails the build until RULES_VERSION is raised and the corpus re-recorded:
//   node scripts/record-corpus.mjs
// The check never records: recording is this script's alone, and it won't overwrite a game recorded on the rules version
// the game plays now, so re-recording can't make a failing check pass. The preview smoke test signs the longest one (K22).

export const CORPUS = fileURLToPath(new URL('../fixtures/recorded-games/', import.meta.url));
const MINUTE = 60 * 120;   // steps
const TRIES = 400;

// At least 6 games, from about a minute to at least one of 15 minutes or more, under 300 KB in all.
const BANDS = Object.freeze([
  { name: 'game-01-about-1-minute', minutes: [0.75, 2], player: () => players.standStillFiring() },
  { name: 'game-02-about-3-minutes', minutes: [2.5, 4], player: () => players.greedy({ decideEvery: 6 }) },
  { name: 'game-03-about-6-minutes', minutes: [5, 7], player: () => players.greedy({ decideEvery: 6 }) },
  { name: 'game-04-about-9-minutes', minutes: [8, 10.5], player: () => players.greedy() },
  { name: 'game-05-about-13-minutes', minutes: [11.5, 14.5], player: () => players.greedy() },
  { name: 'game-06-15-minutes-or-more', minutes: [15, Infinity], player: () => players.greedy() },
]);

// Plays seeds in a fixed order until every band has a game, and writes them, once the rules version has moved on from
// every game already recorded (or none is). -> the names written.
export async function recordCorpus() {
  await mkdir(CORPUS, { recursive: true });
  const sameRules = (await loadRecordedGames()).filter(({ record }) => record?.rules === RULES_VERSION).map(({ name }) => name);
  if (sameRules.length) {
    throw new Error(`refused: ${sameRules.join(', ')} were recorded on rules version ${RULES_VERSION}, the version the game plays now. Raise RULES_VERSION (src/game/record.js) if how the game plays has changed; otherwise the check is right to fail`);
  }
  const written = [];
  for (const band of BANDS) {
    let game = null;
    for (let i = 0; !game && i < TRIES; i++) {
      const played = playGame({ seed: seedFor(`${band.name}, try ${i}`), player: band.player() });
      const minutes = played.steps / MINUTE;
      if (played.record && minutes >= band.minutes[0] && minutes < band.minutes[1]) game = played;
    }
    if (!game) throw new Error(`no seed in ${TRIES} gave a game for ${band.name}`);
    const { seed, record, deposit, steps } = game;
    await writeFile(join(CORPUS, `${band.name}.json`), `${JSON.stringify({ seed, record, deposit, steps })}\n`);
    written.push(band.name);
  }
  return written;
}

// -> [{ name, seed, record, deposit, steps }], in name order
export async function loadRecordedGames() {
  const files = (await readdir(CORPUS).catch(() => [])).filter(file => file.endsWith('.json')).sort();
  return Promise.all(files.map(async file => ({ name: file.replace(/\.json$/, ''), ...JSON.parse(await readFile(join(CORPUS, file), 'utf8')) })));
}
