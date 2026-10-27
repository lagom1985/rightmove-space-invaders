import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { getDeployStore } from '@netlify/blobs';
import { startBlobsEmulator } from './support/blobs-emulator.js';
import { startLocalServer } from './support/local-server.js';
import { isAllowedInitials } from '../../src/game/high-scores.js';
import { MAX_GAME_STEPS } from '../../src/game/record.js';
import scores, { createTablePort, encodeKey, fasterThanTheClock, handleScores } from '../../netlify/functions/scores.mjs';
import { createSessionSigner, readSessionSecret } from '../../netlify/scores/sessions.mjs';
import { TEST_SECRET } from '../common/session-secret.js';
import { assertStateDelta, setTo } from '../common/state-delta.js';
import { scriptedGames } from '../common/played-games.js';

// The clock check (DDD-R11, D8, C2; Signing checks row 14): a game can't be signed sooner after its session than it
// lasted, less the allowance (10 s), judged on the table's clock alone, in integers so the boundary is exact. The
// handler fails closed: handed no allowance, it uses production's for rows 9b and 14 alike. Each root hands it one:
// the Netlify entry production's always, whatever cookies a request carries; the local server production's too, but
// for a test board's request carrying test-clock=lenient, which skips the check (E6).
// Universe of the handler's state deltas: the keys in the table's store; of the roots', the rows a reading shows.

const URL = 'http://localhost/api/scores';
const NOW = 1_767_225_600_000;
const HOUR = 3_600_000;
const ALLOWANCE_MS = 10_000;   // D8, DDD-R11: the design's, never read from the code under test
// Sessions sealed this far ahead of a root's clock: the orchestrator's minute, and 10.5 s, which a root handing the
// handler 11 s instead of 10 (S13) would let past row 9b.
const AHEAD_MS = Object.freeze([60_000, 10_500]);
const UNIVERSE = ['table.keys'];
const LOCAL = Object.freeze({ scope: 'local', context: 'missing', published: 'missing' });
const JSON_TYPE = Object.freeze({ 'content-type': 'application/json' });
const LENIENT_COOKIES = Object.freeze(['test-clock=lenient', 'test-board=a-test-board']);

const signer = createSessionSigner(readSessionSecret(TEST_SECRET));
const SIGNING = Object.freeze({ verify: signer.verify, gameId: signer.gameId });
const sessionFor = (seed, issuedAt) => ({ seed, issuedAt, token: signer.sign(seed, issuedAt) });
// A game's length in ms, rounded up, in integers: the earliest a signing of it may arrive is this less the allowance.
const lastedMs = steps => Number((BigInt(steps) * 1000n + 119n) / 120n);

const played = fc.constantFrom(...scriptedGames(12));
const initials = fc.stringMatching(/^[A-Z]{3}$/).filter(isAllowedInitials);
const signingOf = (who, game, session) => ({ initials: who, score: game.deposit, session, record: game.record });
const posted = (body, headers = JSON_TYPE) => new Request(URL, { method: 'POST', headers, body: JSON.stringify(body) });

let emulator;
test.beforeAll(async () => { emulator = await startBlobsEmulator('clock-check'); });
test.afterAll(() => emulator.stop());
const snapshot = async store => ({ 'table.keys': (await store.list()).blobs.map(blob => blob.key).sort() });

// bypass: an exhaustive loop over a closed domain, every step count a record may have (1 to MAX_GAME_STEPS), is
// stronger than any sample: the floating-point slip C2 measured refuses an honest game at only 787 of them.
test('the clock check refuses exactly when steps x 1000 > (elapsed + allowance) x 120, over every step count up to 432,000', () => {
  const wrong = [];
  for (let steps = 1; steps <= MAX_GAME_STEPS; steps++) {
    const earliest = lastedMs(steps) - ALLOWANCE_MS;
    if (fasterThanTheClock(steps, earliest, ALLOWANCE_MS)) wrong.push(`${steps} steps refused, signed its length less the allowance after`);
    if (!fasterThanTheClock(steps, earliest - 1, ALLOWANCE_MS)) wrong.push(`${steps} steps let through, signed a millisecond sooner`);
  }
  expect(wrong.slice(0, 10), `${wrong.length} wrong`).toEqual([]);
});

