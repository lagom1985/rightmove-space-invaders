import { createHash, createHmac, randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { getDeployStore, getStore } from '@netlify/blobs';
import { startBlobsEmulator } from './support/blobs-emulator.js';
import { isAllowedInitials } from '../../src/game/high-scores.js';
import scores, { config, decodeKey, encodeKey } from '../../netlify/functions/scores.mjs';
import { assertStateDelta, satisfying } from '../common/state-delta.js';

// The Netlify entry (the function's default export) is a composition root that only Netlify runs, so it is checked
// here, in a fake deploy environment over a real BlobsServer: the Blobs context Netlify hands a function
// (NETLIFY_BLOBS_CONTEXT: edge URLs, site ID, token, primary region and, on a deploy, the deploy ID), the session secret
// its environment holds (SCORES_SESSION_SECRET, DDD-R2), and a Context whose `deploy` says which deploy this is. The
// acceptance harness builds the same pieces by hand, so what is left to show here is that the entry chooses the store
// (ADR-005), opens it, wires the port and the logger, never falls back to the site store, builds its session signer from
// a canonical secret's 32 bytes and none from anything else, and dispatches by path: /api/sessions to the session
// request, /api/scores to the table (DDD-R1), and nothing else, the local server's test route and cookies included.
// The universe of every state delta: the score keys in the site store and in the deploy store.

const ORIGIN = 'https://maketherightmove.fabiodamico.xyz';
const SCORES_PATH = '/api/scores';
const SESSIONS_PATH = '/api/sessions';
const UNIVERSE = ['site.scores', 'deploy.scores'];
const RUNS = 20;
const SITE_ROW = { initials: 'SIT', score: 1000, at: 1_767_225_600_000, id: 'site1' };
const DEPLOY_ROW = { initials: 'DEP', score: 500, at: 1_767_225_600_000, id: 'deploy1' };
const CONSOLE = ['log', 'info', 'warn', 'error', 'debug', 'trace'];

let emulator, blobs;

test.beforeAll(async () => {
  emulator = await startBlobsEmulator('scores-entry');
  blobs = { ...emulator.context, primaryRegion: 'us-east-2' };
  await inEnvironment(blobs, () => getStore({ name: 'leaderboard', consistency: 'strong' }).set(encodeKey(SITE_ROW), ''));
});

test.afterAll(() => emulator.stop());

// The environment as Netlify sets it for one invocation: the Blobs context and the session secret (none when
// undefined), each put back as it was afterwards.
async function inEnvironment(blobs, check, secret = undefined) {
  const set = { NETLIFY_BLOBS_CONTEXT: Buffer.from(JSON.stringify(blobs)).toString('base64'), SCORES_SESSION_SECRET: secret };
  const originals = Object.keys(set).map(name => [name, process.env[name]]);
  const put = (name, value) => { if (value === undefined) delete process.env[name]; else process.env[name] = value; };
  for (const [name, value] of Object.entries(set)) put(name, value);
  try { return await check(); } finally {
    for (const [name, original] of originals) put(name, original);
  }
}

// Every console method is captured, so a line on any of them is seen (DDD-17: the entry's logger is the console).
async function capturingConsole(call) {
  const lines = [];
  const originals = CONSOLE.map(method => [method, console[method]]);
  for (const method of CONSOLE) console[method] = (...args) => lines.push({ method, text: args.join(' ') });
  try { return { answer: await call(), lines }; } finally {
    for (const [method, original] of originals) console[method] = original;
  }
}

async function readAnswer(response) {
  return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.json() };
}

// What is in each store, read straight from the emulator (never through the entry).
async function snapshot(deployID) {
  const keys = async store => (await store.list()).blobs.map(blob => blob.key).sort();
  return {
    'site.scores': await keys(getStore({ name: 'leaderboard', consistency: 'strong' })),
    'deploy.scores': deployID ? await keys(getDeployStore({ name: 'leaderboard', deployID, consistency: 'strong' })) : [],
  };
}

// One request through the entry, as Netlify would make it: a GET of the table unless said otherwise, a JSON body if
// one is given, the cookies if any are given, and the session secret if one is given.
async function requestThroughEntry({ deployID, context, method = 'GET', path = SCORES_PATH, body, cookie, secret }) {
  return inEnvironment({ ...blobs, ...(deployID ? { deployID } : {}) }, async () => {
    if (deployID) await getDeployStore({ name: 'leaderboard', consistency: 'strong' }).set(encodeKey(DEPLOY_ROW), '');
    const before = await snapshot(deployID);
    const headers = { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) };
    const init = body === undefined ? { method, headers } : { method, headers, body: JSON.stringify(body) };
    const { answer, lines } = await capturingConsole(async () => readAnswer(await scores(new Request(`${ORIGIN}${path}`, init), context)));
    return { answer, lines, logged: lines.map(({ text }) => JSON.parse(text)), before, after: await snapshot(deployID) };
  }, secret);
}

