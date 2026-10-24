// Local server for play and the acceptance tests: the game's static files, plus the high-score table at
// /api/scores. ES modules don't load from file:// URLs, so the game has to be served over http.
// The table is the real Netlify Function (netlify/functions/scores.mjs) and the real @netlify/blobs client,
// against the Blobs emulator in a fresh temporary directory, so every start begins with empty tables and needs
// no Netlify account. Each `test-board` cookie gets a table of its own (tests run side by side); without one,
// the table is `local`.
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStore } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import { handleScores } from '../netlify/functions/scores.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT) || 4173;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const BOARD = /(?:^|;\s*)test-board=([a-z0-9-]{1,40})(?:;|$)/;

// The Blobs client finds the emulator through this context. Strong consistency needs `uncachedEdgeURL` as well.
async function startBlobs() {
  const token = randomUUID();
  const blobs = new BlobsServer({ directory: await mkdtemp(join(tmpdir(), 'make-the-right-move-blobs-')), token });
  const { address } = await blobs.start();
  const context = { edgeURL: address, uncachedEdgeURL: address, siteID: 'local', token };
  process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify(context)).toString('base64');
}

function storeFor(req) {
  const board = BOARD.exec(req.headers.cookie ?? '')?.[1] ?? 'local';
  return getStore({ name: `leaderboard-${board}`, consistency: 'strong' });
}

// Node request -> Web Request -> the function -> Node response.
async function serveScores(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks);
  const request = new Request(new URL(req.url, `http://localhost:${port}`), { method: req.method, headers: req.headers, body });
  const response = await handleScores(request, storeFor(req));
  const answer = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, { ...Object.fromEntries(response.headers), 'cache-control': 'no-store' }).end(answer);
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
    try { await serveScores(req, res); } catch (error) { console.error(error); res.writeHead(500).end('Server error'); }
    return;
  }
  await serveFile(path, res);
}).listen(port, '127.0.0.1', () => console.log(`Make the Right Move: http://localhost:${port}`));
