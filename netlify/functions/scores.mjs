// The shared high-score table: a Netlify Function (v2) over Netlify Blobs (ADR-004).
//   GET  /api/scores                                 -> { scores: [{ initials, score, id }], listedAt }   best first, at most 10
//   POST /api/sessions { seed }                      -> { session: { seed, issuedAt, token }, scores, listedAt }   a game's
//                                                       session, sealed by the table, with the table as it stands (DDD-R1)
//   POST /api/scores { initials, score, session, record }
//                                                    -> { scores, id, listedAt }   id = the new row's: its game id
//                                                       (DDD-R4); saved only when the table's replay of the record ends
//                                                       at game over, at record.steps, on the deposit claimed (DDD-R3,
//                                                       DDD-R9); 409 already-signed for a game whose row is on the table
//   any other path, or a method its path doesn't take -> 404 not-found, or 405 method-not-allowed with Allow
// One blob per score, with everything in its key and an empty body (spike findings, strategy D). Every write
// goes to a key of its own, so players signing at the same moment never overwrite each other, and the keys
// sort as strings into arcade order: higher score first, then the earlier entry. One row per game (DDD-R4): the
// table shows only the key each game signed first.
// The handlers reach the store only through the restricted table port (createTablePort, DDD-4), which a composition
// root builds and hands them, with the session signer it builds from its secret (DDD-R2), the clock and its allowance,
// the logger and where the table is kept: the default export below on Netlify, scripts/serve.mjs locally (the Blobs
// emulator, one store per test board), and the acceptance harness (tests/e2e/rightmove-invaders-leaderboard/acceptance/
// steps/table-service.js). Each handler is handed only its part of the port and of the signer (dispatch, below).
import { randomUUID } from 'node:crypto';
import { getDeployStore, getStore } from '@netlify/blobs';
import { MAX_SCORE, TABLE_SIZE, isAllowedInitials, isPlausibleScore, isValidSignature } from '../../src/game/high-scores.js';
import { MAX_GAME_STEPS, readRecord } from '../../src/game/record.js';
import { replay } from '../../src/game/replay.js';
import { createSessionSigner, readSessionSecret } from '../scores/sessions.mjs';

// Netlify reads this statically, so it stays a plain literal. The rate limit is the platform's (ADR-007): 10 requests
// a minute per client, by IP and domain (DEVOPS), counted once for both paths (DEVOPS's config.path probe).
// PROBE, never to be merged: slice 02's burst run (S10) needs a deploy without the rate-limit rule.
export const config = { path: ['/api/scores', '/api/sessions'] };

const MISSING = 'missing';
const NOWHERE = Object.freeze({ scope: MISSING, context: MISSING, published: MISSING });
const STORES = Object.freeze({
  site: () => getStore({ name: 'leaderboard', consistency: 'strong' }),
  deploy: () => getDeployStore({ name: 'leaderboard', consistency: 'strong' }),
});

// The Netlify entry (ADR-005): the published production deploy keeps the site-wide table, and every other deploy a
// table of its own, which Netlify deletes with the deploy. A deploy store needs a deploy ID: without one the table is
// unavailable, and the site-wide table is never used instead. A path the function doesn't serve, or a method its path
// doesn't take, is refused before any store is opened, so it is told so whether or not there is one. The session
// signer is built from SCORES_SESSION_SECRET, and none from a value that isn't canonical base64 of exactly 32 bytes
// (DDD-R2): the handlers then issue no session and save no signing.
export default async function scores(request, context) {
  const scope = chooseStore(context);
  const where = { scope, context: context?.deploy?.context ?? MISSING, published: context?.deploy?.published ?? MISSING };
  const options = { now: Date.now, log: logToConsole, where, clockAllowanceMs: CLOCK_ALLOWANCE_MS };
  const path = pathOf(request);
  const refused = refuseBeforeTheTable(path, request.method, options);
  if (refused) return refused;
  const logLine = journal(options);
  const port = openTable(scope);
  if (!port) return failed(logLine, 'store-unavailable', PATHS.get(path).error);
  return dispatch(request, port, options, signerFrom(process.env.SCORES_SESSION_SECRET));
}

