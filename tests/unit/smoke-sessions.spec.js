import { isDeepStrictEqual } from 'node:util';
import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { assertStateDelta, normalizedTo, satisfying } from '../common/state-delta.js';
import { CLOCK_ALLOWANCE_MS, createTablePort, decodeKey, dispatch, encodeKey } from '../../netlify/functions/scores.mjs';
import { createSessionSigner, readSessionSecret } from '../../netlify/scores/sessions.mjs';
import { SCORE_STEP } from '../../src/game/high-scores.js';
import { MAX_GAME_STEPS } from '../../src/game/record.js';
import { replay } from '../../src/game/replay.js';
import { playGame, players, seedFor } from '../common/played-games.js';
import { loadRecordedGames } from '../common/recorded-games.js';
import { TEST_SECRET } from '../common/session-secret.js';
import { createNodeGames, runSmoke } from '../../scripts/smoke-leaderboard.mjs';

// The preview smoke test of slices 01 to 03 (DEVOPS "Preview smoke test, extended": its pacing, S1-S13 and the slices'
// gates), driven through the script's run entry point with its ports faked: the network, a deploy of the real function
// (dispatch, an in-memory table per host, a session signer built as the Netlify entry builds its own), the clock,
// virtual time that a wait moves on at once, so a 40-minute run takes a moment, and, where a property isn't about them,
// the games the script makes in Node. The state the properties watch is the network's: every request the run sent, when,
// to which host and path, with its cookie and body.

const SITE = 'make-the-right-move';
const PREVIEW = `https://deploy-preview-7--${SITE}.netlify.app`;
const PRODUCTION = `https://${SITE}.netlify.app`;
const PERMALINK = `https://0123456789abcdef01234567--${SITE}.netlify.app`;
const PREVIEW_HOST = new URL(PREVIEW).hostname;
const START = Date.parse('2026-11-02T09:00:00.000Z');
const WINDOW_MS = 60_000;
const LIMIT = 10;
const COOL_DOWN_MS = 61_000;
const OVER_LIMIT_STEPS = ['S6.8a', 'S6.8b', 'S6.8c', 'S6.8d', 'S6.9'];
const UNIVERSE = ['network.requests'];
const slice01Preview = (...flags) => ['--site', SITE, '--slice', '01', '--preview', PREVIEW, ...flags];
const slice02Preview = () => ['--site', SITE, '--slice', '02', '--preview', PREVIEW];
const slice02Burst = () => ['--site', SITE, '--slice', '02', '--burst', PREVIEW];
const slice03Preview = () => ['--site', SITE, '--slice', '03', '--preview', PREVIEW];

// The run's clock, a port: now, and a wait that moves time on by its length at once.
function fakeClock() {
  let time = START;
  return { now: () => time, sleep: async ms => { time += Math.max(0, ms); } };
}

// The Blobs store as createTablePort uses it, in memory.
function memoryStore() {
  const keys = new Set();
  return {
    async list({ prefix = '' } = {}) { return { blobs: [...keys].filter(key => key.startsWith(prefix)).sort().map(key => ({ key })) }; },
    async set(key, _value, { onlyIfNew = false } = {}) {
      if (onlyIfNew && keys.has(key)) return { modified: false };
      keys.add(key);
      return { modified: true };
    },
    async delete(key) { keys.delete(key); },
  };
}

// A deploy of the function, as a double of the network port: the real dispatch, one table per host, and a session
// signer built from `secret` the way the Netlify entry builds it from SCORES_SESSION_SECRET (readSessionSecret, then
// createSessionSigner; no signer from a value that isn't canonical base64 of 32 bytes). Each answer takes the next of
// `latencies` ms on the run's clock (at least 1, so two signings never share a moment). `testRoute`, when given, answers
// POST /__test/rows with its status instead of the function's 404, and writes a row first if it `writes`. `signing`,
// when given, answers POST /api/scores in the function's place: (signer, clock) -> (request, table) -> a Response.
// `clockAllowanceMs` is the dispatch's: Infinity for a deploy of slice 01 or 02, CLOCK_ALLOWANCE_MS for slice 03's.
function fakeDeploy({ clock, secret, latencies = [1], testRoute = null, signing = null, clockAllowanceMs = Infinity }) {
  const readSecret = readSessionSecret(secret);
  const signer = readSecret && createSessionSigner(readSecret);
  // A deploy of slice 01 or 02 has no clock check (row 14 is slice 03's): the real dispatch handed an allowance no game
  // outlasts, as 02-05's stand-in kept slice 01's envelope. No smoke step sends a session from the future, so row 9b,
  // which this allowance also opens, decides nothing here. Slice 03's deploy has the Netlify entry's own allowance.
  const options = { now: clock.now, log: () => {}, clockAllowanceMs };
  const signs = signing && signing(signer, clock);
  const tables = new Map();
  const tableOf = host => tables.get(host) ?? tables.set(host, createTablePort(memoryStore())).get(host);
  const requests = [];
  let answered = 0;
  async function answerTheRoute(host) {
    if (testRoute.writes) await tableOf(host).putIfNew(encodeKey({ initials: 'TST', score: 5000, at: clock.now(), id: 'f'.repeat(32) }));
    return new Response('{}', { status: testRoute.status, headers: { 'content-type': 'application/json' } });
  }
  const fetch = async (url, init = {}) => {
    const { host, pathname, search } = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body === undefined ? null : JSON.parse(init.body);
    requests.push({ at: clock.now(), host, method, path: pathname, search, cookie: init.headers?.cookie ?? null, body });
    await clock.sleep(latencies[answered++ % latencies.length]);
    if (testRoute && pathname === '/__test/rows') return answerTheRoute(host);
    if (signs && method === 'POST' && pathname === '/api/scores') return signs(new Request(url, init), tableOf(host));
    return dispatch(new Request(url, init), tableOf(host), options, signer);
  };
  return { fetch, tableOf, state: () => ({ 'network.requests': [...requests] }) };
}

