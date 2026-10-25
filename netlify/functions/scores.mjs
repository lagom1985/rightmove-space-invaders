// The shared high-score table: a Netlify Function (v2) over Netlify Blobs (ADR-004).
//   GET  /api/scores                        -> { scores: [{ initials, score, id }], listedAt }   best first, at most 10
//   POST /api/scores { initials, score }    -> { scores, id, listedAt }   id = the new row's, so the game can find it
// One blob per score, with everything in its key and an empty body (spike findings, strategy D). Every write
// goes to a key of its own, so players signing at the same moment never overwrite each other, and the keys
// sort as strings into arcade order: higher score first, then the earlier entry.
// The handler reaches the store only through the restricted table port (createTablePort, DDD-4), which a composition
// root builds and hands it with the clock, the id source, the logger and where the table is kept: the default export
// below on Netlify, scripts/serve.mjs locally (the Blobs emulator, one store per test-board cookie), and the acceptance
// harness (tests/e2e/rightmove-invaders-leaderboard/acceptance/steps/table-service.js).
import { randomUUID } from 'node:crypto';
import { getDeployStore, getStore } from '@netlify/blobs';
import { MAX_SCORE, TABLE_SIZE, isValidSignature } from '../../src/game/high-scores.js';

// Netlify reads this statically, so it stays a plain literal. The rate limit is the platform's (ADR-007): 10 requests
// a minute per client, by IP and domain (DEVOPS).
export const config = { path: '/api/scores', rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] } };

const MISSING = 'missing';
const NOWHERE = Object.freeze({ scope: MISSING, context: MISSING, published: MISSING });
const STORES = Object.freeze({
  site: () => getStore({ name: 'leaderboard', consistency: 'strong' }),
  deploy: () => getDeployStore({ name: 'leaderboard', consistency: 'strong' }),
});

// The Netlify entry (ADR-005): the published production deploy keeps the site-wide table, and every other deploy a
// table of its own, which Netlify deletes with the deploy. A deploy store needs a deploy ID: without one the table is
// unavailable, and the site-wide table is never used instead.
export default async function scores(request, context) {
  const scope = chooseStore(context);
  const where = { scope, context: context?.deploy?.context ?? MISSING, published: context?.deploy?.published ?? MISSING };
  const options = { now: Date.now, newId, log: logToConsole, where };
  const record = journal(options);
  const port = openTable(scope);
  if (!port) return failed(record, 'store-unavailable');
  return handleScores(request, port, options);
}

// 'site' only for the published production deploy; anything else, however close, gets 'deploy' (ADR-005).
export function chooseStore(context) {
  const deploy = context?.deploy;
  return deploy?.context === 'production' && deploy?.published === true ? 'site' : 'deploy';
}

function openTable(scope) {
  try { return createTablePort(STORES[scope]()); } catch { return null; }   // MissingBlobsEnvironmentError, for one
}

const newId = () => randomUUID().replaceAll('-', '');

// The production logger: one JSON line per entry on the console, which Netlify keeps as the function's log (DDD-17).
export const logToConsole = entry => console.log(JSON.stringify(entry));

// ---- the key codec (the persisted schema, ADR-004) ----
// s/{MAX_SCORE - score, 7 digits}-{epoch ms, 15 digits}-{initials}-{id}. Only keys of exactly this shape are rows: the
// emulator lists its own temporary files (`s/.xxxx`) next to them.
const PREFIX = 's/';
const KEY = /^s\/(\d{7})-(\d{15})-([A-Z]{3})-([a-z0-9]+)$/;
const digits = (value, width) => String(value).padStart(width, '0');

export function encodeKey({ initials, score, at, id }) {
  return `${PREFIX}${digits(MAX_SCORE - score, 7)}-${digits(at, 15)}-${initials}-${id}`;
}

export function decodeKey(key) {
  const [, inverted, at, initials, id] = KEY.exec(key) ?? [];
  return initials ? { initials, score: MAX_SCORE - Number(inverted), at: Number(at), id } : null;
}

// The well-formed keys, in arcade order: the fixed widths make string order the arcade's.
export function rankKeys(keys) {
  return keys.filter(key => KEY.test(key)).sort();
}

// RED scaffold, created by DISTILL: the accepted prune rule (DDD-1), arriving in DELIVER step 03-01.
//   planPrune(ranked) -> the keys to remove: none up to 20 keys; above that k = min(5, n - 20) keys, all ranked 11th or lower
export function planPrune(ranked) { throw new Error('__SCAFFOLD__: not yet implemented'); }

// ---- the restricted table port (DDD-4, ADR-004) ----
// The only way the handler reaches the store: it lists the well-formed score keys, in arcade order, and writes or
// removes score keys and nothing else. It calls store.list, store.set and store.delete, and no other store method.
class KeyRefused extends Error {
  name = 'KeyRefused';
  constructor() { super('The high-score table only files score keys'); }   // never the key itself (DDD-17)
}

function scoreKeyOnly(key) {
  if (!KEY.test(key)) throw new KeyRefused();
  return key;
}

export function createTablePort(store) {
  return Object.freeze({
    async list() {
      const { blobs } = await store.list({ prefix: PREFIX });   // strong: the roots open the store with consistency 'strong'
      return rankKeys(blobs.map(blob => blob.key));
    },
    // true if written, false if the key already existed
    async putIfNew(key) {
      const { modified } = await store.set(scoreKeyOnly(key), '', { onlyIfNew: true });
      return modified;
    },
    async remove(key) { await store.delete(scoreKeyOnly(key)); },
  });
}

