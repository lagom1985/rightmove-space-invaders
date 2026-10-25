import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import { expect } from '@playwright/test';
import { getStore } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import { handleScores, createTablePort } from '../../../../../netlify/functions/scores.mjs';
import { assertStateDelta, satisfying } from '../../../../common/state-delta.js';
import { BLOCKED_INITIALS, TABLE_SIZE, Refusal, TableAction, TableFailure, TableRequest, START, OTHER_HOUSE_HUNTERS } from './domain-types.js';

// The high-score table service, driven the way Netlify drives it: handleScores(request, port, options) is called from
// Node with a Web Request and answers a Web Response (Functions v2), with no browser and no HTTP server. Under it: the
// production restricted port (createTablePort), the real @netlify/blobs client, and a real BlobsServer emulator in a
// fresh temporary directory per scenario (docs/architecture/atdd-infrastructure-policy.md).
//
// THIS HARNESS IS A SECOND COMPOSITION ROOT. The Netlify entry (the default export: chooseStore, getStore /
// getDeployStore, config) cannot run locally, so the harness builds the same pieces by hand: store -> test store port
// -> createTablePort -> handleScores with { now, newId, log, where }, `where` being
// what a composition root knows about where the table is kept (here LOCAL: scope 'local', context and published 'missing'). This is the exception DDD-4 sanctions (the composition
// roots wire the port, the clock, the id source and the logger). What it does not prove is therefore DELIVER's to unit
// test: that the Netlify entry and scripts/serve.mjs wire the same pieces (a fake deploy environment over a real BlobsServer).
//
// Faked, because they are non-deterministic or need a failure on demand:
// - the clock: starts at START and moves on LISTING_TAKES_MS whenever a listing returns, so an answer's listedAt shows
//   whether it was taken after the listing (DDD-12); it can be frozen to force a duplicate key;
// - the id source: t1, t2, ... (base 36), or one repeated id, or one that can't be part of a key;
// - the logger: every entry is kept, so a scenario can read the fixed reason and fields (DDD-17);
// - the test store port, the one sanctioned double: it wraps the real emulator Store and forwards every call, and on
//   request throws on list, set or delete, with a key in the error message (so the log must not repeat it).
//   It cannot model partial writes, latency or timeouts inside Blobs, stale (eventually consistent) listings, a set
//   that reports "not modified" for any reason but an existing key, Netlify's 429, or a missing deploy ID. It assumes
//   list() resolves to { blobs }. Real Netlify Blobs is the DEVOPS smoke test's (K10-K14).
//
// RAW ACCESS (deliberate, and the only way around the port): arranging and observing go straight to the emulator Store
// (`raw`), never through the port or the test store port: holdSignature() writes a precondition key, and snapshot() lists
// the store before and after each request. Raw listing must not move the ServerClock (only the wrapped list does), or the
// observation would change what it observes: snapshot() asserts it.
//
// The universe of every state delta: the keys in the scenario's store, split into well-formed score keys (the table)
// and everything else (stray entries). The handler may only add or remove score keys (ADR-004, DDD-4).

const URL = 'http://localhost/api/scores';
const UNIVERSE = ['table.scores', 'table.leftovers'];
const LISTING_TAKES_MS = 1000;
const SEED = Number(process.env.FC_SEED ?? 20261023);
const PROPERTY_RUNS = 20;
const STORE_FAILURE_KEY = 's/9999000-001767225600000-FAB-t1';
// What scripts/serve.mjs knows about where the table is kept: the same `where` the harness hands the handler (DDD-17).
const LOCAL = Object.freeze({ scope: 'local', context: 'missing', published: 'missing' });

// ---- the technical side of the vocabulary (the persisted key format, headers, log fields, store operations) ----
// A row's key is the persisted schema (ADR-004): s/{9999999 - score, 7 digits}-{epoch ms, 15 digits}-{initials}-{id}.
const SCORE_KEY = /^s\/(\d{7})-(\d{15})-([A-Z]{3})-([a-z0-9]+)$/;
const scoreKey = ({ initials, score, at, id }) => `s/${String(9_999_999 - score).padStart(7, '0')}-${String(at).padStart(15, '0')}-${initials}-${id}`;
function readScoreKey(key) {
  const [, inverted, at, initials, id] = SCORE_KEY.exec(key) ?? [];
  return initials ? { initials, score: 9_999_999 - Number(inverted), at: Number(at), id } : null;
}
// Keys a store can hold next to the scores: the emulator's in-flight temporary files, a malformed row, another prefix.
const LEFTOVER_KEYS = Object.freeze(['s/.k3j2tmp', 's/FAB-1000', 'archive/s-0001-FAB']);