// A stand-in for slice 01's signing path, whose envelope is { initials, score, session }. Slice 01 is released: its gate
// ran on deploy-preview-8 on 2026-10-27 and passed. Today's dispatch is slice 02's, which refuses that envelope before
// it looks at the session (Signing checks, row 7), so it can no longer stand in for a slice-01 deploy. The stand-in keeps
// only what S4 looks at, on the deploy's real session signer (built from its secret): no session is session-required, a
// session the signer doesn't verify is invalid-session, and a verified one saves its game's row once (200, its id the
// game id) and is already-signed after that (409). The deploy's other paths stay the real dispatch, over the same table.
// Slice 02's own probe, S9b with a record {}, is checked against the real dispatch (below).
const NOT_KEPT = Object.freeze({ 'cache-control': 'no-store' });
const slice01Signing = (signer, clock) => async (request, table) => {
  const { initials, score, session } = await request.json();
  if (session === undefined) return Response.json({ error: 'session-required' }, { status: 400, headers: NOT_KEPT });
  if (!signer.verify(session)) return Response.json({ error: 'invalid-session' }, { status: 400, headers: NOT_KEPT });
  const id = signer.gameId(session.seed);
  const signed = (await table.list()).some(key => decodeKey(key).id === id);
  if (signed) return Response.json({ error: 'already-signed' }, { status: 409, headers: NOT_KEPT });
  await table.putIfNew(encodeKey({ initials, score, at: clock.now(), id }));
  const scores = (await table.list()).map(decodeKey).map(row => ({ initials: row.initials, score: row.score, id: row.id }));
  return Response.json({ scores, id, listedAt: clock.now() }, { headers: NOT_KEPT });
};

const canonicalSecret = fc.uint8Array({ minLength: 32, maxLength: 32 }).map(bytes => Buffer.from(bytes).toString('base64'));
const OTHER_SECRET = Buffer.alloc(32, 9).toString('base64');
const latencies = fc.array(fc.integer({ min: 1, max: 2500 }), { minLength: 1, maxLength: 12 });
const otherHosts = fc.subarray([['--production', PRODUCTION], ['--permalink', PERMALINK]]).map(flags => flags.flat());
const quietly = (deploy, clock, games = standInGames()) => ({ fetch: deploy.fetch, clock, progress: () => {}, games });

// The games the script makes in Node, stood in for where a property isn't about them: real games, played on the real
// rules (the deploy's dispatch replays every signing), but short scripted ones with distinct deposits, made once per
// worker, so a slice-02 run takes a moment. The run's long game, its 30 ten-minute games and its scripted games come
// from one pool, so no two signings share a game unless a step means them to; `scriptedAt` moves where the scripted
// ones start, and `tamper`, when given, changes the pool's game `at` with `how` before the run is handed it.
const POOL = 52;                                        // 1 long, 30 ten-minute and 21 scripted games
const SCRIPTED_AT_MOST_STEPS = 30 * 120;                 // 30 s at 120 steps a second
const STAND_IN = Object.freeze({ longest: 0, tenMinute: 1, scripted: 31 });
let pool = null;
function standInPool() {
  if (pool) return pool;
  const deposits = new Set();
  pool = [];
  for (let i = 0; pool.length < POOL; i++) {
    const game = playGame({ seed: seedFor(`a stand-in for a game the smoke test makes, try ${i}`), player: players.standStillFiring() });
    if (!game.record || game.steps > SCRIPTED_AT_MOST_STEPS || deposits.has(game.deposit)) continue;
    deposits.add(game.deposit);
    pool.push(game);
  }
  return pool;
}
function standInGames({ scriptedAt = STAND_IN.scripted, tamper = null } = {}) {
  const games = standInPool().map((game, at) => (tamper?.at === at ? tamper.how(game) : game));
  return {
    longest: async () => games[STAND_IN.longest],
    tenMinute: async count => games.slice(STAND_IN.tenMinute, STAND_IN.tenMinute + count),
    scripted: async count => games.slice(scriptedAt, scriptedAt + count),
  };
}

// Slice 02's two runs: the arguments, the pool's games each signs (from and to, both included: the long game, the 30
// ten-minute games and S9's scripted one; S10's 21 scripted ones), its over-limit steps, and how many of its signings
// claim a game it made, honestly (S7's long game and S8's 30; S10's burst of 20 and its race of 3).
const SLICE_02_RUNS = Object.freeze({
  preview: Object.freeze({ args: slice02Preview(), uses: [STAND_IN.longest, STAND_IN.scripted], overLimit: [], honest: 31 }),
  burst: Object.freeze({ args: slice02Burst(), uses: [STAND_IN.scripted, STAND_IN.scripted + 20], overLimit: ['S10.2', 'S10.4'], honest: 23 }),
});
// Slice 03's preview run (S1, S11, S12, S13), on a deploy with the Netlify entry's clock allowance.
const SLICE_03_PREVIEW = Object.freeze({ args: slice03Preview(), overLimit: [], clockAllowanceMs: CLOCK_ALLOWANCE_MS });