// ---- the handler ----
// Caching per answer (DDD-6): a table read may be shared by the CDN for 15 s and is revalidated by every browser, so
// nobody sees it more than 15 s old; nothing else is kept. Every answer is JSON.
const SHARED_15_SECONDS = Object.freeze({ 'Netlify-CDN-Cache-Control': 'public, s-maxage=15, durable', 'Cache-Control': 'public, max-age=0, must-revalidate' });
const NEVER_KEPT = Object.freeze({ 'Cache-Control': 'no-store' });
const EVERY_ANSWER = Object.freeze({ 'Netlify-Vary': 'query=table', 'X-Content-Type-Options': 'nosniff' });

const answer = (status, body, caching = NEVER_KEPT) => Response.json(body, { status, headers: { ...caching, ...EVERY_ANSWER } });

// One log line per request (DDD-17): a fixed reason, how long it took and where the table is kept, as the root said
// (all three 'missing' if it didn't). Never a key, initials, an id, a body or an error message. A clock that throws
// costs the line its ms (logged as null), never the line itself.
function journal({ now, log, where = NOWHERE }) {
  const reading = () => { try { return now(); } catch { return NaN; } };
  const started = reading();
  return (event, reason, counts = {}) => log({ event, reason, ms: reading() - started, ...counts, ...where });
}

// 500 unexpected, logged with its fixed reason and never with the error, whose message can carry a key (DDD-17).
function failed(record, reason) {
  record('scores.error', reason);
  return answer(500, { error: 'unexpected' });
}

// options, from the composition root: now () -> ms (a new row's time, and listedAt), newId () -> a new row's id
// ([a-z0-9]+), log (receives one entry per request) and where ({ scope, context, published }, logged as given).
// A GET is handed the port's list alone. Nothing escapes the handler (DDD-17): whatever throws is answered 500
// unexpected and logged as unexpected, so the promise always resolves.
export async function handleScores(request, port, options) {
  const record = journal(options);
  try {
    return await route(request, port, options, record);
  } catch {
    return failed(record, 'unexpected');
  }
}

async function route(request, port, options, record) {
  if (request.method === 'GET') return read(port, options, record);
  if (request.method !== 'POST') return answer(405, { error: 'method-not-allowed' });
  return sign(request, port, options, record);
}

async function read({ list }, { now }, record) {
  const keys = await listing(list);
  if (!keys) return failed(record, 'list-failed');
  const listedAt = now();   // right after the listing returns (DDD-12)
  record('scores.read', 'ok', { keys: keys.length });
  return answer(200, { scores: table(keys), listedAt }, SHARED_15_SECONDS);
}

// The well-formed keys, or null when the table can't be looked at.
async function listing(list) {
  try { return await list(); } catch { return null; }
}

function table(keys) {
  return keys.slice(0, TABLE_SIZE).map(decodeKey).map(({ initials, score, id }) => ({ initials, score, id }));
}

// A signing: one new row, then the table as it now stands, with the new row's id so the signer can find it (DDD-12).
// The rows are logged as a count, after the tidy-up, so a tidy-up that throws leaves one line (the catch-all's).
async function sign(request, port, { now, newId }, record) {
  const { signature, refused } = await readSignature(request);
  if (refused) return refuse(record, refused);
  const id = newId();
  const saved = await port.putIfNew(encodeKey({ initials: signature.initials, score: signature.score, at: now(), id }));
  if (!saved) return answer(503, { error: 'not-saved' });
  const keys = await port.list();
  const listedAt = now();   // right after the listing returns (DDD-12)
  await prune(port, keys);
  record('scores.signed', 'ok', { keys: keys.length });
  return answer(200, { scores: table(keys), id, listedAt });
}

// ---- what a POST must be (ADR-007, DDD-5), checked in this order; a refusal saves nothing ----
const REFUSAL_STATUS = Object.freeze({ 'json-required': 415, 'payload-too-large': 413, 'invalid-signature': 400 });
const BODY_CAP = 1024;   // bytes (1 KB, DDD-5): counted as the body is read, since a Content-Length can lie

function refuse(record, error) {
  record('scores.rejected', error);
  return answer(REFUSAL_STATUS[error], { error });
}

// { signature } or { refused: the error code }. The body is read only once the format is right.
async function readSignature(request) {
  if (mediaType(request) !== 'application/json') return { refused: 'json-required' };
  const body = await readUpTo(BODY_CAP, request.body);
  if (body === null) return { refused: 'payload-too-large' };
  const signature = parsed(body);
  return isValidSignature(signature) ? { signature } : { refused: 'invalid-signature' };
}

// The media type alone, its parameters (a charset, say) ignored; media types are case-insensitive.
const mediaType = request => (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();

// The body as text, or null as soon as it passes `cap` bytes: the rest is never read.
async function readUpTo(cap, stream) {
  if (!stream) return '';
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = '';
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    size += chunk.value.byteLength;
    if (size > cap) { await reader.cancel(); return null; }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

function parsed(body) {
  try { return JSON.parse(body); } catch { return undefined; }
}

// The walking skeleton's fixed prune, until the accepted prune rule (planPrune) replaces it (DELIVER step 03-01).
const KEEP = 20;                // keys kept before pruning starts
const PRUNE_AT_MOST = 5;        // per submit, so a burst of submits never becomes a storm of deletes

// A key ranked below 10th can never climb back (rows only ever leave the table), so any instance may delete it
// without coordinating with the others.
async function prune(port, keys) {
  if (keys.length <= KEEP) return;
  await Promise.all(keys.slice(TABLE_SIZE, TABLE_SIZE + PRUNE_AT_MOST).map(key => port.remove(key)));
}