// How far ahead of a root's clock a session may have been issued, by another instance's (DDD-R2, DDD-R11): 10 s, the
// same for both roots.
export const CLOCK_ALLOWANCE_MS = 10_000;

// The session signer a secret's value makes, or null.
function signerFrom(value) {
  const secret = readSessionSecret(value);
  return secret && createSessionSigner(secret);
}

// ---- the two paths (DDD-R1) ----
// Each path the function serves, the methods it takes and the events its log lines are filed under (DDD-R14): the
// table can only be read or signed (DDD-6), and a session can only be asked for.
const SCORES_PATH = '/api/scores';
const SESSIONS_PATH = '/api/sessions';
const SCORES = Object.freeze({ methods: Object.freeze(['GET', 'POST']), rejected: 'scores.rejected', error: 'scores.error' });
const SESSIONS = Object.freeze({ methods: Object.freeze(['POST']), rejected: 'sessions.rejected', error: 'sessions.error' });
const PATHS = new Map([[SCORES_PATH, SCORES], [SESSIONS_PATH, SESSIONS]]);
const pathOf = request => new URL(request.url).pathname;
const takes = (served, method) => served.methods.includes(method);

// What both roots refuse before they open a store or build a Request (scripts/serve.mjs: a Request can't carry TRACE),
// from the path and the method alone: a path the function doesn't serve is 404 not-found, and a method its path doesn't
// take 405 method-not-allowed, with Allow. null for anything else. options as the handlers': the clock, the logger and
// where are all it uses.
export function refuseBeforeTheTable(path, method, options) {
  const served = PATHS.get(path);
  if (!served) return refuse(journal(options), 'not-found');
  return takes(served, method) ? null : methodRefused(journal(options), served);
}

// The roots' dispatch by exact path (DDD-R1): the session request to handleSessions, the table to handleScores, and
// any other path 404. Each handler is handed only its part (the user, 2026-10-27): a GET and the session request the
// port's listing alone, the session request the signer's sign, the signing its verify and gameId. signer is null for a
// root with no secret, and so is each part.
const listingOnly = port => Object.freeze({ list: port.list });
const issuingPart = signer => signer && Object.freeze({ sign: signer.sign });
const signingPart = signer => signer && Object.freeze({ verify: signer.verify, gameId: signer.gameId });

export async function dispatch(request, port, options, signer) {
  const path = pathOf(request);
  if (path === SESSIONS_PATH) return handleSessions(request, listingOnly(port), { ...options, sessions: issuingPart(signer) });
  if (path === SCORES_PATH) return handleScores(request, request.method === 'POST' ? port : listingOnly(port), { ...options, sessions: signingPart(signer) });
  return refuse(journal(options), 'not-found');
}

// 'site' only for the published production deploy; anything else, however close, gets 'deploy' (ADR-005).
export function chooseStore(context) {
  const deploy = context?.deploy;
  return deploy?.context === 'production' && deploy?.published === true ? 'site' : 'deploy';
}

function openTable(scope) {
  try { return createTablePort(STORES[scope]()); } catch { return null; }   // MissingBlobsEnvironmentError, for one
}

// A random row id, [a-z0-9]+ as the key codec wants it: only the local seeding route's (scripts/serve.mjs, DDD-R17),
// since a signed row's id is its game id (DDD-R4).
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

// One row per game (DDD-R4), the one ranking for every answer and for pruning: per game id, the winner is the key
// signed first (the earliest at, then arcade order), and the game's other keys are its losers, which never show.
// { winners, losers } of `ranked`, the well-formed keys in arcade order, each kept in that order.
function byGame(ranked) {
  const first = new Map();   // game id -> the key it signed first, so far
  for (const key of ranked) {
    const { id, at } = decodeKey(key);
    if (!first.has(id) || at < decodeKey(first.get(id)).at) first.set(id, key);
  }
  const winners = new Set(first.values());
  return { winners: ranked.filter(key => winners.has(key)), losers: ranked.filter(key => !winners.has(key)) };
}