const stepNamed = (summary, name) => summary.steps.find(step => step.step === name);
const spanOf = step => [Date.parse(step.startedAt), Date.parse(step.finishedAt)];
// A step's span is half-open: its requests are sent from its start, and each is answered before it finishes.
const isWithin = ([from, to]) => request => request.at >= from && request.at < to;
const kindOf = request => `${request.method} ${request.path}`;
const SESSION = 'POST /api/sessions';
const SIGNING = 'POST /api/scores';
const READ = 'GET /api/scores';

// Requests outside every over-limit step, per host: from each, the next 60 s hold at most 10, its own included.
function noCrowdedWindow(requests, overLimitSpans) {
  const paced = requests.filter(request => !overLimitSpans.some(span => isWithin(span)(request)));
  return paced.every(first => paced.filter(other => other.host === first.host && other.at >= first.at && other.at < first.at + WINDOW_MS).length <= LIMIT);
}

// No request to the host in the 61 s before an over-limit step starts, nor in the 61 s after it ends.
const quietAround = (requests, overLimitSpans, host) => overLimitSpans.every(([from, to]) => !requests.some(request => request.host === host
  && ((request.at >= from - COOL_DOWN_MS && request.at < from) || (request.at >= to && request.at < to + COOL_DOWN_MS))));

// The run's requests as two snapshots of the network: before a step started, and once it finished.
const aroundStep = (requests, step) => {
  const [from, to] = spanOf(step);
  return [{ 'network.requests': requests.filter(request => request.at < from) }, { 'network.requests': requests.filter(request => request.at < to) }];
};

test('the limiter never lets an 11th request to one host into any 60 s window outside an over-limit step, across steps', async () => {
  await fc.assert(fc.asyncProperty(latencies, otherHosts, async (ms, flags) => {
    const clock = fakeClock();
    const deploy = fakeDeploy({ clock, secret: OTHER_SECRET, latencies: ms });
    const before = deploy.state();
    const summary = await runSmoke(slice01Preview(...flags), quietly(deploy, clock));
    const overLimit = summary.steps.filter(step => step.overLimit);
    expect(overLimit.map(step => step.step)).toEqual(OVER_LIMIT_STEPS);
    const spans = overLimit.map(spanOf);
    assertStateDelta(before, deploy.state(), {
      universe: UNIVERSE,
      expected: {
        'network.requests': satisfying('at most 10 requests to a host in any 60 s outside an over-limit step, and 61 s of quiet around each',
          (_, after) => noCrowdedWindow(after, spans) && quietAround(after, spans, PREVIEW_HOST)),
      },
    });
  }), { numRuns: 20 });
  // Slice 02's runs: its preview run has no over-limit step, and its burst run (S10) two, the burst and the race. Slice
  // 03's preview run has none, and waits each game's length on a deploy that checks the clock.
  await fc.assert(fc.asyncProperty(fc.constantFrom(SLICE_02_RUNS.preview, SLICE_02_RUNS.burst, SLICE_03_PREVIEW), latencies, async (run, ms) => {
    const clock = fakeClock();
    const deploy = fakeDeploy({ clock, secret: OTHER_SECRET, latencies: ms, clockAllowanceMs: run.clockAllowanceMs });
    const before = deploy.state();
    const summary = await runSmoke(run.args, quietly(deploy, clock));
    const overLimit = summary.steps.filter(step => step.overLimit);
    expect(overLimit.map(step => step.step)).toEqual(run.overLimit);
    const spans = overLimit.map(spanOf);
    assertStateDelta(before, deploy.state(), {
      universe: UNIVERSE,
      expected: {
        'network.requests': satisfying('at most 10 requests to a host in any 60 s outside an over-limit step, and 61 s of quiet around each',
          (_, after) => after.length > 0 && noCrowdedWindow(after, spans) && quietAround(after, spans, PREVIEW_HOST)),
      },
    });
  }), { numRuns: 8 });
});

// S5's or S8's requests, in order: 30 session requests, then 30 pairs of a signing carrying its own game's session (the
// k-th session's seed) in its slice's shape, `fields`, and a cache-missing GET.
function sessionsThenPairs(appended, count, fields) {
  const sessions = appended.slice(0, count);
  const pairs = appended.slice(count);
  const seeds = sessions.map(request => request.body?.seed);
  return appended.length === 3 * count && sessions.every(request => kindOf(request) === SESSION)
    && new Set(seeds).size === count && pairs.every((request, at) => (at % 2 === 0
      ? kindOf(request) === SIGNING && Object.keys(request.body).sort().join() === fields && request.body.session?.seed === seeds[at / 2]
      : kindOf(request) === READ && request.search.startsWith('?table=')));
}

