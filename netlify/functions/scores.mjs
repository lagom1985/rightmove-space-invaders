// The shared high-score table: a Netlify Function (v2) over Netlify Blobs (ADR-004).
//   GET  /api/scores                        -> { scores: [{ initials, score, id }], listedAt }   best first, at most 10
//   POST /api/scores { initials, score }    -> { scores, id, listedAt }   id = the new row's, so the game can find it
// One blob per score, with everything in its key and an empty body (spike findings, strategy D). Every write
// goes to a key of its own, so players signing at the same moment never overwrite each other, and the keys
// sort as strings into arcade order: higher score first, then the earlier entry.
// The handler reaches the store only through the restricted table port (createTablePort, DDD-4), which a composition
// root builds and hands it with the clock, the id source, the logger and where the table is kept: the default export
// below on Netlify, scripts/serve.mjs locally (the Blobs emulator, one store per test board), and the acceptance
// harness (tests/e2e/rightmove-invaders-leaderboard/acceptance/steps/table-service.js).
import { randomUUID } from 'node:crypto';
import { getDeployStore, getStore } from '@netlify/blobs';
import { MAX_SCORE, TABLE_SIZE, isAllowedInitials, isPlausibleScore, isValidSignature } from '../../src/game/high-scores.js';

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
// unavailable, and the site-wide table is never used instead. A method the table doesn't take is refused before any
// store is opened, so it is told what the table takes whether or not there is one.
export default async function scores(request, context) {
  const scope = chooseStore(context);
  const where = { scope, context: context?.deploy?.context ?? MISSING, published: context?.deploy?.published ?? MISSING };
  const options = { now: Date.now, newId, log: logToConsole, where };
  if (!isReadOrSign(request.method)) return refuseMethod(options);
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

// The production id source: a new row's id, [a-z0-9]+ as the key codec wants it (also scripts/serve.mjs's).
export const newId = () => randomUUID().replaceAll('-', '');

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

// The accepted prune rule (DDD-1): the keys a signing tidies away from `ranked`, the well-formed keys listed after its
// write. None up to 20 keys; above that k = min(5, n - 20), so a burst of signings never becomes a storm of deletes and
// the store stays at about 20 keys. They are the lowest ranked, so always 11th or lower: a key ranked below 10th can
// never climb back (rows only ever leave the table), and a short or stale listing only ever ranks a key higher than it
// really is, so any instance may delete them without coordinating with the others.
const KEEP = 20;                // keys kept before pruning starts
const PRUNE_AT_MOST = 5;        // per signing

export function planPrune(ranked) {
  const count = Math.min(PRUNE_AT_MOST, ranked.length - KEEP);
  return count > 0 ? ranked.slice(-count) : [];
}

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
// On every answer, scripts/serve.mjs's own 500 included.
export const EVERY_ANSWER = Object.freeze({ 'Netlify-Vary': 'query=table', 'X-Content-Type-Options': 'nosniff' });

const answer = (status, body, headers = NEVER_KEPT) => Response.json(body, { status, headers: { ...headers, ...EVERY_ANSWER } });

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

// The session request (rightmove-invaders-replay-verified-scores, DDD-R1): POST /api/sessions { seed } -> 200
// { session: { seed, issuedAt, token }, scores, listedAt }, no-store, from the same function, dispatched by path. Both
// handlers will take today's options plus `sessions` (the session signer, or null when the root has no secret) and
// `clockAllowanceMs` (DDD-R11).
// RED scaffold (DISTILL): it throws until DELIVER builds it (slice 01); nothing routes to it yet.
export async function handleSessions(request, port, options) {
  throw new Error('__SCAFFOLD__: handleSessions is not yet implemented (DDD-R1)');
}

// The table can only be read or signed (DDD-6): any other method is refused before anything else is looked at, and by
// a composition root before it opens a store or builds a Request (scripts/serve.mjs: a Request can't carry TRACE).
// refuseMethod takes the options handleScores takes (the clock, the logger and where are all it uses).
const METHODS = Object.freeze(['GET', 'POST']);
const READ_OR_SIGN_ONLY = Object.freeze({ ...NEVER_KEPT, Allow: METHODS.join(', ') });
export const isReadOrSign = method => METHODS.includes(method);
const methodRefused = record => refuse(record, 'method-not-allowed', READ_OR_SIGN_ONLY);
export const refuseMethod = options => methodRefused(journal(options));

async function route(request, port, options, record) {
  if (!isReadOrSign(request.method)) return methodRefused(record);
  if (request.method === 'GET') return read(port, options, record);
  return sign(request, port, options, record);
}

async function read({ list }, { now }, record) {
  const listed = await listing(list, now);
  if (!listed) return failed(record, 'list-failed');
  record('scores.read', 'ok', { keys: listed.keys.length });
  return answer(200, { scores: table(listed.keys), listedAt: listed.listedAt }, SHARED_15_SECONDS);
}

// { keys: the well-formed keys, listedAt: taken right after the listing returns (DDD-12) }, or null when the table
// can't be looked at.
async function listing(list, now) {
  let keys;
  try { keys = await list(); } catch { return null; }
  return { keys, listedAt: now() };
}

function table(keys) {
  return keys.slice(0, TABLE_SIZE).map(decodeKey).map(({ initials, score, id }) => ({ initials, score, id }));
}

// A signing: one new row, then the table as it now stands, with the new row's id so the signer can find it (DDD-12).
async function sign(request, port, options, record) {
  const { signature, refused } = await readSignature(request);
  if (refused) return refuse(record, refused);
  return save(signature, port, options, record);
}

// A key that already exists is turned away (503, no second row). A save that throws may or may not have written its
// row, and a listing that throws after the save leaves the row there: both are 500 unexpected, and the signer's game
// shows the signing as unconfirmed (ADR-008). Tidying up is best effort: the answer is the listing's top ten whatever
// the tidy-up does, and a store failure while tidying is only logged (prune-failed). The rows are logged as a count.
async function save({ initials, score }, port, { now, newId }, record) {
  const id = newId();
  const saved = await saving(port, encodeKey({ initials, score, at: now(), id }));
  if (saved === null) return failed(record, 'put-failed');
  if (!saved) return notSaved(record);
  const listed = await listing(port.list, now);
  if (!listed) return failed(record, 'list-failed');
  const tidied = await prune(port, planPrune(listed.keys));
  record('scores.signed', tidied ? 'ok' : 'prune-failed', { keys: listed.keys.length });
  return answer(200, { scores: table(listed.keys), id, listedAt: listed.listedAt });
}

// true if saved, false if the key already existed, null when the store failed. A key the port refuses is no store
// failure: it goes on to the catch-all (500 unexpected, logged as unexpected).
async function saving(port, key) {
  try {
    return await port.putIfNew(key);
  } catch (error) {
    passOnRefusal(error);
    return null;
  }
}

// A key the port refuses is a bug, never a store failure: it goes on to the catch-all.
function passOnRefusal(error) {
  if (error instanceof KeyRefused) throw error;
}

// Removes every planned key it can: true if all of them went, false if the store failed on any.
async function prune(port, keys) {
  const outcomes = await Promise.allSettled(keys.map(key => port.remove(key)));
  const failures = outcomes.filter(outcome => outcome.status === 'rejected').map(outcome => outcome.reason);
  failures.forEach(passOnRefusal);
  return failures.length === 0;
}

function notSaved(record) {
  record('scores.not_saved', 'key-exists');
  return answer(503, { error: 'not-saved' });
}

// ---- refusals: a method the table doesn't take, then what a POST must be (ADR-007, DDD-5), checked in this order ----
// A refusal saves nothing. The last, a score above the plausible ceiling, is S1 of
// docs/analysis/root-cause-analysis-forged-high-scores.md: the key's 7-digit field alone takes a forged £9,999,950.
const REFUSAL_STATUS = Object.freeze({
  'method-not-allowed': 405, 'json-required': 415, 'payload-too-large': 413, 'invalid-signature': 400, 'initials-not-allowed': 400,
  'implausible-score': 400,
});
const BODY_CAP = 1024;   // bytes (1 KB, DDD-5): counted as the body is read, since a Content-Length can lie

function refuse(record, error, headers = NEVER_KEPT) {
  record('scores.rejected', error);
  return answer(REFUSAL_STATUS[error], { error }, headers);
}

// { signature } or { refused: the error code }. The body is read only once the format is right.
async function readSignature(request) {
  if (mediaType(request) !== 'application/json') return { refused: 'json-required' };
  const body = await readUpTo(BODY_CAP, request.body);
  if (body === null) return { refused: 'payload-too-large' };
  const signature = parsed(body);
  if (!isValidSignature(signature)) return { refused: 'invalid-signature' };
  if (!isAllowedInitials(signature.initials)) return { refused: 'initials-not-allowed' };
  return isPlausibleScore(signature.score) ? { signature } : { refused: 'implausible-score' };
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