const shown = ({ initials, score, id }) => ({ initials, score, id });
const raw = value => value ?? 'missing';
const deployId = fc.stringMatching(/^[a-f0-9]{24}$/);

// Contexts that are not the published production deploy, with raw values a log line can carry as they are.
const value = fc.oneof(fc.constantFrom('production', 'Production', 'deploy-preview', 'branch-deploy', 'dev', 'true'), fc.boolean(), fc.integer(), fc.constant(undefined));
const deployContext = fc.record({ context: value, published: value }, { requiredKeys: [] })
  .filter(deploy => !(deploy.context === 'production' && deploy.published === true))
  .map(deploy => ({ deploy }));
const DEPLOY_PREVIEW = { deploy: { context: 'deploy-preview', published: false } };

test('on any deploy but the published production one, the entry reads that deploy\'s own table and logs scope deploy with the raw context', async () => {
  await fc.assert(fc.asyncProperty(deployId, deployContext, async (deployID, context) => {
    const read = await requestThroughEntry({ deployID, context: { ...context, deploy: { ...context.deploy, id: deployID } } });
    expect(read.answer.status).toBe(200);
    expect(read.answer.body).toEqual({ scores: [shown(DEPLOY_ROW)], listedAt: expect.any(Number) });
    expect(read.lines.map(({ method }) => method), 'one log line per request').toEqual(['log']);
    expect(read.logged[0]).toEqual({
      event: 'scores.read', reason: 'ok', ms: expect.any(Number), keys: 1,
      scope: 'deploy', context: raw(context.deploy.context), published: raw(context.deploy.published),
    });
    assertStateDelta(read.before, read.after, { universe: UNIVERSE });
  }), { numRuns: RUNS, examples: [['6720a1b2c3d4e5f6a7b8c9d0', DEPLOY_PREVIEW]] });
});

// bypass: exactly one context reaches the site store (ADR-005), so there is one case to show.
test('on the published production deploy, the entry reads the site-wide table and logs scope site', async () => {
  const deployID = '6720a1b2c3d4e5f6a7b8c9d1';
  const read = await requestThroughEntry({ deployID, context: { deploy: { context: 'production', published: true, id: deployID } } });
  expect(read.answer.status).toBe(200);
  expect(read.answer.body).toEqual({ scores: [shown(SITE_ROW)], listedAt: expect.any(Number) });
  expect(read.logged).toEqual([{ event: 'scores.read', reason: 'ok', ms: expect.any(Number), keys: 1, scope: 'site', context: 'production', published: true }]);
  assertStateDelta(read.before, read.after, { universe: UNIVERSE });
});

// Each path's request, and the event its log line is filed under (DDD-R14).
const READING = Object.freeze({ request: {}, event: 'scores.error' });
const ASKING = Object.freeze({ request: { method: 'POST', path: SESSIONS_PATH, body: { seed: '0123456789abcdef0123456789abcdef' } }, event: 'sessions.error' });

test('without a deploy ID, a deploy\'s table is unavailable on either path: 500 unexpected, logged store-unavailable, never the site table', async () => {
  await fc.assert(fc.asyncProperty(deployContext, fc.constantFrom(READING, ASKING), async (context, { request, event }) => {
    const read = await requestThroughEntry({ deployID: null, context, ...request });
    expect(read.answer.status).toBe(500);
    expect(read.answer.body).toEqual({ error: 'unexpected' });
    expect(read.answer.headers['cache-control']).toBe('no-store');
    expect(read.lines.map(({ method }) => method), 'one log line per request').toEqual(['log']);
    expect(read.logged[0]).toEqual({
      event, reason: 'store-unavailable', ms: expect.any(Number),
      scope: 'deploy', context: raw(context.deploy.context), published: raw(context.deploy.published),
    });
    assertStateDelta(read.before, read.after, { universe: UNIVERSE });
  }), { numRuns: RUNS, examples: [[DEPLOY_PREVIEW, READING], [DEPLOY_PREVIEW, ASKING]] });
});