test('a signing step asks for all its sessions before it sends its pairs', async () => {
  await fc.assert(fc.asyncProperty(latencies, async ms => {
    const clock = fakeClock();
    const deploy = fakeDeploy({ clock, secret: OTHER_SECRET, latencies: ms });
    const summary = await runSmoke(slice01Preview(), quietly(deploy, clock));
    const requests = deploy.state()['network.requests'];
    const [beforeS5, afterS5] = aroundStep(requests, stepNamed(summary, 'S5'));
    assertStateDelta(beforeS5, afterS5, {
      universe: UNIVERSE,
      expected: {
        'network.requests': satisfying('appended with 30 session requests, then 30 signings, each with its own session and followed by a GET ?table=',
          (old, now) => sessionsThenPairs(now.slice(old.length), 30, 'initials,score,session')),
      },
    });
    const [beforeS4b, afterS4b] = aroundStep(requests, stepNamed(summary, 'S4b'));
    assertStateDelta(beforeS4b, afterS4b, {
      universe: UNIVERSE,
      expected: {
        'network.requests': satisfying('appended with a session request, then a signing with its session',
          (old, now) => {
            const [asked, signed] = now.slice(old.length);
            return now.length === old.length + 2 && kindOf(asked) === SESSION && kindOf(signed) === SIGNING && signed.body.session?.seed === asked.body.seed;
          }),
      },
    });
  }), { numRuns: 10 });
  // S8 (slice 02): the session phase for its 30 games' seeds, then the pairs, each signing carrying its game's record.
  await fc.assert(fc.asyncProperty(latencies, async ms => {
    const clock = fakeClock();
    const deploy = fakeDeploy({ clock, secret: OTHER_SECRET, latencies: ms });
    const summary = await runSmoke(slice02Preview(), quietly(deploy, clock));
    const [beforeS8, afterS8] = aroundStep(deploy.state()['network.requests'], stepNamed(summary, 'S8'));
    assertStateDelta(beforeS8, afterS8, {
      universe: UNIVERSE,
      expected: {
        'network.requests': satisfying('appended with 30 session requests, then 30 signings with records, each with its own session and followed by a GET ?table=',
          (old, now) => sessionsThenPairs(now.slice(old.length), 30, 'initials,record,score,session')),
      },
    });
  }), { numRuns: 4 });
});

// Every value the Netlify entry builds no signer from: the function then answers a session request 500.
const notASecret = fc.oneof(
  fc.constant(undefined), fc.string(), canonicalSecret.map(secret => secret.slice(1)), canonicalSecret.map(secret => `${secret} `),
  canonicalSecret.map(secret => `${secret.slice(0, 42)}/=`),
).filter(value => readSessionSecret(value) === null);
const S4_REQUESTS = [SIGNING, SESSION, SIGNING, SIGNING, SIGNING, SESSION, SIGNING, 'GET /api/sessions', SESSION, SIGNING];

test('a 500 to the first session request stops the run, and a 200 for the public test secret fails it', async () => {
  await fc.assert(fc.asyncProperty(notASecret, latencies, async (secret, ms) => {
    const clock = fakeClock();
    const deploy = fakeDeploy({ clock, secret, latencies: ms });
    const before = deploy.state();
    const summary = await runSmoke(slice01Preview('--production', PRODUCTION), quietly(deploy, clock));
    assertStateDelta(before, deploy.state(), { universe: UNIVERSE, expected: { 'network.requests': normalizedTo(requests => requests.map(kindOf), [READ, SESSION]) } });
    expect(summary.steps.map(({ step, outcome, status }) => ({ step, outcome, status }))).toEqual([
      { step: 'S1', outcome: 'pass', status: 200 }, { step: 'S2', outcome: 'fail', status: 500 }]);
    expect(summary.error).toMatch(/SCORES_SESSION_SECRET/);
    expect(summary.exitCode).toBe(1);
  }));
  // The probe is sealed as a root seals: a slice-01 deploy (the stand-in's signing) whose signer was built from
  // TEST_SECRET signs it, and fails S4 (so the run); one built from any other canonical secret refuses it,
  // invalid-session, and S4 passes.
  await fc.assert(fc.asyncProperty(canonicalSecret, latencies, async (secret, ms) => {
    const clock = fakeClock();
    const deploy = fakeDeploy({ clock, secret, latencies: ms, signing: slice01Signing });
    const summary = await runSmoke(slice01Preview(), quietly(deploy, clock));
    const s4 = stepNamed(summary, 'S4');
    const [beforeS4, afterS4] = aroundStep(deploy.state()['network.requests'], s4);
    assertStateDelta(beforeS4, afterS4, {
      universe: UNIVERSE,
      expected: { 'network.requests': satisfying('appended with S4\'s 10 requests', (old, now) => now.slice(old.length).map(kindOf).join() === S4_REQUESTS.join()) },
    });
    const isPublic = secret === TEST_SECRET;
    expect({ outcome: s4.outcome, publicSecret: s4.publicSecret }).toEqual({ outcome: isPublic ? 'fail' : 'pass', publicSecret: isPublic });
    if (isPublic) expect(summary.exitCode).toBe(1);
  }), { numRuns: 10, examples: [[TEST_SECRET, [1]]] });
});

// What a deploy might answer to the local server's test route: Netlify's 404 or 405, or anything else, with a row
// written or not.
const routeAnswer = fc.record({
  status: fc.oneof(fc.constantFrom(404, 405), fc.integer({ min: 200, max: 599 }).filter(status => ![204, 205, 304].includes(status))),
  writes: fc.boolean(),
});

