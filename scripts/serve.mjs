// Local server for play and the acceptance tests: the game's static files, plus the high-score table at
// /api/scores. ES modules don't load from file:// URLs, so the game has to be served over http.
// The table is the real Netlify Function's handler (netlify/functions/scores.mjs) behind its restricted port, and the
// real @netlify/blobs client, against the Blobs emulator in a fresh temporary directory, so every start begins with
// empty tables and needs no Netlify account. Each `test-board` cookie gets a table of its own (tests run side by side);
// without one, the table is `local`. This is a composition root: it chooses the store, builds the port, and hands the
// handler the clock, the id source, the logger and where the table is kept (scope local).
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStore } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import { createTablePort, handleScores, logToConsole } from '../netlify/functions/scores.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT) || 4173;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const BOARD = /(?:^|;\s*)test-board=([a-z0-9-]{1,40})(?:;|$)/;
// What this root knows about where the table is kept (DDD-17): locally, and no deploy at all.
const LOCAL = Object.freeze({ scope: 'local', context: 'missing', published: 'missing' });
const tableOptions = Object.freeze({
  now: Date.now,
  newId: () => randomUUID().replaceAll('-', ''),
  log: logToConsole,
  where: LOCAL,
});
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

function storeFor(req) {
  const board = BOARD.exec(req.headers.cookie ?? '')?.[1] ?? 'local';
  return getStore({ name: `leaderboard-${board}`, consistency: 'strong' });
}

// Node request -> Web Request -> the function -> Node response, with the function's own headers (DDD-6).
async function serveScores(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks);
  const request = new Request(new URL(req.url, `http://localhost:${port}`), { method: req.method, headers: req.headers, body });
  const response = await handleScores(request, createTablePort(storeFor(req)), tableOptions);
  const answer = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, Object.fromEntries(response.headers)).end(answer);
}

// Only the fixed reason is logged, never the error: its message can carry a key, and so initials (DDD-17).
function failedLocally(res) {
  logToConsole({ event: 'scores.error', reason: 'unexpected', ...LOCAL });
  res.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ error: 'unexpected' }));
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

await startBlobs();
createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (path === '/api/scores') {
    try { await serveScores(req, res); } catch { failedLocally(res); }
    return;
  }
  await serveFile(path, res);
}).listen(port, '127.0.0.1', () => console.log(`Make the Right Move: http://localhost:${port}`));
