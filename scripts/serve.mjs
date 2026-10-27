// Local server for play and the acceptance tests: the game's static files, plus the high-score table at /api/scores
// and a game's session request at /api/sessions. ES modules don't load from file:// URLs, so the game has to be served
// over http.
// The table is the real Netlify Function's handlers (netlify/functions/scores.mjs) behind its restricted port, and the
// real @netlify/blobs client, against the Blobs emulator in a fresh temporary directory, so every start begins with
// empty tables and needs no Netlify account. Each `test-board` cookie gets a table of its own (tests run side by side);
// without one, the table is `local`. This is a composition root: it chooses the store, builds the port and the session
// signer, and dispatches as the Netlify entry does, handing each handler its part, the clock and its allowance, the
// logger and where the table is kept (scope local). Its secret is 32 random bytes of its own at each start, never
// production's (DDD-R2, E1).
// For the tests only, a test board can also be handed rows without a game (POST /__test/rows, DDD-R17).
import { STATUS_CODES, createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStore } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import {
  CLOCK_ALLOWANCE_MS, EVERY_ANSWER, createTablePort, dispatch, encodeKey, logToConsole, newId, refuseBeforeTheTable,
} from '../netlify/functions/scores.mjs';
import { createSessionSigner } from '../netlify/scores/sessions.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT) || 4173;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const BOARD = /(?:^|;\s*)test-board=([a-z0-9-]{1,40})(?:;|$)/;
const SESSIONS_PATH = '/api/sessions';
const TABLE_PATHS = Object.freeze(['/api/scores', SESSIONS_PATH]);
const TEST_ROWS = '/__test/rows';
// What this root knows about where the table is kept (DDD-17): locally, and no deploy at all.
const LOCAL = Object.freeze({ scope: 'local', context: 'missing', published: 'missing' });
// The production clock, its allowance and the production logger.
const tableOptions = Object.freeze({ now: Date.now, log: logToConsole, where: LOCAL, clockAllowanceMs: CLOCK_ALLOWANCE_MS });
const signer = createSessionSigner(randomBytes(32));
const STOP_WITHIN_MS = 1000;   // a request still in flight can hold the emulator open; the directory goes regardless

// The Blobs client finds the emulator through this context. Strong consistency needs `uncachedEdgeURL` as well.
async function startBlobs() {
  const token = randomUUID();
  const directory = await mkdtemp(join(tmpdir(), 'make-the-right-move-blobs-'));
  const blobs = new BlobsServer({ directory, token });
  removeWhenStopped(blobs, directory);
  const { address } = await blobs.start();
  const context = { edgeURL: address, uncachedEdgeURL: address, siteID: 'local', token };
  process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify(context)).toString('base64');
}

// The emulator's directory is deleted when the server stops: on exit, SIGINT or SIGTERM (DDD-16). Only this server's own
// directory, and never at start-up: a sweep could delete a side-by-side checkout's live one. `npm start` relays the
// signal it gets, so a signal sent to the process group arrives twice: the server keeps listening while it stops, as
// a signal nobody listens for would end the process before the directory is deleted.
function removeWhenStopped(blobs, directory) {
  process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
  let stopping = null;
  const stop = () => { stopping ??= Promise.race([blobs.stop(), delay(STOP_WITHIN_MS)]).finally(() => process.exit(0)); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
}

const boardOf = req => BOARD.exec(req.headers.cookie ?? '')?.[1] ?? null;

function storeFor(req) {
  return getStore({ name: `leaderboard-${boardOf(req) ?? 'local'}`, consistency: 'strong' });
}

// Node request -> Web Request -> the function -> Node response, with the function's own headers (DDD-6). A method its
// path doesn't take is refused first, as on Netlify, and before a Request is built: one can't carry TRACE.
async function serveTable(path, req, res) {
  const refused = refuseBeforeTheTable(path, req.method, tableOptions);
  if (refused) return send(res, refused);
  const body = req.method === 'POST' ? bodyOf(req) : undefined;
  const request = new Request(new URL(req.url, `http://localhost:${port}`), { method: req.method, headers: req.headers, body, duplex: 'half' });
  return send(res, await dispatch(request, createTablePort(storeFor(req)), tableOptions, signer));
}

// Another house-hunter's row on a test board, with no game (DDD-R17): { initials, score } written as one key through
// that board's port, with a random id. Only the port's own check of the key's shape stands in its way, so no ceiling.
// The function has no such route.
async function putRow(req, res) {
  const { initials, score } = JSON.parse(await textOf(req));
  const id = newId();
  const saved = await createTablePort(storeFor(req)).putIfNew(encodeKey({ initials, score, at: Date.now(), id }));
  res.writeHead(saved ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ id }));
}

async function textOf(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function send(res, response) {
  const answer = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, Object.fromEntries(response.headers)).end(answer);
}

// The body as a stream the function reads itself, so its 1 KB cap (DDD-5) is how much is read here too. What it leaves
// unread is drained, never destroyed: destroying the request would take the socket, and the answer, with it.
function bodyOf(req) {
  const chunks = req.iterator({ destroyOnReturn: false });
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await chunks.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel() {
      await chunks.return();
      req.resume();
    },
  }, { highWaterMark: 0 });   // read only when the function asks
}

// Only the fixed reason is logged, never the error: its message can carry a key, and so initials (DDD-17). It is filed
// under the path's event, as the function files its own.
function failedLocally(path, res) {
  logToConsole({ event: path === SESSIONS_PATH ? 'sessions.error' : 'scores.error', reason: 'unexpected', ...LOCAL });
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', ...EVERY_ANSWER };
  res.writeHead(500, headers).end(JSON.stringify({ error: 'unexpected' }));
}

// CONNECT never reaches the request listener: Node hands it to 'connect', and drops the connection when nobody listens
// there. On either of the function's paths it is refused like any other method the path doesn't take, written
// straight to the socket; anywhere else it is dropped, as Node does.
async function refuseConnect(path, socket) {
  socket.on('error', () => {});   // a client gone before the answer is no failure of the server's
  const refusal = refuseBeforeTheTable(path, 'CONNECT', tableOptions);
  const fields = [...refusal.headers].map(([name, value]) => `${name}: ${value}`);
  const head = [`HTTP/1.1 ${refusal.status} ${STATUS_CODES[refusal.status]}`, ...fields, 'connection: close'].join('\r\n');
  socket.end(`${head}\r\n\r\n${await refusal.text()}`);
}

// The path, decoded, or null when it doesn't decode (`/%`): a bad request, never a crash.
function pathOf(req) {
  try { return decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { return null; }
}

async function serveFile(path, res) {
  const file = normalize(join(root, path.endsWith('/') ? path + 'index.html' : path));
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

// The test route answers only a POST from a test board; any other request for it is a file, and there is none.
const putsRow = (path, req) => path === TEST_ROWS && req.method === 'POST' && boardOf(req) !== null;

await startBlobs();
createServer(async (req, res) => {
  const path = pathOf(req);
  if (path === null) { res.writeHead(400).end('Bad request'); return; }
  if (TABLE_PATHS.includes(path) || putsRow(path, req)) {
    try { await (putsRow(path, req) ? putRow(req, res) : serveTable(path, req, res)); } catch { failedLocally(path, res); }
    return;
  }
  await serveFile(path, res);
}).on('connect', (req, socket) => {
  const path = pathOf(req);
  return TABLE_PATHS.includes(path) ? refuseConnect(path, socket) : socket.destroy();
}).listen(port, '127.0.0.1', () => console.log(`Make the Right Move: http://localhost:${port}`));