// For any played game signed any time from 14 s before to an hour after the earliest it may be (its length less 10 s),
// handed the allowance or none: saved exactly when it is not sooner than that, else 400 too-fast, never kept, one line
// with its reason and no replay's steps or replayMs (it is never replayed), and the table unchanged.
test('a game signed sooner than it lasted, less the allowance, is too-fast and never replayed, with the roots\' allowance or none', async () => {
  const fromTheEarliest = fc.oneof(fc.integer({ min: -2, max: 2 }), fc.integer({ min: -14_000, max: HOUR }));
  await fc.assert(fc.asyncProperty(initials, played, fromTheEarliest, fc.boolean(), async (who, game, offset, given) => {
    const store = emulator.freshStore();
    const logs = [];
    const issuedAt = NOW - (lastedMs(game.steps) - ALLOWANCE_MS + offset);
    const options = { now: () => NOW, log: entry => logs.push(entry), where: LOCAL, sessions: SIGNING, ...(given ? { clockAllowanceMs: ALLOWANCE_MS } : {}) };
    const before = await snapshot(store);
    const response = await handleScores(posted(signingOf(who, game, sessionFor(game.seed, issuedAt))), createTablePort(store), options);
    const tooFast = offset < 0;
    expect(response.status, `signed ${offset} ms from the earliest`).toBe(tooFast ? 400 : 200);
    expect(await response.json()).toMatchObject(tooFast ? { error: 'too-fast' } : { id: signer.gameId(game.seed) });
    if (tooFast) expect(logs, 'one line, its reason; never replayed').toEqual([{ event: 'scores.rejected', reason: 'too-fast', ms: expect.any(Number), ...LOCAL }]);
    const ownRow = encodeKey({ initials: who, score: game.deposit, at: NOW, id: signer.gameId(game.seed) });
    assertStateDelta(before, await snapshot(store), { universe: UNIVERSE, expected: tooFast ? {} : { 'table.keys': setTo([ownRow]) } });
  }), { numRuns: 30, examples: [['FAB', scriptedGames(1)[0], -1, false], ['FAB', scriptedGames(1)[0], 0, false]] });
});

// Handed no allowance, the handler still refuses a session issued more than 10 s after its now (row 9b).
test('handed no allowance, a signing whose session was sealed more than 10 s in the future is invalid-session, and the table is unchanged', async () => {
  const ahead = fc.oneof(fc.constant(60_000), fc.integer({ min: ALLOWANCE_MS + 1, max: HOUR }));
  await fc.assert(fc.asyncProperty(initials, played, ahead, async (who, game, fromNow) => {
    const store = emulator.freshStore();
    const before = await snapshot(store);
    const options = { now: () => NOW, log: () => {}, where: LOCAL, sessions: SIGNING };
    const response = await handleScores(posted(signingOf(who, game, sessionFor(game.seed, NOW + fromNow))), createTablePort(store), options);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid-session' });
    assertStateDelta(before, await snapshot(store), { universe: UNIVERSE });
  }), { numRuns: 15 });
});