test('S4c passes only on 404 or 405, with no row written', async () => {
  await fc.assert(fc.asyncProperty(routeAnswer, async testRoute => {
    const clock = fakeClock();
    const deploy = fakeDeploy({ clock, secret: OTHER_SECRET, testRoute });
    const summary = await runSmoke(slice01Preview(), quietly(deploy, clock));
    const s4c = stepNamed(summary, 'S4c');
    const [beforeS4c, afterS4c] = aroundStep(deploy.state()['network.requests'], s4c);
    assertStateDelta(beforeS4c, afterS4c, {
      universe: UNIVERSE,
      expected: {
        'network.requests': satisfying('appended with one POST /__test/rows, with a test-board cookie', (old, now) => {
          const appended = now.slice(old.length);
          return appended.map(kindOf).join() === 'POST /__test/rows' && /^test-board=/.test(appended[0].cookie);
        }),
      },
    });
    const passes = [404, 405].includes(testRoute.status) && !testRoute.writes;
    expect({ status: s4c.status, outcome: s4c.outcome }).toEqual({ status: testRoute.status, outcome: passes ? 'pass' : 'fail' });
  }), { numRuns: 15, examples: [[{ status: 404, writes: false }], [{ status: 405, writes: true }]] });
});

// A table the first GET finds rows on: the production table, say, reached as if it were a preview.
const heldRows = fc.uniqueArray(fc.record({ score: fc.integer({ min: 1, max: 200 }).map(units => units * 50), at: fc.integer({ min: START - 86_400_000, max: START }) }),
  { minLength: 1, maxLength: 12, selector: row => row.at });

test('the write guard decides every POST, session requests included: after a first GET that finds rows, nothing more is sent', async () => {
  await fc.assert(fc.asyncProperty(heldRows, async rows => {
    const clock = fakeClock();
    const deploy = fakeDeploy({ clock, secret: OTHER_SECRET });
    const table = deploy.tableOf(PREVIEW_HOST);
    for (const [at, row] of rows.entries()) await table.putIfNew(encodeKey({ initials: 'OWN', ...row, id: at.toString(16).padStart(32, '0') }));
    const before = { ...deploy.state(), 'table.rows': (await table.list()).length };
    const summary = await runSmoke(slice01Preview(), quietly(deploy, clock));
    assertStateDelta(before, { ...deploy.state(), 'table.rows': (await table.list()).length }, {
      universe: [...UNIVERSE, 'table.rows'],
      expected: { 'network.requests': normalizedTo(requests => requests.map(kindOf), [READ]) },
    });
    expect(summary.refusal).toEqual({ reason: 'no-empty-first-get', host: PREVIEW_HOST });
    expect(summary.exitCode).toBe(2);
  }), { numRuns: 20 });
});

// ---- slice 02 (DEVOPS "Preview smoke test, extended", S7-S10; Records made in Node) ----

const STEPS_A_MINUTE = 60 * 120;
// A game replays in Node from its seed to game over exactly at its length, on its deposit.
const replaysToItself = game => isDeepStrictEqual(replay(game), { over: true, steps: game.steps, deposit: game.deposit }) && game.record.steps === game.steps;
// A signing replays in Node from its own session's seed to game over exactly at its record's steps, on the deposit it
// claims: the check the deploy's dispatch makes, made here on what the run sent.
const replaysToItsClaim = ({ body }) => isDeepStrictEqual(replay({ seed: body.session.seed, record: body.record }), { over: true, steps: body.record.steps, deposit: body.score });

// The signings a run sends of the games it made, each an honest claim: S7's first (the long game, before the 60-minute
// body), S8's, and S10's burst and race.
function honestSignings(summary, requests) {
  const signingsIn = name => {
    const step = stepNamed(summary, name);
    return step ? requests.filter(isWithin(spanOf(step))).filter(request => kindOf(request) === SIGNING) : [];
  };
  return [...signingsIn('S7').slice(0, 1), ...signingsIn('S8'), ...signingsIn('S10.2'), ...signingsIn('S10.4')];
}

// Games that don't replay to what they say: another deposit, another length, or a record that runs past its game over.
const TAMPERINGS = Object.freeze({
  deposit: game => ({ ...game, deposit: game.deposit + SCORE_STEP }),
  length: game => ({ ...game, steps: game.steps + 1 }),
  record: game => ({ ...game, steps: game.steps + 1, record: { ...game.record, steps: game.steps + 1 } }),
});
const tampering = fc.option(fc.record({ at: fc.nat({ max: POOL - 1 }), how: fc.constantFrom(...Object.keys(TAMPERINGS)) }), { nil: null });