// Cache headers per answer (DDD-6, amended in DEVOPS): a table read may be shared by the CDN for 15 s; nothing else is kept.
const Caching = Object.freeze({
  SHARED_15_SECONDS: Object.freeze({ 'netlify-cdn-cache-control': 'public, s-maxage=15, durable', 'cache-control': 'public, max-age=0, must-revalidate' }),
  NEVER_KEPT: Object.freeze({ 'cache-control': 'no-store' }),
  EVERY_ANSWER: Object.freeze({ 'netlify-vary': 'query=table', 'x-content-type-options': 'nosniff' }),
});

const STORE_OPERATION = Object.freeze({ [TableAction.LOOKING]: 'list', [TableAction.SAVING]: 'set', [TableAction.TIDYING]: 'delete' });
const LOG_LINE = Object.freeze({
  [TableFailure.FAILED_LOOK]: { event: 'scores.error', reason: 'list-failed' },
  [TableFailure.FAILED_SAVE]: { event: 'scores.error', reason: 'put-failed' },
  [TableFailure.UNEXPECTED]: { event: 'scores.error', reason: 'unexpected' },
  [TableFailure.FAILED_TIDY_UP]: { event: 'scores.signed', reason: 'prune-failed' },
  [TableFailure.DUPLICATE]: { event: 'scores.not_saved', reason: 'key-exists' },
});
const HTTP_METHOD = Object.freeze({ [TableRequest.WIPE]: 'DELETE', [TableRequest.REPLACE]: 'PUT' });

class ServerClock {
  t = START.getTime();
  frozen = false;
  now = () => this.t;
  moveOn(ms) { if (!this.frozen) this.t += ms; return this.t; }
}

class IdSource {
  count = 0;
  fixed = null;
  next = () => this.fixed ?? `t${(++this.count).toString(36)}`;
}