// The prune rule (DDD-R4): the keys a signing tidies away from `ranked`, the well-formed keys listed after its write.
// A game's losers first, whatever the count, then the lowest winners beyond 20; at most 5, so a burst of signings never
// becomes a storm of deletes and the store stays at about 20 games. None of them is a row: a loser never shows, and a
// winner beyond 20 can never climb back into the top 10 (rows only ever leave the table), while a short or stale
// listing only ever ranks a key higher than it really is, so any instance may delete them without coordinating.
const KEEP = 20;                // winners kept before pruning starts
const PRUNE_AT_MOST = 5;        // per signing, the 409's removal of its own key included

export function planPrune(ranked) {
  const { winners, losers } = byGame(ranked);
  return [...losers, ...winners.slice(KEEP).reverse()].slice(0, PRUNE_AT_MOST);
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
// costs the line its ms (logged as null), never the line itself. What the request noted on its way (logLine.note) is on
// its line, whichever line that is: a replay's steps and replayMs (DDD-R14), so every line that replayed carries both.
function journal({ now, log, where = NOWHERE }) {
  const reading = () => { try { return now(); } catch { return NaN; } };
  const started = reading();
  const noted = {};
  const logLine = (event, reason, fields = {}) => log({ event, reason, ms: reading() - started, ...noted, ...fields, ...where });
  return Object.assign(logLine, { note: fields => Object.assign(noted, fields) });
}

// 500 unexpected, logged with its fixed reason and never with the error, whose message can carry a key (DDD-17).
function failed(logLine, reason, event = SCORES.error) {
  logLine(event, reason);
  return answer(500, { error: 'unexpected' });
}

// options, from the composition root: now () -> ms (a new row's time, listedAt, and a session's age), log (receives one
// entry per request), where ({ scope, context, published }, logged as given), sessions (the signer's verify and gameId,
// or null when the root has no secret) and clockAllowanceMs (how far ahead of now a session may have been issued). A
// GET is handed the port's list alone. Nothing escapes the handler (DDD-17): whatever throws is answered 500
// unexpected and logged as unexpected, so the promise always resolves.
export async function handleScores(request, port, options) {
  const logLine = journal(options);
  try {
    return await route(request, port, options, logLine);
  } catch {
    return failed(logLine, 'unexpected');
  }
}

// The session request (DDD-R1): POST /api/sessions { seed } -> 200 { session: { seed, issuedAt, token }, scores,
// listedAt }, no-store, with the rows and listedAt of its own listing. issuedAt is the root's clock as the request
// came in, before the listing (C5). options as handleScores's, but sessions is the signer's sign; port is the listing
// alone. Nothing escapes it either: whatever throws is answered 500 unexpected, logged as sessions.error unexpected.
export async function handleSessions(request, port, options) {
  const logLine = journal(options);
  try {
    return await issue(request, port, options, logLine);
  } catch {
    return failed(logLine, 'unexpected', SESSIONS.error);
  }
}

// A session can only be asked for, and only of a table with a secret, which is checked before the body is read; then
// the body must be exactly { seed } (readSeed). All or nothing: a session is issued only with its own listing's rows,
// so a listing that fails issues none (500, list-failed). The issued line carries how long the request took (ms), and
// never the seed, the token or a game id; a refused line, its reason alone.
async function issue(request, { list }, { now, sessions }, logLine) {
  if (!takes(SESSIONS, request.method)) return methodRefused(logLine, SESSIONS);
  if (!sessions) return failed(logLine, 'secret-missing', SESSIONS.error);
  const { seed, refused } = await readSeed(request);
  if (refused) return refuse(logLine, refused, NEVER_KEPT, SESSIONS.rejected);
  const issuedAt = now();
  const listed = await listing(list, now);
  if (!listed) return failed(logLine, 'list-failed', SESSIONS.error);
  const session = { seed, issuedAt, token: sessions.sign(seed, issuedAt) };
  logLine('sessions.issued', 'ok');
  return answer(200, { session, scores: table(listed.keys), listedAt: listed.listedAt });
}

// A method its path doesn't take is refused before anything else is looked at (DDD-6, DDD-R1), with what the path
// takes in Allow, and logged under the path's event.
function methodRefused(logLine, served) {
  return refuse(logLine, 'method-not-allowed', { ...NEVER_KEPT, Allow: served.methods.join(', ') }, served.rejected);
}

// A signing needs the root's secret, and is refused without one before its body is read (Signing checks, row 2).
async function route(request, port, options, logLine) {
  if (!takes(SCORES, request.method)) return methodRefused(logLine, SCORES);
  if (request.method === 'GET') return read(port, options, logLine);
  if (!options.sessions) return failed(logLine, 'secret-missing');
  return sign(request, port, options, logLine);
}

async function read({ list }, { now }, logLine) {
  const listed = await listing(list, now);
  if (!listed) return failed(logLine, 'list-failed');
  logLine('scores.read', 'ok', { keys: listed.keys.length });
  return answer(200, { scores: table(listed.keys), listedAt: listed.listedAt }, SHARED_15_SECONDS);
}

// { keys: the well-formed keys, listedAt: taken right after the listing returns (DDD-12) }, or null when the table
// can't be looked at.
async function listing(list, now) {
  let keys;
  try { keys = await list(); } catch { return null; }
  return { keys, listedAt: now() };
}

// The rows every answer carries: the first 10 winners (DDD-R4).
function table(keys) {
  return byGame(keys).winners.slice(0, TABLE_SIZE).map(decodeKey).map(({ initials, score, id }) => ({ initials, score, id }));
}

// A signing: one new row, then the table as it now stands, with the new row's id so the signer can find it (DDD-12).
async function sign(request, port, options, logLine) {
  const { signing, refused } = await readSigning(request, options, logLine);
  if (refused) return refuse(logLine, refused);
  return save(signing, port, options, logLine);
}

// A key that already exists is turned away (503, no second row). A save that throws may or may not have written its
// row, and a listing that throws after the save leaves the row there: both are 500, and the signer's game shows the
// signing as unconfirmed (ADR-008); a row so saved has signed its game. The new row's id is its game id, so every
// session for one seed names the same row, and a signing keeps its key only if its own listing shows no other key of
// its game (Signing checks row 18, DDD-R4). Tidying up is best effort: the answer is the listing's top ten whatever the
// tidy-up does, and a store failure while tidying is only logged (prune-failed). The rows are logged as a count.
async function save({ initials, score, session }, port, { now, sessions }, logLine) {
  const id = sessions.gameId(session.seed);
  const key = encodeKey({ initials, score, at: now(), id });
  const saved = await saving(port, key);
  if (saved === null) return failed(logLine, 'put-failed');
  if (!saved) return notSaved(logLine);
  const listed = await listing(port.list, now);
  if (!listed) return failed(logLine, 'list-failed');
  if (hasAnotherKey(id, key, listed.keys)) return alreadySigned(port, key, logLine);
  const tidied = await removeAll(port, planPrune(listed.keys));
  logLine('scores.signed', tidied ? 'ok' : 'prune-failed', { keys: listed.keys.length });
  return answer(200, { scores: table(listed.keys), id, listedAt: listed.listedAt });
}

// Whether `keys` hold a key of game `id` other than `own`: its row is on the table.
const hasAnotherKey = (id, own, keys) => keys.some(key => key !== own && decodeKey(key).id === id);

// A game whose row is on the table removes the key it has just written, and is 409 whether or not the store removed
// it: a key left behind is its game's loser, which never shows and is pruned first, and its one log line says so with
// removed: false (the user, 2026-10-27).
async function alreadySigned(port, key, logLine) {
  const removed = await removeAll(port, [key]);
  return refuse(logLine, 'already-signed', NEVER_KEPT, SCORES.rejected, removed ? {} : { removed: false });
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

// Removes every key it can: true if all of them went, false if the store failed on any.
async function removeAll(port, keys) {
  const outcomes = await Promise.allSettled(keys.map(key => port.remove(key)));
  const failures = outcomes.filter(outcome => outcome.status === 'rejected').map(outcome => outcome.reason);
  failures.forEach(passOnRefusal);
  return failures.length === 0;
}

function notSaved(logLine) {
  logLine('scores.not_saved', 'key-exists');
  return answer(503, { error: 'not-saved' });
}

// ---- refusals: a path the function doesn't serve, a method its path doesn't take, then what a POST must be
// (ADR-007, DDD-5; DESIGN's Signing checks; DDD-R1 for the session request), checked in this order, the first that
// fails deciding ----
// A refusal saves nothing and issues no session. The signing's last before its write is the replay (DDD-R9): only a
// deposit the game played to is saved. The plausible ceiling just before it, S1 of
// docs/analysis/root-cause-analysis-forged-high-scores.md (the key's 7-digit field alone takes a forged £9,999,950), is
// checked on the claim, so a refusal there costs no replay (DDD-R16). The one after its write, already-signed, removes
// what it wrote, or leaves it to pruning (save).
const REFUSAL_STATUS = Object.freeze({
  'not-found': 404, 'method-not-allowed': 405, 'json-required': 415, 'payload-too-large': 413, 'invalid-signature': 400,
  'session-required': 400, 'initials-not-allowed': 400, 'invalid-session': 400, 'session-expired': 400,
  'invalid-record': 400, 'game-too-long': 400, 'implausible-score': 400, 'replay-mismatch': 400, 'invalid-seed': 400,
  'already-signed': 409,
});
// Bytes, counted as the body is read, since a Content-Length can lie (DDD-5): a session request is { seed } within
// 1 KB (DDD-R1), a signing carries its game's record within 128 KB, about an hour of key changes at a human's pace
// (DDD-R3).
const SESSION_BODY_CAP = 1024;
const SIGNING_BODY_CAP = 128 * 1024;

function refuse(logLine, error, headers = NEVER_KEPT, event = SCORES.rejected, fields = {}) {
  logLine(event, error, fields);
  return answer(REFUSAL_STATUS[error], { error }, headers);
}

// A signing is exactly { initials, score, session, record }, { initials, score } being a valid signature (ADR-006).
const SIGNING_FIELDS = Object.freeze(['initials', 'score', 'session', 'record'].sort());
const hasSession = signing => typeof signing === 'object' && signing !== null && Object.hasOwn(signing, 'session');
const isSigning = signing => {
  const fields = Object.keys(signing).sort();
  return fields.length === SIGNING_FIELDS.length && fields.every((field, at) => field === SIGNING_FIELDS[at])
    && isValidSignature({ initials: signing.initials, score: signing.score });
};

// A session lasts 2 hours (D18), judged on the handler's own clock, since verify takes none (DDD-R2, C8): one issued
// more than clockAllowanceMs after now is one the table didn't seal (row 9b), and one more than 2 hours old has expired
// (row 10).
const SESSION_LIFETIME_MS = 7_200_000;   // 2 hours
const fromTheFuture = ({ session }, { now, clockAllowanceMs }) => session.issuedAt - now() > clockAllowanceMs;
const expired = ({ session }, { now }) => now() - session.issuedAt > SESSION_LIFETIME_MS;

// The record names its rules version before anything else of it is read (row 11), then reads whole (row 12b), so the
// replay only ever plays a record readRecord accepts, and never throws; and it lasts at most an hour of game time (row
// 13, D9), so no request keeps the table replaying for long. The hour is this check's, not readRecord's (C3).
const namesItsRules = ({ record }) => typeof record === 'object' && record !== null && Number.isSafeInteger(record.rules);
const reads = ({ record }) => readRecord(record) !== null;
const withinTheHour = ({ record }) => record.steps <= MAX_GAME_STEPS;

// The replay (row 16, DDD-R9): the game played again from the seed its session sealed, which must be over exactly at
// record.steps, on the deposit claimed; a replay that stops short of game over, or reaches it sooner, is a mismatch
// as much as another deposit is. Its steps, and how long it took on the handler's clock, are on the request's line
// (DDD-R14).
function replaysToTheClaim({ score, session, record }, { now }, logLine) {
  const started = now();
  const { over, steps, deposit } = replay({ seed: session.seed, record });
  logLine.note({ steps, replayMs: now() - started });
  return over && steps === record.steps && deposit === score;
}

// What a parsed body must be, in order (Signing checks, rows 6 to 11, 12b, 13, 15 and 16): a body without a session is
// one no game asked for (a page loaded before sessions, or a forgery sent from a terminal). A session the table didn't
// seal is invalid-session, whatever it carries: verify looks at its shape before its seal and never throws (DDD-R2), so
// a session changed, cut short or made up, or a value that isn't a session at all, stops at row 9, and only a sealed
// session's issue time is judged. Every check is cheaper than the replay, which comes last.
const SIGNING_CHECKS = Object.freeze([
  ['session-required', hasSession],
  ['invalid-signature', isSigning],
  ['initials-not-allowed', signing => isAllowedInitials(signing.initials)],
  ['invalid-session', (signing, { sessions }) => sessions.verify(signing.session)],
  ['invalid-session', (signing, options) => !fromTheFuture(signing, options)],
  ['session-expired', (signing, options) => !expired(signing, options)],
  ['invalid-record', namesItsRules],
  ['invalid-record', reads],
  ['game-too-long', withinTheHour],
  ['implausible-score', signing => isPlausibleScore(signing.score)],
  ['replay-mismatch', replaysToTheClaim],
]);

// { signing } or { refused: the error code }. options as the handler's: the checks use sessions, now and
// clockAllowanceMs; logLine is the request's, which the replay notes itself on.
async function readSigning(request, options, logLine) {
  const { json: signing, refused: unread } = await readJson(request, SIGNING_BODY_CAP);
  if (unread) return { refused: unread };
  if (signing === undefined) return { refused: 'invalid-signature' };
  const [refused] = SIGNING_CHECKS.find(([, passes]) => !passes(signing, options, logLine)) ?? [];
  return refused ? { refused } : { signing };
}

// A session request is exactly { seed }, its seed 32 lowercase hex characters (DDD-R1, C4): another field, a body that
// isn't JSON, or any other seed is invalid-seed. { seed } or { refused: the error code }.
const SEED = /^[0-9a-f]{32}$/;
const isSeedRequest = body => typeof body === 'object' && body !== null && Object.keys(body).length === 1
  && Object.hasOwn(body, 'seed') && typeof body.seed === 'string' && SEED.test(body.seed);

async function readSeed(request) {
  const { json, refused } = await readJson(request, SESSION_BODY_CAP);
  if (refused) return { refused };
  return isSeedRequest(json) ? { seed: json.seed } : { refused: 'invalid-seed' };
}

// What both POSTs check first, in this order: the format, then the size. The body is read only once the format is
// right, and never past `cap`. { json: the JSON value, undefined when the body isn't JSON } or { refused: the error
// code }.
async function readJson(request, cap) {
  if (mediaType(request) !== 'application/json') return { refused: 'json-required' };
  const body = await readUpTo(cap, request.body);
  if (body === null) return { refused: 'payload-too-large' };
  return { json: parsed(body) };
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

// The JSON value, or undefined when the body isn't JSON.
function parsed(body) {
  try { return JSON.parse(body); } catch { return undefined; }
}