test('every game the smoke test makes in Node replays to its own deposit and length before it is signed', async () => {
  // The games the script makes, on the real rules (few runs: the 10-minute games take about 60 ms each to play, and
  // most seeds give a game of another length): scripted ones of at most 30 s with distinct deposits, bot games of 9 to
  // 11 minutes, and the recorded corpus's longest game, of 15 minutes or more. Each replays to itself.
  const corpus = await loadRecordedGames();
  const longestInTheCorpus = Math.max(...corpus.map(game => game.steps));
  const made = createNodeGames();
  await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 21 }), fc.integer({ min: 1, max: 2 }), async (scriptedCount, botCount) => {
    const scripted = await made.scripted(scriptedCount);
    const bots = await made.tenMinute(botCount);
    const long = await made.longest();
    expect({
      scripted: scripted.length, shortest: scripted.every(game => game.steps <= SCRIPTED_AT_MOST_STEPS), deposits: new Set(scripted.map(game => game.deposit)).size,
      bots: bots.length, tenMinutes: bots.every(game => game.steps >= 9 * STEPS_A_MINUTE && game.steps <= 11 * STEPS_A_MINUTE),
      long: long.steps, replay: [...scripted, ...bots, long].every(replaysToItself),
    }).toEqual({
      scripted: scriptedCount, shortest: true, deposits: scriptedCount, bots: botCount, tenMinutes: true,
      long: longestInTheCorpus, replay: true,
    });
    expect(long.steps).toBeGreaterThanOrEqual(15 * STEPS_A_MINUTE);
  }), { numRuns: 2 });
  // Through the run: whatever games it is handed, a game that doesn't replay to its own deposit and length stops the run
  // before anything is sent; otherwise every signing of a game it made replays to its claim, from its own session's seed.
  await fc.assert(fc.asyncProperty(fc.constantFrom('preview', 'burst'), tampering, latencies, async (mode, tamper, ms) => {
    const clock = fakeClock();
    const deploy = fakeDeploy({ clock, secret: OTHER_SECRET, latencies: ms });
    const run = SLICE_02_RUNS[mode];
    const before = deploy.state();
    const games = standInGames({ tamper: tamper && { at: tamper.at, how: TAMPERINGS[tamper.how] } });
    const summary = await runSmoke(run.args, quietly(deploy, clock, games));
    const stopped = tamper !== null && tamper.at >= run.uses[0] && tamper.at <= run.uses[1];
    assertStateDelta(before, deploy.state(), {
      universe: UNIVERSE,
      expected: stopped ? {} : {
        'network.requests': satisfying(`appended with ${run.honest} signings of games the run made, each replaying to its claim from its own session's seed`,
          (_, after) => {
            const honest = honestSignings(summary, after);
            return honest.length === run.honest && honest.every(replaysToItsClaim);
          }),
      },
    });
    if (stopped) expect({ error: summary.error, exitCode: summary.exitCode }).toEqual({ error: expect.stringMatching(/doesn't replay to its own deposit and length/), exitCode: 1 });
  }), { numRuns: 12 });
});

// S9's 7 signings, in order, and the answer each must get (K20 items 5-8, 10 and 11).
const S9_REFUSALS = Object.freeze({
  claimNotReplayed: { status: 400, error: 'replay-mismatch' },
  stopsBeforeGameOver: { status: 400, error: 'replay-mismatch' },
  runsPastGameOver: { status: 400, error: 'replay-mismatch' },
  malformedRecord: { status: 400, error: 'invalid-record' },
  overAnHour: { status: 400, error: 'game-too-long' },
  overTheCap: { status: 413, error: 'payload-too-large' },
  overTheCeiling: { status: 400, error: 'implausible-score' },
});
const SIGNING_CAP_BYTES = 128 * 1024;

test('the 7 refusals of S9 share one session and are each refused for their own reason', async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: STAND_IN.scripted, max: POOL - 1 }), latencies, async (scriptedAt, ms) => {
    const clock = fakeClock();
    const deploy = fakeDeploy({ clock, secret: OTHER_SECRET, latencies: ms });
    const summary = await runSmoke(slice02Preview(), quietly(deploy, clock, standInGames({ scriptedAt })));
    const s9 = stepNamed(summary, 'S9');
    const [beforeS9, afterS9] = aroundStep(deploy.state()['network.requests'], s9);
    assertStateDelta(beforeS9, afterS9, {
      universe: UNIVERSE,
      expected: {
        'network.requests': satisfying('appended with a session request for the game\'s seed, then 7 signings that all carry one session for it, the 6th of 128 KB + 1 byte',
          (old, now) => {
            const [asked, ...signed] = now.slice(old.length);
            const session = signed[0]?.body.session;
            return now.length === old.length + 8 && kindOf(asked) === SESSION && asked.body.seed === standInPool()[scriptedAt].seed
              && signed.every(request => kindOf(request) === SIGNING && isDeepStrictEqual(request.body.session, session)) && session?.seed === asked.body.seed
              && JSON.stringify(signed[5].body).length === SIGNING_CAP_BYTES + 1;
          }),
      },
    });
    expect({ outcome: s9.outcome, nothingKept: s9.nothingKept, answers: s9.answers }).toEqual({ outcome: 'pass', nothingKept: true, answers: S9_REFUSALS });
  }), { numRuns: 6 });
});

// The preview runs from slice 02, and the step whose first session request is the run's secret check.
const SECRET_CHECKS = Object.freeze([[slice02Preview(), 'S7'], [slice03Preview(), 'S11']]);

