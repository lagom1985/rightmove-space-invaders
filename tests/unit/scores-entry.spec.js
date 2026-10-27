import { createHash, createHmac, randomBytes } from 'node:crypto';
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
// request, /api/scores to the table (DDD-R1).
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
// one is given, and the session secret if one is given.
async function requestThroughEntry({ deployID, context, method = 'GET', path = SCORES_PATH, body, secret }) {
  return inEnvironment({ ...blobs, ...(deployID ? { deployID } : {}) }, async () => {
    if (deployID) await getDeployStore({ name: 'leaderboard', consistency: 'strong' }).set(encodeKey(DEPLOY_ROW), '');
    const before = await snapshot(deployID);
    const init = body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
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

// The table can only be read or signed (DDD-6), and the entry says so before it opens a store: without a deploy ID
// there is none to open, and a method the table doesn't take is still refused for what it is.
const notReadOrSign = fc.constantFrom('DELETE', 'PUT', 'PATCH', 'OPTIONS', 'HEAD', 'PROPFIND');

test('without a deploy ID, a method the table doesn\'t take is refused 405 with Allow, logged as such, before any store is opened', async () => {
  await fc.assert(fc.asyncProperty(notReadOrSign, deployContext, async (method, context) => {
    const read = await requestThroughEntry({ deployID: null, context, method });
    expect(read.answer.status).toBe(405);
    expect(read.answer.headers).toMatchObject({ allow: 'GET, POST', 'cache-control': 'no-store' });
    expect(read.answer.body).toEqual({ error: 'method-not-allowed' });
    expect(read.lines.map(({ method: logged }) => logged), 'one log line per request').toEqual(['log']);
    expect(read.logged[0]).toEqual({
      event: 'scores.rejected', reason: 'method-not-allowed', ms: expect.any(Number),
      scope: 'deploy', context: raw(context.deploy.context), published: raw(context.deploy.published),
    });
    assertStateDelta(read.before, read.after, { universe: UNIVERSE });
  }), { numRuns: RUNS, examples: [['DELETE', DEPLOY_PREVIEW]] });
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
    expect(asked.logged.map(({ event }) => event), 'one log line per request').toEqual(['sessions.error']);
    assertStateDelta(asked.before, asked.after, { universe: UNIVERSE });
  }), { numRuns: RUNS, examples: [[undefined, Buffer.alloc(32, 1).toString('base64'), '0123456789abcdef0123456789abcdef', { initials: 'FAB', score: 1000 }]] });
});

// bypass: the exported config is one literal, which Netlify reads statically.
test('the function is mounted at /api/scores and /api/sessions, and Netlify allows each client 10 requests a minute on the two together (by IP and domain)', () => {
  expect(config).toEqual({ path: ['/api/scores', '/api/sessions'], rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] } });
});
