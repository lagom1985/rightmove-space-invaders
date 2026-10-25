import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { getStore } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import { TABLE_SIZE } from '../../src/game/high-scores.js';
import { createTablePort, encodeKey, handleScores } from '../../netlify/functions/scores.mjs';
import { assertStateDelta } from '../common/state-delta.js';

// The read path is handed the port's listing and nothing else (DDD-4): a GET can't save or remove a row, because it
// holds no way to. The port is the production one, over a real BlobsServer (DDD-19), with only `list` passed on.
// The universe of the state delta: the keys in the table's store.

const URL = 'http://localhost/api/scores';
const UNIVERSE = ['table.keys'];
const NOW = 1_767_225_600_000;
const LOCAL = Object.freeze({ scope: 'local', context: 'missing', published: 'missing' });

let emulator;

test.beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'make-the-right-move-scores-handler-'));
  const token = randomUUID();
  const server = new BlobsServer({ directory, token });
  const { port } = await server.start();
  emulator = { directory, server, token, url: `http://localhost:${port}` };
});

test.afterAll(async () => {
  await emulator.server.stop();
  await rm(emulator.directory, { recursive: true, force: true });
});

const freshStore = () => getStore({
  name: `leaderboard-${randomUUID()}`, siteID: 'local', token: emulator.token,
  edgeURL: emulator.url, uncachedEdgeURL: emulator.url, consistency: 'strong',
});
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
