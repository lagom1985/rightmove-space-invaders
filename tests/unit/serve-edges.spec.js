import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { startLocalServer } from './support/local-server.js';
import { assertStateDelta } from '../common/state-delta.js';

// The local server (scripts/serve.mjs) at its edges, where Node hands it requests that reach the function differently
// on Netlify, or not at all: a path that doesn't decode, a method a Web Request can't carry (TRACE; and CONNECT, which
// Node hands to a listener of its own), and a signing whose body keeps coming. Each is answered, and the server serves
// on. One server for the file, started and stopped as Playwright's webServer is, in a TMPDIR of its own.
// Universe: whether the server still serves, and its local table as GET /api/scores shows it.

const UNIVERSE = ['server.serving', 'table.scores'];
const ANSWERS_WITHIN_MS = 5000;
const RUNS = 10;

let server, directory;

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'make-the-right-move-serve-edges-'));
  server = await startLocalServer(directory);
});

test.afterAll(async () => {
  await server?.stop();
  await rm(directory, { recursive: true, force: true });
});

async function observe() {
  const read = await fetch(server.url('/api/scores')).then(async response => ({ status: response.status, body: await response.json() }), () => null);
  return { 'server.serving': server.process.exitCode === null && read?.status === 200, 'table.scores': read?.body?.scores ?? null };
}

// One request as Node's client sends it, since fetch sends neither TRACE nor CONNECT: -> { status, headers } of the
// answer (CONNECT's arrives as a 'connect' event), or { unanswered } when the connection ends without one or none comes
// within ANSWERS_WITHIN_MS. A `body` is written and the request left open: the body keeps coming.
function send(method, path, { body } = {}) {
  return new Promise(resolve => {
    const req = request(server.url(path), { method, headers: body ? { 'content-type': 'application/json' } : {} });
    const timer = setTimeout(() => { req.destroy(); resolve({ unanswered: `no answer within ${ANSWERS_WITHIN_MS} ms` }); }, ANSWERS_WITHIN_MS);
    const answered = (response, socket = req) => {
      clearTimeout(timer);
      resolve({ status: response.statusCode, headers: response.headers });
      response.resume();
      socket.destroy();
    };
    req.on('response', response => answered(response));
    req.on('connect', (response, socket) => answered(response, socket));
    req.on('error', error => { clearTimeout(timer); resolve({ unanswered: error.code ?? error.message }); });
    if (body) req.write(body);
    else req.end();
  });
}

// Paths whose percent escapes don't decode: a lone %, a % without two hex digits after it, or bytes that aren't UTF-8.
const undecodable = fc.tuple(fc.stringMatching(/^(?:[a-z]{1,6}\/){0,2}$/), fc.constantFrom('%', '%z', '%2', '%zz', '%FF', '%C0%AF', '%E0%A4%A'))
  .map(([folders, escape]) => `/${folders}${escape}`);

test('a path that doesn\'t decode answers 400, and the server serves on', async () => {
  await fc.assert(fc.asyncProperty(undecodable, async path => {
    const before = await observe();
    expect(await send('GET', path), path).toMatchObject({ status: 400 });
    assertStateDelta(before, await observe(), { universe: UNIVERSE });
  }), { numRuns: RUNS, examples: [['/%']] });
});

// Methods the table doesn't take, those a Web Request can't carry among them.
const notReadOrSign = fc.constantFrom('TRACE', 'CONNECT', 'DELETE', 'PUT', 'PATCH', 'OPTIONS', 'HEAD', 'PROPFIND');
const REFUSED_METHOD = Object.freeze({
  status: 405, headers: { allow: 'GET, POST', 'cache-control': 'no-store', 'netlify-vary': 'query=table', 'x-content-type-options': 'nosniff' },
});

test('a method the table doesn\'t take, TRACE and CONNECT included, answers 405 with Allow and the function\'s own headers', async () => {
  await fc.assert(fc.asyncProperty(notReadOrSign, async method => {
    const before = await observe();
    expect(await send(method, '/api/scores'), method).toMatchObject(REFUSED_METHOD);
    assertStateDelta(before, await observe(), { universe: UNIVERSE });
  }), { numRuns: RUNS, examples: [['TRACE'], ['CONNECT']] });
});

// A signing past 1 KB (1,024 bytes, DDD-5) whose body hasn't ended: the function reads up to its cap and answers while
// the rest is still on its way, so the cap is how much the server reads, not only how much it keeps.
const pastTheCap = fc.integer({ min: 1025, max: 64 * 1024 });
const SIGNATURE = JSON.stringify({ initials: 'FAB', score: 1000 });

test('a signing whose body is still coming once it passes 1 KB is answered 413 there and then, and saves nothing', async () => {
  await fc.assert(fc.asyncProperty(pastTheCap, async size => {
    const before = await observe();
    const answer = await send('POST', '/api/scores', { body: SIGNATURE + ' '.repeat(size - SIGNATURE.length) });
    expect(answer).toMatchObject({ status: 413, headers: { 'cache-control': 'no-store' } });
    assertStateDelta(before, await observe(), { universe: UNIVERSE });
  }), { numRuns: 5, examples: [[1025]] });
});