test('under --slice 02, a 500 to the first session request stops the run, and S9b\'s probe sealed with the public test secret fails it', async () => {
  // So under --slice 03, whose first session request is S11's.
  await fc.assert(fc.asyncProperty(fc.constantFrom(...SECRET_CHECKS), notASecret, latencies, async ([args, checking], secret, ms) => {
    const clock = fakeClock();
    const deploy = fakeDeploy({ clock, secret, latencies: ms, clockAllowanceMs: CLOCK_ALLOWANCE_MS });
    const before = deploy.state();
    const summary = await runSmoke(args, quietly(deploy, clock));
    assertStateDelta(before, deploy.state(), { universe: UNIVERSE, expected: { 'network.requests': normalizedTo(requests => requests.map(kindOf), [READ, SESSION]) } });
    expect(summary.steps.map(({ step, outcome, sessionStatus }) => ({ step, outcome, sessionStatus }))).toEqual([
      { step: 'S1', outcome: 'pass', sessionStatus: undefined }, { step: checking, outcome: 'fail', sessionStatus: 500 }]);
    expect(summary.error).toMatch(/SCORES_SESSION_SECRET/);
    expect(summary.exitCode).toBe(1);
  }), { numRuns: 12 });
  // The probe is a session sealed as the Netlify entry seals one, from the decoded 32 bytes of TEST_SECRET, sent with a
  // record {}. The real dispatch on a deploy whose secret is TEST_SECRET passes row 9 and answers invalid-record, which
  // fails S9b (so the run); on one with any other canonical secret it answers invalid-session, and S9b passes.
  const publicSigner = createSessionSigner(readSessionSecret(TEST_SECRET));
  await fc.assert(fc.asyncProperty(canonicalSecret, latencies, async (secret, ms) => {
    const clock = fakeClock();
    const deploy = fakeDeploy({ clock, secret, latencies: ms });
    const summary = await runSmoke(slice02Preview(), quietly(deploy, clock));
    const s9b = stepNamed(summary, 'S9b');
    const [beforeS9b, afterS9b] = aroundStep(deploy.state()['network.requests'], s9b);
    assertStateDelta(beforeS9b, afterS9b, {
      universe: UNIVERSE,
      expected: {
        'network.requests': satisfying('appended with S4b\'s session and signing, then a signing with a record {} and a session the public secret seals', (old, now) => {
          const appended = now.slice(old.length);
          const probe = appended[2]?.body;
          return appended.map(kindOf).join() === [SESSION, SIGNING, SIGNING].join() && isDeepStrictEqual(probe.record, {}) && publicSigner.verify(probe.session);
        }),
      },
    });
    const isPublic = secret === TEST_SECRET;
    expect({ outcome: s9b.outcome, publicSecret: s9b.publicSecret, probe: s9b.probe }).toEqual({
      outcome: isPublic ? 'fail' : 'pass', publicSecret: isPublic, probe: { status: 400, error: isPublic ? 'invalid-record' : 'invalid-session' } });
    if (isPublic) expect(summary.exitCode).toBe(1);
  }), { numRuns: 6, examples: [[TEST_SECRET, [1]]] });
});

// Against the real function, at a deploy's pace (each answer within 874 ms, so a pair within 1,748: under D21's
// 1,750 ms, as the user revised it on 2026-10-27, and often over its first 1,250), every step of slice 02's runs passes
// its rule, and S9c's status is recorded: the 7 MB body, refused by the function here (413), and by Netlify before the
// function on a deploy.
const quickLatencies = fc.array(fc.integer({ min: 1, max: 874 }), { minLength: 1, maxLength: 12 });
const SLICE_02_STEPS = Object.freeze({
  preview: [['S1', 'pass'], ['S7', 'pass'], ['S8', 'pass'], ['S9', 'pass'], ['S9b', 'pass'], ['S9c', 'recorded']],
  burst: [['S10.1', 'pass'], ['S10.2', 'pass'], ['S10.3', 'pass'], ['S10.4', 'pass'], ['S10.5', 'pass']],
});

test('against the real function, every step of slice 02\'s runs passes by its rule', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom('preview', 'burst'), quickLatencies, async (mode, ms) => {
    const clock = fakeClock();
    const deploy = fakeDeploy({ clock, secret: OTHER_SECRET, latencies: ms });
    const summary = await runSmoke(SLICE_02_RUNS[mode].args, quietly(deploy, clock));
    expect({ steps: summary.steps.map(({ step, outcome }) => [step, outcome]), exitCode: summary.exitCode }).toEqual({ steps: SLICE_02_STEPS[mode], exitCode: 0 });
  }), { numRuns: 6 });
});

// ---- slice 03 (DEVOPS "Preview smoke test, extended", S11-S13; D8, row 14) ----

// The unpublished check under --slice 03, Netlify's API answering with a published deploy that isn't the permalink's.
const PUBLISHED_ID = 'fedcba9876543210fedcba98';
const slice03Unpublished = () => ['--site', SITE, '--slice', '03', '--unpublished', PERMALINK, '--production', PRODUCTION, '--site-id', 'a-site-id'];
const withNetlifyApi = fetch => (url, init) => (url.startsWith('https://api.netlify.com/') ? Promise.resolve(Response.json({ published_deploy: { id: PUBLISHED_ID } })) : fetch(url, init));
const SLICE_03_RUNS = Object.freeze({
  preview: Object.freeze({ args: slice03Preview(), signings: 34, steps: [['S1', 'pass'], ['S11', 'pass'], ['S12', 'pass'], ['S13', 'pass']] }),
  unpublished: Object.freeze({ args: slice03Unpublished(), signings: 1, steps: [['U1', 'pass'], ['U2', 'pass'], ['U3', 'pass']] }),
});

