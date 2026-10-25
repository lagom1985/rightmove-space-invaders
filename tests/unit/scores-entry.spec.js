import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { getDeployStore, getStore } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import scores, { config, encodeKey } from '../../netlify/functions/scores.mjs';
import { assertStateDelta } from '../common/state-delta.js';

// The Netlify entry (the function's default export) is a composition root that only Netlify runs, so it is checked
// here, in a fake deploy environment over a real BlobsServer: the Blobs context Netlify hands a function
// (NETLIFY_BLOBS_CONTEXT: edge URLs, site ID, token, primary region and, on a deploy, the deploy ID), and a Context
// whose `deploy` says which deploy this is. The acceptance harness builds the same pieces by hand, so what is left to
// show here is that the entry chooses the store (ADR-005), opens it, wires the port and the logger, and never falls
// back to the site store.
// The universe of every state delta: the score keys in the site store and in the deploy store.

const URL = 'https://maketherightmove.fabiodamico.xyz/api/scores';
const UNIVERSE = ['site.scores', 'deploy.scores'];
const RUNS = 20;
const SITE_ROW = { initials: 'SIT', score: 1000, at: 1_767_225_600_000, id: 'site1' };
const DEPLOY_ROW = { initials: 'DEP', score: 500, at: 1_767_225_600_000, id: 'deploy1' };
const CONSOLE = ['log', 'info', 'warn', 'error', 'debug', 'trace'];

let emulator;

test.beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'make-the-right-move-scores-entry-'));
  const token = randomUUID();
  const server = new BlobsServer({ directory, token });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  emulator = { directory, server, blobs: { edgeURL: url, uncachedEdgeURL: url, siteID: 'local', token, primaryRegion: 'us-east-2' } };
  await inEnvironment(emulator.blobs, () => getStore({ name: 'leaderboard', consistency: 'strong' }).set(encodeKey(SITE_ROW), ''));
});

test.afterAll(async () => {
  await emulator.server.stop();
  await rm(emulator.directory, { recursive: true, force: true });
});

// The Blobs context as Netlify sets it for one invocation, put back as it was afterwards.
async function inEnvironment(blobs, check) {
  const original = process.env.NETLIFY_BLOBS_CONTEXT;
  process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify(blobs)).toString('base64');
  try { return await check(); } finally {
    if (original === undefined) delete process.env.NETLIFY_BLOBS_CONTEXT; else process.env.NETLIFY_BLOBS_CONTEXT = original;
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

// One GET through the entry, as Netlify would make it.
async function readThroughEntry({ deployID, context }) {
  return inEnvironment({ ...emulator.blobs, ...(deployID ? { deployID } : {}) }, async () => {
    if (deployID) await getDeployStore({ name: 'leaderboard', consistency: 'strong' }).set(encodeKey(DEPLOY_ROW), '');
    const before = await snapshot(deployID);
    const { answer, lines } = await capturingConsole(async () => readAnswer(await scores(new Request(URL), context)));
    return { answer, lines, logged: lines.map(({ text }) => JSON.parse(text)), before, after: await snapshot(deployID) };
  });
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
    const read = await readThroughEntry({ deployID, context: { ...context, deploy: { ...context.deploy, id: deployID } } });
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
  const read = await readThroughEntry({ deployID, context: { deploy: { context: 'production', published: true, id: deployID } } });
  expect(read.answer.status).toBe(200);
  expect(read.answer.body).toEqual({ scores: [shown(SITE_ROW)], listedAt: expect.any(Number) });
  expect(read.logged).toEqual([{ event: 'scores.read', reason: 'ok', ms: expect.any(Number), keys: 1, scope: 'site', context: 'production', published: true }]);
  assertStateDelta(read.before, read.after, { universe: UNIVERSE });
});

test('without a deploy ID, a deploy\'s table is unavailable: 500 unexpected, logged store-unavailable, never the site table', async () => {
  await fc.assert(fc.asyncProperty(deployContext, async context => {
    const read = await readThroughEntry({ deployID: null, context });
    expect(read.answer.status).toBe(500);
    expect(read.answer.body).toEqual({ error: 'unexpected' });
    expect(read.answer.headers['cache-control']).toBe('no-store');
    expect(read.lines.map(({ method }) => method), 'one log line per request').toEqual(['log']);
    expect(read.logged[0]).toEqual({
      event: 'scores.error', reason: 'store-unavailable', ms: expect.any(Number),
      scope: 'deploy', context: raw(context.deploy.context), published: raw(context.deploy.published),
    });
    assertStateDelta(read.before, read.after, { universe: UNIVERSE });
  }), { numRuns: RUNS, examples: [[DEPLOY_PREVIEW]] });
});

// bypass: the exported config is one literal, which Netlify reads statically.
test('the function is mounted at /api/scores, and Netlify allows each client 10 requests a minute (by IP and domain)', () => {
  expect(config).toEqual({ path: '/api/scores', rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] } });
});
