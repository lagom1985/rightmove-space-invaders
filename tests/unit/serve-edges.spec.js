import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { startLocalServer } from './support/local-server.js';
import { assertStateDelta } from '../common/state-delta.js';

// The local server (scripts/serve.mjs) at its edges, where Node hands it requests that reach the function differently
// on Netlify, or not at all: a path that doesn't decode, a method a Web Request can't carry (TRACE; and CONNECT, which
// Node hands to a listener of its own), and a signing whose body keeps coming; and the files it serves, an allow-list
// (PL-11). Each is answered, and the server serves on. One server for the file, started and stopped as Playwright's
// webServer is, in a TMPDIR of its own.
// Universe: whether the server still serves, and its local table as GET /api/scores shows it.

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
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

// Methods a path of the function doesn't take, those a Web Request can't carry among them: the table takes GET and
// POST, the session request POST alone (01-03).
const TAKES = Object.freeze({ '/api/scores': ['GET', 'POST'], '/api/sessions': ['POST'] });
const METHODS = ['GET', 'POST', 'TRACE', 'CONNECT', 'DELETE', 'PUT', 'PATCH', 'OPTIONS', 'HEAD', 'PROPFIND'];
const notTaken = fc.constantFrom(...Object.keys(TAKES))
  .chain(path => fc.constantFrom(...METHODS.filter(method => !TAKES[path].includes(method))).map(method => ({ path, method })));
const refusedMethod = path => ({
  status: 405, headers: { allow: TAKES[path].join(', '), 'cache-control': 'no-store', 'netlify-vary': 'query=table', 'x-content-type-options': 'nosniff' },
});

test('a method a path of the function doesn\'t take, TRACE and CONNECT included, answers 405 with Allow and the function\'s own headers', async () => {
  await fc.assert(fc.asyncProperty(notTaken, async ({ path, method }) => {
    const before = await observe();
    expect(await send(method, path), `${method} ${path}`).toMatchObject(refusedMethod(path));
    assertStateDelta(before, await observe(), { universe: UNIVERSE });
  }), {
    numRuns: RUNS,
    examples: [[{ path: '/api/scores', method: 'TRACE' }], [{ path: '/api/scores', method: 'CONNECT' }],
      [{ path: '/api/sessions', method: 'TRACE' }], [{ path: '/api/sessions', method: 'CONNECT' }], [{ path: '/api/sessions', method: 'GET' }]],
  });
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

// A GET for the path exactly as written, `..` and all (fetch and request(url) resolve dot segments before they send):
// -> { status, body } with the body as bytes.
function getAsWritten(path) {
  const { hostname, port } = new URL(server.url('/'));
  return new Promise((resolve, reject) => {
    request({ hostname, port, path }, async response => {
      const chunks = [];
      for await (const chunk of response) chunks.push(chunk);
      resolve({ status: response.statusCode, body: Buffer.concat(chunks) });
    }).on('error', reject).end();
  });
}

// What the local server serves as a file (PL-11): index.html, src/** and the test fixture pages the browsers load
// (tests/e2e/*/acceptance/fixtures/*.html), and never a path with a segment starting with '.', so a local .env never
// is. Everything else answers as a missing file does: 404 Not found.
const NOT_FOUND = Object.freeze({ status: 404, body: 'Not found' });
// Files in the checkout that the list leaves out, all committed but the dependency: the server's own code, the
// function, the tests and their public secret, the docs, a dependency, and dotfiles.
const OUTSIDE = [
  '/package.json', '/README.md', '/CLAUDE.md', '/netlify.toml', '/playwright.config.js', '/scripts/serve.mjs',
  '/netlify/functions/scores.mjs', '/netlify/scores/sessions.mjs', '/tests/common/session-secret.js',
  '/tests/unit/serve-edges.spec.js', '/tests/e2e/rightmove-invaders-leaderboard/acceptance/milestone-1-reading-the-table.feature',
  '/tests/e2e/rightmove-invaders-sound/acceptance/steps/game-driver.js', '/tests/fixtures/recorded-games/README.md',
  '/docs/product/architecture/brief.md', '/node_modules/@netlify/blobs/package.json',
  '/.gitignore', '/.nwave/local-config.json', '/.claude/launch.json',
];
const SERVED_FOLDERS = Object.freeze({ '/src/': 1, '/src/game/': 2, '/src/sound/': 2, '/tests/e2e/rightmove-invaders-sound/acceptance/fixtures/': 5 });
// One such file as it is, or reached from a served folder by climbing out of it through escaped slashes.
const climb = fc.constantFrom('..%2f', '..%2F', '%2e%2e%2f', '.%2E%2F');
const outsideFile = fc.oneof(
  fc.constantFrom(...OUTSIDE),
  fc.tuple(fc.constantFrom(...Object.entries(SERVED_FOLDERS)), fc.constantFrom(...OUTSIDE), climb)
    .map(([[folder, depth], file, up]) => folder + up.repeat(depth) + file.slice(1)),
);
// A segment starting with '.' anywhere in a path the list would otherwise take.
const segment = fc.stringMatching(/^[A-Za-z0-9_-]{1,8}$/);
const dotted = fc.tuple(fc.constantFrom('/', '/src/', '/src/game/'), segment, fc.constantFrom('', '/main.js', '/x.html'))
  .map(([folder, name, rest]) => `${folder}.${name}${rest}`);
// Any other path: a few segments that start neither at src/ nor at index.html.
const elsewhere = fc.array(fc.stringMatching(/^[A-Za-z0-9_-]{1,8}(?:\.[a-z]{1,4})?$/), { minLength: 1, maxLength: 4 })
  .filter(([first]) => first !== 'src' && first !== 'index.html')
  .map(segments => `/${segments.join('/')}`);

test('the local server answers 404 for any path outside its allow-list or with a dotfile segment, and serves no file', async () => {
  await fc.assert(fc.asyncProperty(fc.oneof(outsideFile, dotted, elsewhere), async path => {
    const before = await observe();
    const { status, body } = await getAsWritten(path);
    expect({ status, body: body.toString('utf8') }, path).toEqual(NOT_FOUND);
    assertStateDelta(before, await observe(), { universe: UNIVERSE });
  }), { numRuns: 3 * RUNS, examples: [['/package.json'], ['/.gitignore'], ['/src/..%2fpackage.json'], ['/src/game/..%2f..%2ftests/common/session-secret.js']] });
});

// What the list takes is served as it is on disk: the game's page at / and /index.html, every file under src/, and
// the fixture pages.
const SERVED = [
  '/', '/index.html',
  ...readdirSync(join(ROOT, 'src'), { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
    .map(entry => `/${join(entry.parentPath, entry.name).slice(ROOT.length)}`).filter(path => !path.includes('/.')),
  '/tests/e2e/rightmove-invaders-sound/acceptance/fixtures/synth-host.html',
  '/tests/e2e/rightmove-invaders-replay-verified-scores/acceptance/fixtures/replay-host.html',
];
const onDisk = path => readFileSync(join(ROOT, path === '/' ? 'index.html' : path));

test('index.html, every file under src/ and the fixture pages are served as they are on disk', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom(...SERVED), async path => {
    const { status, body } = await getAsWritten(path);
    expect(status, path).toBe(200);
    expect(body.equals(onDisk(path)), `${path} served as on disk`).toBe(true);
  }), { numRuns: 3 * RUNS, examples: [['/'], ['/src/main.js']] });
});