// The table can only be read or signed (DDD-6), and a session can only be asked for (DDD-R1): the entry says so before
// it opens a store. Without a deploy ID there is none to open, and a method its path doesn't take is still refused for
// what it is, logged under its path's event.
const notReadOrSign = fc.constantFrom('DELETE', 'PUT', 'PATCH', 'OPTIONS', 'HEAD', 'PROPFIND');
const notAsking = fc.constantFrom('GET', 'DELETE', 'PUT', 'PATCH', 'OPTIONS', 'HEAD', 'PROPFIND');
const SCORES_TAKE = Object.freeze({ path: SCORES_PATH, allow: 'GET, POST', event: 'scores.rejected' });
const SESSIONS_TAKE = Object.freeze({ path: SESSIONS_PATH, allow: 'POST', event: 'sessions.rejected' });
const refusedMethod = fc.oneof(
  fc.record({ takes: fc.constant(SCORES_TAKE), method: notReadOrSign }),
  fc.record({ takes: fc.constant(SESSIONS_TAKE), method: notAsking }),
);

test('without a deploy ID, a method its path doesn\'t take is refused 405 with Allow, logged as such, before any store is opened', async () => {
  await fc.assert(fc.asyncProperty(refusedMethod, deployContext, async ({ takes, method }, context) => {
    const read = await requestThroughEntry({ deployID: null, context, method, path: takes.path });
    expect(read.answer.status).toBe(405);
    expect(read.answer.headers).toMatchObject({ allow: takes.allow, 'cache-control': 'no-store' });
    expect(read.answer.body).toEqual({ error: 'method-not-allowed' });
    expect(read.lines.map(({ method: logged }) => logged), 'one log line per request').toEqual(['log']);
    expect(read.logged[0]).toEqual({
      event: takes.event, reason: 'method-not-allowed', ms: expect.any(Number),
      scope: 'deploy', context: raw(context.deploy.context), published: raw(context.deploy.published),
    });
    assertStateDelta(read.before, read.after, { universe: UNIVERSE });
  }), { numRuns: RUNS, examples: [[{ takes: SCORES_TAKE, method: 'DELETE' }, DEPLOY_PREVIEW], [{ takes: SESSIONS_TAKE, method: 'GET' }, DEPLOY_PREVIEW]] });
});

// ---- the session secret and the two paths (DDD-R1, DDD-R2) ----
// A deploy of its own for every run, so no run sees another's rows.
const freshDeployId = () => randomBytes(12).toString('hex');
const previewOf = deployID => ({ deploy: { context: 'deploy-preview', published: false, id: deployID } });
const PREVIEW_LOGGED = Object.freeze({ scope: 'deploy', context: 'deploy-preview', published: false });
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const replaceAt = (text, at, char) => `${text.slice(0, at)}${char}${text.slice(at + 1)}`;

const seed = fc.stringMatching(/^[0-9a-f]{32}$/);
// Never on the word filter, and never above the plausible ceiling: these signings are all to be saved.
const signature = fc.record({ initials: fc.stringMatching(/^[A-Z]{3}$/).filter(isAllowedInitials), score: fc.integer({ min: 1, max: 2000 }).map(units => units * 50) });
// 32 bytes in canonical base64, as the owner sets it: 43 characters and one '='.
const canonicalSecret = fc.uint8Array({ minLength: 32, maxLength: 32 }).map(bytes => Buffer.from(bytes).toString('base64'));
// Everything else a secret's value can be: not set, empty or a word, another number of bytes, the padding dropped,
// whitespace around it, the base64url alphabet, or non-zero bits in the last character's unused two (the same bytes).
const notCanonicalSecret = fc.oneof(
  fc.constantFrom(undefined, '', 'secret'),
  fc.uint8Array({ maxLength: 64 }).filter(bytes => bytes.length !== 32).map(bytes => Buffer.from(bytes).toString('base64')),
  canonicalSecret.map(text => text.slice(0, -1)),
  canonicalSecret.map(text => ` ${text}\n`),
  canonicalSecret.map(text => `${Buffer.from(text, 'base64').toString('base64url')}=`).filter(text => /[-_]/.test(text)),
  fc.tuple(canonicalSecret, fc.integer({ min: 1, max: 3 })).map(([text, bits]) => replaceAt(text, 42, BASE64[BASE64.indexOf(text[42]) ^ bits])),
);
// What a root's signer computes from a secret's 32 bytes (DDD-R2, C1), here on its own, never by the code under test.
const sealOf = (secret, game, issuedAt) => createHmac('sha256', Buffer.from(secret, 'base64')).update(`v1.${game}.${issuedAt}`).digest('base64url');
const gameIdOf = game => createHash('sha256').update(game).digest('hex').slice(0, 32);