// Games of every length the run may be handed: the corpus's six recorded games, of about 1½ to 15½ minutes (three of
// them outlast S13's 6½-minute session phase, so only a wait of their own length gets them signed), and 26 of the
// stand-in pool's scripted ones, of 12 to 30 s; all real, so the real dispatch replays every signing. The run is handed
// them in `order`, each call to the games port taking the next ones.
const SLICE_03_GAMES = 32;   // S11's and S12's scripted games, and S13's 30
let lengthsPool = null;
async function gamesOfEveryLength() {
  if (lengthsPool) return lengthsPool;
  const corpus = await loadRecordedGames();
  lengthsPool = [...corpus, ...standInPool().slice(0, SLICE_03_GAMES - corpus.length)];
  return lengthsPool;
}
function gamesIn(order, games) {
  let next = 0;
  const take = async count => order.slice(next, (next += count)).map(at => games[at]);
  return { scripted: take, tenMinute: take, longest: async () => (await take(1))[0] };
}
const anyOrder = fc.shuffledSubarray([...Array(SLICE_03_GAMES).keys()], { minLength: SLICE_03_GAMES, maxLength: SLICE_03_GAMES });

// Whether a signing was sent at least its game's length after its session was issued, compared in integers as the
// clock check compares (row 14), with no allowance.
const sentOnceItsGameLasted = ({ at, body }) => (at - body.session.issuedAt) * 120 >= body.record.steps * 1000;

test('no signing is sent sooner after its session than its game lasted, whatever the games\' lengths', async () => {
  // On a deploy with the clock check's real allowance (10 s), every signing but S11's two probes (signed at once: the
  // second with the local server's lenient cookies, which the function ignores) waits its own game's length after its
  // session, so the real dispatch takes every honest one: each step of slice 03's runs passes its rule, S13's 30 pairs
  // included, whatever the games' lengths and wherever they fall in the run.
  const games = await gamesOfEveryLength();
  await fc.assert(fc.asyncProperty(fc.constantFrom('preview', 'unpublished'), anyOrder, quickLatencies, async (mode, order, ms) => {
    const clock = fakeClock();
    const deploy = fakeDeploy({ clock, secret: OTHER_SECRET, latencies: ms, clockAllowanceMs: CLOCK_ALLOWANCE_MS });
    const run = SLICE_03_RUNS[mode];
    const before = deploy.state();
    const summary = await runSmoke(run.args, { ...quietly({ fetch: withNetlifyApi(deploy.fetch) }, clock, gamesIn(order, games)), env: { NETLIFY_AUTH_TOKEN: 'a-token' } });
    const s11 = stepNamed(summary, 'S11');
    const probes = s11 ? deploy.state()['network.requests'].filter(isWithin(spanOf(s11))).filter(request => kindOf(request) === SIGNING).slice(0, 2) : [];
    assertStateDelta(before, deploy.state(), {
      universe: UNIVERSE,
      expected: {
        'network.requests': satisfying(`appended with ${run.signings} signings, each sent once its game had lasted since its session, but S11's two probes, sent sooner`,
          (_, after) => {
            const signings = after.filter(request => kindOf(request) === SIGNING);
            return signings.length === run.signings && probes.every(probe => !sentOnceItsGameLasted(probe))
              && signings.filter(signing => !probes.includes(signing)).every(sentOnceItsGameLasted);
          }),
      },
    });
    expect({ steps: summary.steps.map(({ step, outcome }) => [step, outcome]), exitCode: summary.exitCode }).toEqual({ steps: run.steps, exitCode: 0 });
  }), { numRuns: 8, examples: [['preview', [...Array(SLICE_03_GAMES).keys()], [874]]] });
});

// S11's 6 requests, in order: a session, its game signed at once, again with the local server's lenient cookies, the
// local server's test route with a test-board cookie, a new session for the same game, and the game signed with it.
const S11_REQUESTS = [SESSION, SIGNING, SIGNING, 'POST /__test/rows', SESSION, SIGNING];

test('S11 signs its game at once, then with the lenient cookies, then tries the test route, then signs it under a new session', async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: STAND_IN.scripted, max: POOL - 2 }), latencies, async (scriptedAt, ms) => {
    const clock = fakeClock();
    const deploy = fakeDeploy({ clock, secret: OTHER_SECRET, latencies: ms, clockAllowanceMs: CLOCK_ALLOWANCE_MS });
    const summary = await runSmoke(slice03Preview(), quietly(deploy, clock, standInGames({ scriptedAt })));
    const [beforeS11, afterS11] = aroundStep(deploy.state()['network.requests'], stepNamed(summary, 'S11'));
    const game = [...standInPool().slice(scriptedAt, scriptedAt + 2)].sort((a, b) => b.steps - a.steps)[0];
    assertStateDelta(beforeS11, afterS11, {
      universe: UNIVERSE,
      expected: {
        'network.requests': satisfying('appended with S11\'s 6 requests for the longer of its two scripted games, the probe with test-clock=lenient and a test-board, the route with a test-board',
          (old, now) => {
            const [asked, atOnce, lenient, route, askedAgain, inTime] = now.slice(old.length);
            return now.slice(old.length).map(kindOf).join() === S11_REQUESTS.join()
              && [asked, askedAgain].every(request => request.body.seed === game.seed)
              && isDeepStrictEqual(lenient.body, atOnce.body) && atOnce.body.session.seed === game.seed && atOnce.body.score === game.deposit
              && /\btest-clock=lenient\b/.test(lenient.cookie) && /\btest-board=/.test(lenient.cookie) && /^test-board=/.test(route.cookie)
              && inTime.body.session.issuedAt > atOnce.body.session.issuedAt && isDeepStrictEqual(inTime.body.record, game.record);
          }),
      },
    });
  }), { numRuns: 6 });
});