// ---- the roots: each hands the handler its allowance ----
// The Netlify entry, on a preview deploy over the emulator, its secret the test secret.
async function throughTheEntry(body, cookie) {
  const deployID = randomBytes(12).toString('hex');
  const set = { NETLIFY_BLOBS_CONTEXT: Buffer.from(JSON.stringify({ ...emulator.context, deployID, primaryRegion: 'us-east-2' })).toString('base64'), SCORES_SESSION_SECRET: TEST_SECRET };
  const originals = Object.entries(set).map(([name]) => [name, process.env[name]]);
  Object.assign(process.env, set);
  const log = console.log;
  console.log = () => {};
  try {
    const keys = async () => ({ 'table.keys': (await getDeployStore({ name: 'leaderboard', consistency: 'strong' }).list()).blobs.map(blob => blob.key) });
    const before = await keys();
    const headers = { ...JSON_TYPE, ...(cookie ? { cookie } : {}) };
    const response = await scores(posted(body, headers), { deploy: { id: deployID, context: 'deploy-preview', published: false } });
    return { status: response.status, body: await response.json(), before, after: await keys() };
  } finally {
    console.log = log;
    for (const [name, value] of originals) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
}

// bypass: a composition root's wiring, one representative call per root and refusal (integration level).
test('the Netlify entry refuses a session sealed 60 s (or 10.5 s) in the future, and a game signed at once, whatever test cookies the request carries', async () => {
  const [game] = scriptedGames(1);
  for (const cookie of [undefined, LENIENT_COOKIES.join('; ')]) for (const ahead of AHEAD_MS) {
    const future = await throughTheEntry(signingOf('FAB', game, sessionFor(game.seed, Date.now() + ahead)), cookie);
    expect([future.status, future.body], `a session sealed ${ahead} ms ahead, cookies: ${cookie}`).toEqual([400, { error: 'invalid-session' }]);
    assertStateDelta(future.before, future.after, { universe: UNIVERSE });
    const atOnce = await throughTheEntry(signingOf('FAB', game, sessionFor(game.seed, Date.now())), cookie);
    expect([atOnce.status, atOnce.body], `a ${lastedMs(game.steps)} ms game signed at once, cookies: ${cookie}`).toEqual([400, { error: 'too-fast' }]);
    assertStateDelta(atOnce.before, atOnce.after, { universe: UNIVERSE });
  }
});

// The local server, its clock moved on demand: a module loaded before it (NODE_OPTIONS --import) adds the number of
// ms the shift file holds to every reading of Date.now, so a session can be issued on a clock a minute ahead, as
// another instance's might be, and signed on one that isn't.
const SHIFTED_CLOCK = "import { readFileSync } from 'node:fs';\nconst real = Date.now;\nDate.now = () => real() + Number(readFileSync(process.env.CLOCK_SHIFT_FILE, 'utf8'));\n";

test.describe('the local server', () => {
  let server, directory, shiftFile;

  test.beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'make-the-right-move-clock-check-'));
    const preload = join(directory, 'shifted-clock.mjs');
    shiftFile = join(directory, 'shift');
    await writeFile(preload, SHIFTED_CLOCK);
    await writeFile(shiftFile, '0');
    const originals = { NODE_OPTIONS: process.env.NODE_OPTIONS, CLOCK_SHIFT_FILE: process.env.CLOCK_SHIFT_FILE };
    process.env.NODE_OPTIONS = `${originals.NODE_OPTIONS ?? ''} --import=${pathToFileURL(preload)}`.trim();
    process.env.CLOCK_SHIFT_FILE = shiftFile;
    try { server = await startLocalServer(directory); } finally {
      for (const [name, value] of Object.entries(originals)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    }
  });

  test.afterAll(async () => {
    await server?.stop();
    await rm(directory, { recursive: true, force: true });
  });

  const withCookie = cookie => ({ ...JSON_TYPE, ...(cookie ? { cookie } : {}) });
  const ask = async (seed, cookie) => (await (await fetch(server.url('/api/sessions'), { method: 'POST', headers: withCookie(cookie), body: JSON.stringify({ seed }) })).json()).session;
  const sign = async (body, cookie) => {
    const response = await fetch(server.url('/api/scores'), { method: 'POST', headers: withCookie(cookie), body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const rows = async cookie => ({ 'table.keys': (await (await fetch(server.url('/api/scores'), { headers: withCookie(cookie) })).json()).scores.map(({ id }) => id) });

  // bypass: a composition root's wiring, one representative call (integration level).
  test('without the lenient cookies, it refuses a session sealed 60 s (or 10.5 s) in the future', async () => {
    const [game] = scriptedGames(1);
    for (const ahead of AHEAD_MS) {
      await writeFile(shiftFile, String(ahead));
      const session = await ask(game.seed);
      await writeFile(shiftFile, '0');
      const before = await rows();
      expect(await sign(signingOf('FAB', game, session)), `sealed ${ahead} ms ahead`).toEqual({ status: 400, body: { error: 'invalid-session' } });
      assertStateDelta(before, await rows(), { universe: UNIVERSE });
    }
  });

  // A played game signed as soon as its session arrives, on a test board of its own: saved only when the request
  // carries both test-clock=lenient and a test board, and too-fast with either alone or neither.
  test('a game signed at once is saved only with test-clock=lenient and a test board, and too-fast otherwise', async () => {
    const cookies = fc.subarray(['test-clock=lenient', 'test-board']);
    await fc.assert(fc.asyncProperty(cookies, played, async (sent, game) => {
      const board = `clock-${randomBytes(6).toString('hex')}`;
      const cookie = sent.map(name => (name === 'test-board' ? `test-board=${board}` : name)).join('; ');
      const lenient = sent.length === 2;
      const before = await rows(cookie);
      const answer = await sign(signingOf('FAB', game, await ask(game.seed, cookie)), cookie);
      expect(answer.status, `cookies: ${cookie || 'none'}`).toBe(lenient ? 200 : 400);
      expect(answer.body).toMatchObject(lenient ? { id: signer.gameId(game.seed) } : { error: 'too-fast' });
      assertStateDelta(before, await rows(cookie), { universe: UNIVERSE, expected: lenient ? { 'table.keys': setTo([signer.gameId(game.seed)]) } : {} });
    }), { numRuns: 8, examples: [[['test-clock=lenient', 'test-board'], scriptedGames(1)[0]], [['test-clock=lenient'], scriptedGames(1)[0]]] });
  });
});