// The test store port: the real Store, with failures on demand and the clock moving on as a listing returns.
function wrapStore(store, clock) {
  const failing = new Set();
  const listing = { returnedAt: null };
  const failure = (operation, key = STORE_FAILURE_KEY) => new Error(`The emulated store could not ${operation} ${key}`);
  const intercepted = {
    async list(...args) {
      if (failing.has('list')) throw failure('list');
      const result = await store.list(...args);
      listing.returnedAt = clock.moveOn(LISTING_TAKES_MS);
      return result;
    },
    async set(key, ...rest) {
      if (failing.has('set')) throw failure('save', key);
      return store.set(key, ...rest);
    },
    async delete(key) {
      if (failing.has('delete')) throw failure('delete', key);
      return store.delete(key);
    },
  };
  const wrapped = new Proxy(store, {
    get(target, name) {
      if (Object.hasOwn(intercepted, name)) return intercepted[name];
      const value = Reflect.get(target, name, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { store: wrapped, failing, listing };
}

async function readAnswer(response) {
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = undefined; }
  return { status: response.status, headers: Object.fromEntries([...response.headers].map(([k, v]) => [k.toLowerCase(), v])), text, body };
}

// One table: a store of its own on the emulator, behind the production port, with its own clock, ids and log.
class Table {
  constructor(store) {
    this.raw = store;
    this.clock = new ServerClock();
    this.ids = new IdSource();
    this.logs = [];
    this.test = wrapStore(store, this.clock);
  }

  // Built at the first request, so a missing port fails the When step, not the scenario's setup.
  async handle(request) {
    this.port ??= createTablePort(this.test.store);
    const log = entry => this.logs.push(typeof entry === 'string' ? JSON.parse(entry) : entry);
    return readAnswer(await handleScores(request, this.port, { now: this.clock.now, newId: this.ids.next, log, where: LOCAL }));
  }

  // Raw listing (see the header): it must not move the server's clock.
  async snapshot() {
    const clockBefore = this.clock.t;
    const keys = (await this.raw.list()).blobs.map(blob => blob.key).sort();
    expect(this.clock.t, 'observing the store must not move the server clock').toBe(clockBefore);
    return { 'table.scores': keys.filter(key => SCORE_KEY.test(key)), 'table.leftovers': keys.filter(key => !SCORE_KEY.test(key)) };
  }

  async write(key) {
    const { modified } = await this.raw.set(key, '', { onlyIfNew: true });
    expect(modified, `the store already held ${key}`).toBe(true);
  }
}

const get = () => new Request(URL, { method: 'GET' });

export class TableService {
  static async start() {
    const directory = await mkdtemp(join(tmpdir(), 'make-the-right-move-table-service-'));
    const token = randomUUID();
    const server = new BlobsServer({ directory, token });
    const { port } = await server.start();
    return new TableService({ directory, server, token, url: `http://localhost:${port}` });
  }

  constructor(emulator) {
    this.emulator = emulator;
    this.table = this.newTable();
  }

  newTable() {
    const { token, url } = this.emulator;
    return new Table(getStore({ name: `leaderboard-${randomUUID()}`, siteID: 'local', token, edgeURL: url, uncachedEdgeURL: url, consistency: 'strong' }));
  }

  async stop() {
    await this.emulator.server.stop();
    await rm(this.emulator.directory, { recursive: true, force: true });
  }

  // ---- arranging (straight into the store: these are preconditions, not signings) ----
  async expectEmpty() {
    expect(await this.table.snapshot(), 'a fresh table should hold nothing').toEqual({ 'table.scores': [], 'table.leftovers': [] });
  }

  async holdSignature(initials, score, at = START.getTime(), id = 'held1') {
    await this.table.write(scoreKey({ initials, score, at, id }));
  }

  // | initials | deposit | signed at | (HH:MM on the scenario's day)
  async holdSignatures(dataTable) {
    const rows = dataTable.hashes();
    for (const [i, { initials, deposit, 'signed at': time }] of rows.entries()) {
      const [hours, minutes] = time.split(':').map(Number);
      const at = Date.UTC(START.getUTCFullYear(), START.getUTCMonth(), START.getUTCDate(), hours, minutes);
      await this.holdSignature(initials, Number(deposit.replace(/[£,]/g, '')), at, `held${i + 1}`);
    }
  }

  // n scores worth £50, £100, ... (all below £10,000), signed a second apart.
  async holdScores(count) {
    for (let i = 0; i < count; i++) {
      await this.holdSignature(OTHER_HOUSE_HUNTERS[i % OTHER_HOUSE_HUNTERS.length], 50 * (i + 1), START.getTime() + i * 1000, `held${i + 1}`);
    }
  }

  async holdStrayEntries() {
    for (const key of LEFTOVER_KEYS) await this.table.write(key);
  }

  failWhen(action) { this.table.test.failing.add(STORE_OPERATION[action]); }

  // The same moment and the same new-row id for every signature, so the next signature lands on an existing row.
  repeatTheSameRow() {
    this.table.clock.frozen = true;
    this.table.ids.fixed = 'dup1';
  }

  // An id that can't be part of a well-formed key, so the port must refuse the row (DDD-4).
  makeRowsItCantFile() { this.table.ids.fixed = 'NOT-AN-ID'; }

  async saved(signature) {
    await this.receive(signature);
    expect(this.last.answer.status, `arranging: the table did not save ${this.last.sent?.initials}`).toBe(200);
  }

  // ---- acting ----
  async read() { await this.act(get()); }

  async receive(signature) {
    const sent = this.resolve(signature);
    const headers = { 'content-type': sent.wrongFormat ? 'text/plain;charset=UTF-8' : 'application/json' };
    await this.act(new Request(URL, { method: 'POST', headers, body: this.bodyFor(sent) }), sent);
  }

  async ask(request) {
    const method = HTTP_METHOD[request];
    await this.act(new Request(URL, { method, headers: { 'content-type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}' }));
  }

  async act(request, sent = null) {
    const before = await this.table.snapshot();
    const logged = this.table.logs.length;
    const answer = await this.table.handle(request);
    this.last = { sent, answer, before, after: await this.table.snapshot(), logs: this.table.logs.slice(logged), listedAt: this.table.test.listing.returnedAt };
  }

  resolve(signature) {
    if (!signature.blocked) return signature;
    const [blocked] = BLOCKED_INITIALS;
    expect(blocked, 'DATA GAP: the owner-reviewed word list is empty (BLOCKED_INITIALS in src/game/high-scores.js)').toBeTruthy();
    return { ...signature, initials: blocked };
  }

  bodyFor(sent) {
    if (sent.garbled) return 'initials=FAB&score=1000';
    const json = JSON.stringify({ initials: sent.initials, ...(sent.score === undefined ? {} : { score: sent.score }), ...(sent.note ? { note: 'first time on the table' } : {}) });
    if (!sent.stretchTo) return json;
    expect(Buffer.byteLength(json), 'the signature is already longer than the padding').toBeLessThanOrEqual(sent.stretchTo);
    return json + ' '.repeat(sent.stretchTo - Buffer.byteLength(json));
  }

  // ---- properties: the When chooses the generator, the Then states the invariant ----
  forAnyBatch(atMost) {
    const signature = fc.record({ initials: fc.constantFrom(...OTHER_HOUSE_HUNTERS), score: fc.integer({ min: 1, max: 400 }).map(units => units * 50) });
    this.batches = fc.uniqueArray(signature, { selector: s => s.score, minLength: 1, maxLength: atMost });
  }

  // OUT-9: every signer is answered, and the table read afterwards is exactly the batch's true top 10: no signature that
  // belongs there is lost. Scores are distinct, so the true top 10 is unambiguous (as in the SPIKE).
  // Not checked here: that each top-10 signer finds their own row in their own answer. The emulator can't promise it:
  // its listing walks the directory with readdir then stat, and a temporary file renamed in between ends the walk on
  // ENOENT, so a listing taken during concurrent writes can come back short (even empty) with a 200. That is K11's check,
  // on real Netlify Blobs (the DEVOPS burst run). Runs: 20 batches of up to 30, seed 20261023 (rotate FC_SEED in nightly runs).
  async checkNoSignatureLost() {
    await fc.assert(fc.asyncProperty(this.batches, async batch => {
      const table = this.newTable();
      const post = s => new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(s) });
      const answers = await Promise.all(batch.map(s => table.handle(post(s))));
      const read = await table.handle(get());
      const best = [...batch].sort((a, b) => b.score - a.score).slice(0, TABLE_SIZE);
      expect(answers.map(a => a.status), 'every valid signature is answered 200').toEqual(batch.map(() => 200));
      expect(read.body?.scores?.map(({ initials, score }) => ({ initials, score })), 'the table is the best 10 of the batch').toEqual(best);
    }), { seed: SEED, numRuns: PROPERTY_RUNS });
  }

  // ---- observing ----
  expectAnswer(status) {
    expect(this.last.answer.status, `answer: ${this.last.answer.text}`).toBe(status);
    expect(this.last.answer.headers['content-type'] ?? '', 'every answer from the function is JSON').toMatch(/^application\/json/);
    expect(this.last.answer.headers, 'headers on every answer').toMatchObject(Caching.EVERY_ANSWER);
  }

  expectAccepted() { this.expectAnswer(200); }

  expectRows(dataTable) {
    const expected = dataTable.hashes().map(({ initials, deposit }) => ({ initials, score: Number(deposit.replace(/[£,]/g, '')) }));
    this.expectAnswer(200);
    expect(this.last.answer.body.scores.map(({ initials, score }) => ({ initials, score }))).toEqual(expected);
  }

  expectNoRows() {
    this.expectAnswer(200);
    expect(this.last.answer.body).toEqual({ scores: [], listedAt: expect.any(Number) });
  }

  // listedAt is the server's time right after its listing returned (DDD-12), and after anything it wrote.
  expectListedAt() {
    const { body } = this.last.answer;
    expect(this.last.listedAt, 'the table was never looked at').not.toBeNull();
    expect(body.listedAt, 'listedAt must be taken right after the listing returns').toBe(this.last.listedAt);
    const written = this.added().map(key => readScoreKey(key).at);
    for (const at of written) expect(body.listedAt, 'the listing comes after the save').toBeGreaterThan(at);
  }

  // Shared by the CDN for at most 15 s, and revalidated by every browser: so nobody sees it more than 15 s old.
  expectSharedForAtMost15Seconds() {
    this.expectAnswer(200);
    expect(this.last.answer.headers).toMatchObject(Caching.SHARED_15_SECONDS);
  }

  expectNeverKept() { expect(this.last.answer.headers).toMatchObject(Caching.NEVER_KEPT); }

  expectRefused(refusal) {
    this.lastRefusal = refusal;
    this.expectAnswer(refusal.status);
    expect(this.last.answer.body).toEqual({ error: refusal.error });
    this.expectNeverKept();
    if (refusal.allow) expect(this.last.answer.headers.allow?.replace(/\s+/g, ' ')).toBe(refusal.allow);
  }

  expectUnchanged() { assertStateDelta(this.last.before, this.last.after, { universe: UNIVERSE }); }

  added() { return this.last.after['table.scores'].filter(key => !this.last.before['table.scores'].includes(key)); }

  expectOneNewRow() {
    const { initials, score } = this.last.sent;
    assertStateDelta(this.last.before, this.last.after, {
      universe: UNIVERSE,
      expected: {
        'table.scores': satisfying(`one new row for ${initials} with £${score}`, (before, after) => {
          const added = after.filter(key => !before.includes(key));
          return after.length === before.length + 1 && added.length === 1 && readScoreKey(added[0])?.initials === initials && readScoreKey(added[0])?.score === score;
        }),
      },
    });
  }

  // DDD-6: a write that threw leaves 0 or +1 rows (unknown), never more, and nothing else changes.
  expectAtMostOneNewRow() {
    assertStateDelta(this.last.before, this.last.after, {
      universe: UNIVERSE,
      expected: { 'table.scores': satisfying('at most one new row, none removed', (before, after) => before.every(key => after.includes(key)) && after.length - before.length <= 1) },
    });
  }

  expectNewRowRanked(initials, rank) {
    this.expectAnswer(200);
    const { scores, id } = this.last.answer.body;
    expect(typeof id, 'the answer carries the new row\'s id').toBe('string');
    expect(scores[rank - 1]).toMatchObject({ initials, id });
    expect(this.added().map(key => readScoreKey(key).id), 'the id is the saved row\'s').toContain(id);
  }

  expectRankedTwice(initials, first, second) {
    this.expectAnswer(200);
    const { scores } = this.last.answer.body;
    expect([scores[first - 1]?.initials, scores[second - 1]?.initials]).toEqual([initials, initials]);
  }

  // One log line per request, with its fixed reason.
  expectLogged(failure) {
    expect(this.last.logs, 'one log line per request').toHaveLength(1);
    expect(this.last.logs[0]).toMatchObject(LOG_LINE[failure]);
  }

  expectRefusalLogged() {
    expect(this.last.logs, 'one log line per request').toHaveLength(1);
    expect(this.last.logs[0]).toMatchObject({ event: 'scores.rejected', reason: this.lastRefusal.error });
    expect(this.last.logs[0]).toMatchObject({ ...LOCAL, ms: expect.any(Number) });
  }

  // DDD-17: the fixed reason, how long it took, how many well-formed keys were listed, and where the table is kept.
  expectReadLogged() {
    expect(this.last.logs, 'one log line per request').toHaveLength(1);
    expect(this.last.logs[0]).toMatchObject({ event: 'scores.read', reason: 'ok', ms: expect.any(Number), keys: this.last.after['table.scores'].length, ...LOCAL });
  }

  expectSigningLogged() {
    expect(this.last.logs, 'one log line per request').toHaveLength(1);
    expect(this.last.logs[0]).toMatchObject({ event: 'scores.signed', reason: 'ok', ms: expect.any(Number), keys: this.last.before['table.scores'].length + 1, ...LOCAL });
  }

  // Never logged: a key, initials or an id (DDD-17), even when the store's error message carries a key.
  expectLogSaysNothingAboutThePlayer() {
    expect(this.last.logs.length, 'the request was not logged at all').toBeGreaterThan(0);
    const logged = JSON.stringify(this.last.logs);
    expect(logged).not.toMatch(/s\/\d{7}-/);
    expect(logged).not.toContain('FAB');
    expect(logged).not.toContain('held1');
  }

  // k = min(5, n - 20), n being the well-formed scores listed after the write; every one removed was ranked 11th or lower.
  // The signature in these scenarios outranks everything held, so its own row is never the one tidied away (a signature
  // that is itself ranked 11th or lower may be pruned at once; the answer then rightly shows it as off the table, ADR-008).
  expectGainedAndLost(initials, { count }) {
    const listing = [...this.last.before['table.scores'], ...this.added()].sort();   // the listing the signing pruned from
    assertStateDelta(this.last.before, this.last.after, {
      universe: UNIVERSE,
      expected: {
        'table.scores': satisfying(`one new row for ${initials}, and ${count} old scores removed, all ranked 11th or lower`, (before, after) => {
          const added = after.filter(key => !before.includes(key));
          const removed = before.filter(key => !after.includes(key));
          return added.length === 1 && readScoreKey(added[0])?.initials === initials && removed.length === count && removed.every(key => listing.indexOf(key) >= TABLE_SIZE);
        }),
      },
    });
  }

  expectStrayEntriesKept() { expect(this.last.after['table.leftovers']).toEqual(expect.arrayContaining([...LEFTOVER_KEYS])); }
}