test('with a canonical secret, the entry issues a session sealed with its 32 bytes at /api/sessions, and saves a signing that carries it at /api/scores, as its game\'s row', async () => {
  await fc.assert(fc.asyncProperty(canonicalSecret, seed, signature, async (secret, game, signed) => {
    const deployID = freshDeployId();
    const context = previewOf(deployID);
    const asked = await requestThroughEntry({ deployID, context, secret, method: 'POST', path: SESSIONS_PATH, body: { seed: game } });
    expect(asked.answer.status, 'the session request').toBe(200);
    expect(asked.answer.headers['cache-control']).toBe('no-store');
    const { session, scores: rows } = asked.answer.body;
    expect(session).toEqual({ seed: game, issuedAt: expect.any(Number), token: sealOf(secret, game, session.issuedAt) });
    expect(rows, 'the deploy\'s own table comes with the session').toEqual([shown(DEPLOY_ROW)]);
    expect(asked.logged).toEqual([{ event: 'sessions.issued', reason: 'ok', ms: expect.any(Number), ...PREVIEW_LOGGED }]);
    assertStateDelta(asked.before, asked.after, { universe: UNIVERSE });

    const signing = await requestThroughEntry({ deployID, context, secret, method: 'POST', body: { ...signed, session } });
    expect(signing.answer.status, 'the signing').toBe(200);
    expect(signing.answer.body.id, 'the new row\'s id is its game id').toBe(gameIdOf(game));
    expect(signing.logged).toEqual([{ event: 'scores.signed', reason: 'ok', ms: expect.any(Number), keys: 2, ...PREVIEW_LOGGED }]);
    assertStateDelta(signing.before, signing.after, {
      universe: UNIVERSE,
      expected: {
        'deploy.scores': satisfying('the game\'s own row added to the deploy\'s table, nothing removed', (was, now) => {
          const added = now.filter(key => !was.includes(key)).map(decodeKey);
          return was.every(key => now.includes(key)) && added.length === 1
            && added[0].id === gameIdOf(game) && added[0].initials === signed.initials && added[0].score === signed.score;
        }),
      },
    });
  }), { numRuns: RUNS });
});

test('with no secret, or one that isn\'t canonical base64 of 32 bytes, the entry builds no signer: no signing is saved (500 secret-missing) and no session is issued, each logged once', async () => {
  await fc.assert(fc.asyncProperty(notCanonicalSecret, canonicalSecret, seed, signature, async (secret, sealedWith, game, signed) => {
    const deployID = freshDeployId();
    const context = previewOf(deployID);
    const session = { seed: game, issuedAt: SITE_ROW.at, token: sealOf(sealedWith, game, SITE_ROW.at) };
    const signing = await requestThroughEntry({ deployID, context, secret, method: 'POST', body: { ...signed, session } });
    expect(signing.answer.status, 'the signing').toBe(500);
    expect(signing.answer.body).toEqual({ error: 'unexpected' });
    expect(signing.logged).toEqual([{ event: 'scores.error', reason: 'secret-missing', ms: expect.any(Number), ...PREVIEW_LOGGED }]);
    assertStateDelta(signing.before, signing.after, { universe: UNIVERSE });

    const asked = await requestThroughEntry({ deployID, context, secret, method: 'POST', path: SESSIONS_PATH, body: { seed: game } });
    expect(asked.answer.status, 'the session request').toBe(500);
    expect(asked.answer.body).toEqual({ error: 'unexpected' });
    expect(asked.logged).toEqual([{ event: 'sessions.error', reason: 'secret-missing', ms: expect.any(Number), ...PREVIEW_LOGGED }]);
    assertStateDelta(asked.before, asked.after, { universe: UNIVERSE });
  }), { numRuns: RUNS, examples: [[undefined, Buffer.alloc(32, 1).toString('base64'), '0123456789abcdef0123456789abcdef', { initials: 'FAB', score: 1000 }]] });
});

// ---- the local server's test route and test cookies: they exist only there (DDD-R17, E1) ----
// On Netlify config.path keeps every other path from the function; one that reaches the entry anyway is answered 404
// before a store is opened, so no row is written however the request is dressed. The cookies the local server reads
// for its test boards and lenient clock mean nothing to the entry.
const TEST_ROWS_PATH = '/__test/rows';
const TEST_COOKIES = Object.freeze(['test-board=a-test-board', 'test-clock=lenient']);
const testCookies = fc.subarray([...TEST_COOKIES], { minLength: 1 }).map(cookies => cookies.join('; '));

