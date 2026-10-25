import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { startBlobsEmulator } from './support/blobs-emulator.js';
import { isAllowedInitials } from '../../src/game/high-scores.js';
import { createTablePort, encodeKey, handleScores, logToConsole } from '../../netlify/functions/scores.mjs';
import { assertStateDelta, satisfying } from '../common/state-delta.js';

// Nothing about a player reaches the function's log (DDD-17), whatever fails: a store error's message can carry a key,
// and so initials and an id, and Netlify logs whatever reaches the console. The handler is given the production console
// logger and the production port, over a real BlobsServer store whose list, set and delete (any of them) throw an error
// naming a score key. Every console method is captured, so a line on any of them is seen.
// The universe of every state delta: the keys in the table's store.

const URL = 'http://localhost/api/scores';
const UNIVERSE = ['table.keys'];
const RUNS = 15;
const NOW = 1_767_225_600_000;
const LOCAL = Object.freeze({ scope: 'local', context: 'missing', published: 'missing' });
const CONSOLE = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
const STORE_OPERATIONS = ['list', 'set', 'delete'];
const A_KEY = /s\/\d{7}-/;

let emulator;
test.beforeAll(async () => { emulator = await startBlobsEmulator('scores-log-leak'); });
test.afterAll(() => emulator.stop());

const freshStore = () => emulator.freshStore();
const snapshot = async store => ({ 'table.keys': (await store.list()).blobs.map(blob => blob.key).sort() });

// The real store, with the chosen operations throwing an error that names a key: the key it was given, or for a
// listing, one of the player's.
function failing(store, operations, playerKey) {
  const named = { list: () => playerKey, set: key => key, delete: key => key };
  const thrown = Object.fromEntries(operations.map(operation => [operation, async key => {
    throw new Error(`The store could not ${operation} ${named[operation](key)}`);
  }]));
  return new Proxy(store, {
    get(target, name) {
      if (Object.hasOwn(thrown, name)) return thrown[name];
      const value = Reflect.get(target, name, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function capturingConsole(call) {
  const lines = [];
  const originals = CONSOLE.map(method => [method, console[method]]);
  for (const method of CONSOLE) console[method] = (...args) => lines.push({ method, text: args.map(String).join(' ') });
  try { return { response: await call(), lines }; } finally {
    for (const [method, original] of originals) console[method] = original;
  }
}

// A player whose initials and id appear in every key the store holds or names: the rows held are theirs too. Ids start
// with "zq", which no log line's fixed text contains, so finding one in a line means it leaked.
const player = fc.record({
  // Never on the word filter: a POST with those is refused 400 before a row's time is read, so the clock test's 500 can't come.
  initials: fc.stringMatching(/^[A-Z]{3}$/).filter(isAllowedInitials),
  id: fc.stringMatching(/^zq[a-z0-9]{4,10}$/),
  score: fc.integer({ min: 1, max: 2000 }).map(units => units * 50),
});
const operations = fc.subarray(STORE_OPERATIONS, { minLength: 1 });
const method = fc.constantFrom('GET', 'POST');
const held = fc.integer({ min: 0, max: 24 });   // either side of the 20 kept before pruning starts

async function holdRows(store, { initials, id }, count) {
  for (let i = 0; i < count; i++) await store.set(encodeKey({ initials, score: 50 * (i + 1), at: NOW + i, id: `${id}${i}` }), '');
}

const requestFor = (verb, { initials, score }) => verb === 'GET'
  ? new Request(URL)
  : new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initials, score }) });

function expectSaysNothingAbout({ initials, id }, lines) {
  for (const { text } of lines) {
    expect(text, 'a key reached the console').not.toMatch(A_KEY);
    expect(text, 'the initials reached the console').not.toContain(initials);
    expect(text, 'an id reached the console').not.toContain(id);
  }
}

test('whatever part of the store fails, every request is answered, the console says nothing about the player, and no row is lost', async () => {
  await fc.assert(fc.asyncProperty(player, operations, method, held, async (who, broken, verb, count) => {
    const store = freshStore();
    await holdRows(store, who, count);
    const port = createTablePort(failing(store, broken, encodeKey({ ...who, at: NOW })));
    const before = await snapshot(store);
    const { response, lines } = await capturingConsole(() =>
      handleScores(requestFor(verb, who), port, { now: () => NOW, newId: () => who.id, log: logToConsole, where: LOCAL }));
    expect(response).toBeInstanceOf(Response);
    expectSaysNothingAbout(who, lines);
    expect(lines.map(({ method }) => method), 'the log is one line, on console.log').toEqual(lines.map(() => 'log'));
    if (response.status === 500) {
      expect(await response.json()).toEqual({ error: 'unexpected' });
      expect(lines.map(({ text }) => JSON.parse(text).event), 'one log line per request').toEqual(['scores.error']);
    }
    if (verb === 'GET' && broken.includes('list')) {
      expect(response.status).toBe(500);
      expect(JSON.parse(lines[0].text)).toEqual({ event: 'scores.error', reason: 'list-failed', ms: expect.any(Number), ...LOCAL });
    }
    assertStateDelta(before, await snapshot(store), {
      universe: UNIVERSE,
      expected: { 'table.keys': satisfying('none removed, at most one added', (was, now) => was.every(key => now.includes(key)) && now.length - was.length <= 1) },
    });
  }), { numRuns: RUNS, examples: [[{ initials: 'FAB', id: 'zqt1', score: 1000 }, ['list'], 'GET', 1]] });
});

test('when the clock itself fails, the answer is 500 unexpected, logged once as unexpected, and the console says nothing about the player', async () => {
  await fc.assert(fc.asyncProperty(player, method, held, async (who, verb, count) => {
    const store = freshStore();
    await holdRows(store, who, count);
    const before = await snapshot(store);
    const brokenClock = () => { throw new Error(`The clock failed while filing ${encodeKey({ ...who, at: NOW })}`); };
    const { response, lines } = await capturingConsole(() =>
      handleScores(requestFor(verb, who), createTablePort(store), { now: brokenClock, newId: () => who.id, log: logToConsole, where: LOCAL }));
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'unexpected' });
    expect(lines.map(({ method }) => method), 'one log line per request').toEqual(['log']);
    expect(JSON.parse(lines[0].text)).toMatchObject({ event: 'scores.error', reason: 'unexpected', ...LOCAL });
    expectSaysNothingAbout(who, lines);
    assertStateDelta(before, await snapshot(store), { universe: UNIVERSE });
  }), { numRuns: RUNS });
});
