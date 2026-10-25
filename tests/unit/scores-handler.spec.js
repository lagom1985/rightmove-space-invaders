import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { startBlobsEmulator } from './support/blobs-emulator.js';
import { TABLE_SIZE } from '../../src/game/high-scores.js';
import { createTablePort, encodeKey, handleScores } from '../../netlify/functions/scores.mjs';
import { assertStateDelta, satisfying } from '../common/state-delta.js';

// The read path is handed the port's listing and nothing else (DDD-4): a GET can't save or remove a row, because it
// holds no way to. The port is the production one, over a real BlobsServer (DDD-19), with only `list` passed on.
// The universe of the state delta: the keys in the table's store.

const URL = 'http://localhost/api/scores';
const UNIVERSE = ['table.keys'];
const NOW = 1_767_225_600_000;
const LOCAL = Object.freeze({ scope: 'local', context: 'missing', published: 'missing' });

let emulator;
test.beforeAll(async () => { emulator = await startBlobsEmulator('scores-handler'); });
test.afterAll(() => emulator.stop());

const freshStore = () => emulator.freshStore();
const snapshot = async store => ({ 'table.keys': (await store.list()).blobs.map(blob => blob.key).sort() });

// Rows as they are held; no two share a score and a moment, so arcade order has one answer.
const row = fc.record({
  initials: fc.stringMatching(/^[A-Z]{3}$/),
  score: fc.integer({ min: 1, max: 2000 }).map(units => units * 50),
  at: fc.integer({ min: NOW - 86_400_000, max: NOW }),
  id: fc.stringMatching(/^[a-z0-9]{1,12}$/),
});
const held = fc.uniqueArray(row, { maxLength: 14, selector: r => `${r.score}-${r.at}` });
const arcadeOrder = (a, b) => b.score - a.score || a.at - b.at;

test('a GET handed only the listing answers 200 with the best ten rows held, and leaves the table as it was', async () => {
  await fc.assert(fc.asyncProperty(held, async rows => {
    const store = freshStore();
    for (const r of rows) await store.set(encodeKey(r), '');
    const { list } = createTablePort(store);
    const before = await snapshot(store);
    const response = await handleScores(new Request(URL), Object.freeze({ list }), { now: () => NOW, newId: () => 'unused', log: () => {}, where: LOCAL });
    expect(response.status).toBe(200);
    const best = [...rows].sort(arcadeOrder).slice(0, TABLE_SIZE).map(({ initials, score, id }) => ({ initials, score, id }));
    expect(await response.json()).toEqual({ scores: best, listedAt: NOW });
    assertStateDelta(before, await snapshot(store), { universe: UNIVERSE });
  }), { numRuns: 15 });
});

// A body's size is what is read from it, never what its Content-Length claims (DDD-5): a valid signature padded past
// 1 KB (1,024 bytes), claiming to be 1 KB or less and arriving in any chunks, is answered 413 and saves nothing.
const KB = 1024;
const signature = fc.record({ initials: fc.stringMatching(/^[A-Z]{3}$/), score: fc.integer({ min: 1, max: 2000 }).map(units => units * 50) });
const claimed = fc.integer({ min: 1, max: KB });
const pastOneKB = fc.integer({ min: KB + 1, max: 4 * KB });
const cuts = fc.uniqueArray(fc.integer({ min: 1, max: 4 * KB }), { maxLength: 6 });

function streamed(bytes, at) {
  const ends = [...at.filter(cut => cut < bytes.length).sort((a, b) => a - b), bytes.length];
  return new ReadableStream({
    start(controller) {
      ends.reduce((start, end) => { controller.enqueue(bytes.slice(start, end)); return end; }, 0);
      controller.close();
    },
  });
}

test('a POST that claims to be small but runs past 1 KB answers 413 payload-too-large, never kept, and saves nothing', async () => {
  await fc.assert(fc.asyncProperty(signature, claimed, pastOneKB, cuts, async (signed, length, size, at) => {
    const store = freshStore();
    const json = JSON.stringify(signed);
    const bytes = new TextEncoder().encode(json + ' '.repeat(size - json.length));
    const headers = { 'content-type': 'application/json', 'content-length': String(length) };
    const request = new Request(URL, { method: 'POST', headers, body: streamed(bytes, at), duplex: 'half' });
    const before = await snapshot(store);
    const response = await handleScores(request, createTablePort(store), { now: () => NOW, newId: () => 'unused', log: () => {}, where: LOCAL });
    expect(response.status).toBe(413);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'payload-too-large' });
    assertStateDelta(before, await snapshot(store), { universe: UNIVERSE });
  }), { numRuns: 15, examples: [[{ initials: 'FAB', score: 1000 }, 20, KB + 1, []]] });
});

// A refusal is a bug, never a failed tidy-up (DDD-1, DDD-4): when the handler's port hands the real port's remove a key
// it refuses while tidying up, the signing answers 500 unexpected and is logged as unexpected, never prune-failed.
// The real port refuses every one of those keys, so the new row stays and no old score is removed.
// Held: 20 to 30 rows, so the listing after the write is over 20 keys and the signing always tidies up.
const enoughToTidy = fc.uniqueArray(row, { minLength: 20, maxLength: 30, selector: r => `${r.score}-${r.at}` });
const REFUSED = [key => `${key}\n`, key => `${key} `, key => `archive/${key}`, key => key.toLowerCase(), key => key.replace(/^s\/\d/, 's/')];

test('a key refused while tidying up answers 500 unexpected, logged as unexpected and never prune-failed', async () => {
  await fc.assert(fc.asyncProperty(enoughToTidy, signature, fc.constantFrom(...REFUSED), async (rows, signed, refused) => {
    const store = freshStore();
    for (const r of rows) await store.set(encodeKey(r), '');
    const real = createTablePort(store);
    const port = Object.freeze({ list: real.list, putIfNew: real.putIfNew, remove: key => real.remove(refused(key)) });
    const logs = [];
    const request = new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(signed) });
    const before = await snapshot(store);
    const response = await handleScores(request, port, { now: () => NOW + 1, newId: () => 'signed1', log: entry => logs.push(entry), where: LOCAL });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'unexpected' });
    expect(logs.map(({ event, reason }) => ({ event, reason }))).toEqual([{ event: 'scores.error', reason: 'unexpected' }]);
    assertStateDelta(before, await snapshot(store), {
      universe: UNIVERSE,
      expected: { 'table.keys': satisfying('the new row added, no old score removed', (was, now) => now.length === was.length + 1 && was.every(key => now.includes(key))) },
    });
  }), { numRuns: 10 });
});