test('a POST /__test/rows to the entry is refused 404 before any store is opened, writes no row and is logged once, test cookies or not', async () => {
  await fc.assert(fc.asyncProperty(fc.option(deployId, { nil: null }), deployContext, signature, fc.option(testCookies, { nil: undefined }), async (deployID, context, row, cookie) => {
    const sent = await requestThroughEntry({ deployID, context, method: 'POST', path: TEST_ROWS_PATH, body: row, cookie });
    expect(sent.answer.status).toBe(404);
    expect(sent.answer.body).toEqual({ error: 'not-found' });
    expect(sent.answer.headers['cache-control']).toBe('no-store');
    expect(sent.lines.map(({ method }) => method), 'one log line per request').toEqual(['log']);
    expect(sent.logged[0]).toEqual({
      event: 'scores.rejected', reason: 'not-found', ms: expect.any(Number),
      scope: 'deploy', context: raw(context.deploy.context), published: raw(context.deploy.published),
    });
    assertStateDelta(sent.before, sent.after, { universe: UNIVERSE });
  }), { numRuns: RUNS, examples: [[null, DEPLOY_PREVIEW, { initials: 'FAB', score: 1000 }, TEST_COOKIES.join('; ')]] });
});

// Each request a game or the local harness sends; a signing carries the session its deploy issued it first.
const ASKING_FOR = game => ({ method: 'POST', path: SESSIONS_PATH, body: { seed: game } });
const SENT = Object.freeze({
  'a read': () => ({}),
  'a session request': ({ game }) => ASKING_FOR(game),
  'a signing': ({ signed, session }) => ({ method: 'POST', body: { ...signed, session } }),
  'a test row': ({ signed }) => ({ method: 'POST', path: TEST_ROWS_PATH, body: signed }),
});
// What moves with the clock is left out of an answer (listedAt, a session's issuedAt and the token sealing it) and of
// a log line (ms), and a row's time out of a store's change: what is left must not depend on the cookies.
const MOVES_WITH_THE_CLOCK = new Set(['listedAt', 'issuedAt', 'token']);
const timeless = body => JSON.parse(JSON.stringify(body, (key, value) => (MOVES_WITH_THE_CLOCK.has(key) ? typeof value : value)));
const rowsOf = keys => keys.map(decodeKey).map(shown);
const changeOf = (was, now) => ({ added: rowsOf(now.filter(key => !was.includes(key))), removed: rowsOf(was.filter(key => !now.includes(key))) });

// The request of that kind on a fresh preview deploy, with the cookies if any are given.
async function sentOnAFreshDeploy(kind, { secret, game, signed }, cookie) {
  const deployID = freshDeployId();
  const context = previewOf(deployID);
  const session = kind === 'a signing' ? (await requestThroughEntry({ deployID, context, secret, ...ASKING_FOR(game) })).answer.body.session : undefined;
  const sent = await requestThroughEntry({ deployID, context, secret, cookie, ...SENT[kind]({ game, signed, session }) });
  return { ...sent, answer: { ...sent.answer, body: timeless(sent.answer.body) }, logged: sent.logged.map(({ ms, ...line }) => line) };
}

test('a request carrying test-board or test-clock cookies gets the same answer, store change and log line from the entry as without them', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom(...Object.keys(SENT)), testCookies, canonicalSecret, seed, signature, async (kind, cookie, secret, game, signed) => {
    const plain = await sentOnAFreshDeploy(kind, { secret, game, signed });
    const dressed = await sentOnAFreshDeploy(kind, { secret, game, signed }, cookie);
    expect(dressed.answer, `${kind}: the answer`).toEqual(plain.answer);
    expect(dressed.logged, `${kind}: the log line`).toEqual(plain.logged);
    const asWithout = slot => satisfying('the same rows added and removed as without the cookies', (was, now) =>
      isDeepStrictEqual(changeOf(was, now), changeOf(plain.before[slot], plain.after[slot])));
    assertStateDelta(dressed.before, dressed.after, { universe: UNIVERSE, expected: Object.fromEntries(UNIVERSE.map(slot => [slot, asWithout(slot)])) });
  }), { numRuns: RUNS, examples: [['a signing', TEST_COOKIES.join('; '), Buffer.alloc(32, 1).toString('base64'), '0123456789abcdef0123456789abcdef', { initials: 'FAB', score: 1000 }]] });
});

// bypass: the exported config is one literal, which Netlify reads statically.
test('the function is mounted at /api/scores and /api/sessions, and Netlify allows each client 10 requests a minute on the two together (by IP and domain)', () => {
  expect(config).toEqual({ path: ['/api/scores', '/api/sessions'], rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] } });
});
