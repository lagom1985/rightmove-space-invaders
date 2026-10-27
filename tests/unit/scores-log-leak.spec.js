import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { startBlobsEmulator } from './support/blobs-emulator.js';
import { isAllowedInitials } from '../../src/game/high-scores.js';
import { createTablePort, encodeKey, handleScores, logToConsole } from '../../netlify/functions/scores.mjs';
import { createSessionSigner, readSessionSecret } from '../../netlify/scores/sessions.mjs';
import { TEST_SECRET } from '../common/session-secret.js';
import { assertStateDelta, satisfying } from '../common/state-delta.js';
import { createGameSupply } from '../common/played-games.js';

// Nothing about a player reaches the function's log (DDD-17, DDD-R14), whatever fails: a store error's message can
// carry a key, and so initials and an id, and Netlify logs whatever reaches the console. Every signing carries a session
// and the record of the player's game (rightmove-invaders-replay-verified-scores), a game really played in Node to its
// deposit (tests/common/played-games.js), so its seed, its game id (the new row's id), its token, the session and the
// record are the player's too. The handler is given the production console logger and the production port, over a real
// BlobsServer store whose list, set and delete (any of them) throw an error naming a score key, and the signing part of
// a signer built as the roots build theirs, from a known test secret (DDD-R17). Every console method is captured, so a
// line on any of them is seen.
// The universe of every state delta: the keys in the table's store.

const URL = 'http://localhost/api/scores';
const UNIVERSE = ['table.keys'];
const RUNS = 15;
const NOW = 1_767_225_600_000;
const LOCAL = Object.freeze({ scope: 'local', context: 'missing', published: 'missing' });
const CONSOLE = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
const STORE_OPERATIONS = ['list', 'set', 'delete'];
const A_KEY = /s\/\d{7}-/;
const signer = createSessionSigner(readSessionSecret(TEST_SECRET));
const SIGNING = Object.freeze({ verify: signer.verify, gameId: signer.gameId });
const gameIdOf = seed => createHash('sha256').update(seed).digest('hex').slice(0, 32);

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

// A player whose initials and an id of theirs appear in every key the store holds or names: the rows held are theirs
// too, their ids starting with "zq", which no log line's fixed text contains, so finding one in a line means it leaked.
// Their signing is their game's: the deposit it played to, a session the table sealed for its seed, and its record,
// whose keys change often enough to be text of their own. The row it writes has the game id.
const GAMES = (supply => [350, 1000, 1250, 1500].map(deposit => supply.take(deposit)))(createGameSupply());
const player = fc.record({
  // Never on the word filter: a POST with those is refused 400 before a row's time is read, so the clock test's 500 can't come.
  initials: fc.stringMatching(/^[A-Z]{3}$/).filter(isAllowedInitials),
  id: fc.stringMatching(/^zq[a-z0-9]{4,10}$/),
  game: fc.constantFrom(...GAMES),
}).map(({ initials, id, game }) => ({ initials, id, seed: game.seed, score: game.deposit, record: game.record, steps: game.steps }));
// The session is issued as long before NOW as the game lasted, plus a second, as a real game's is (the acceptance
// harness's rule), so the clock check (row 14) lets the signing through.
const issuedOnTime = steps => NOW - Math.ceil(steps * 1000 / 120) - 1000;
const sessionOf = ({ seed, steps }) => ({ seed, issuedAt: issuedOnTime(steps), token: signer.sign(seed, issuedOnTime(steps)) });
const ownKey = who => encodeKey({ ...who, at: NOW, id: gameIdOf(who.seed) });
const operations = fc.subarray(STORE_OPERATIONS, { minLength: 1 });
const method = fc.constantFrom('GET', 'POST');
const held = fc.integer({ min: 0, max: 24 });   // either side of the 20 kept before pruning starts

async function holdRows(store, { initials, id }, count) {
  for (let i = 0; i < count; i++) await store.set(encodeKey({ initials, score: 50 * (i + 1), at: NOW + i, id: `${id}${i}` }), '');
}

const requestFor = (verb, who) => verb === 'GET'
  ? new Request(URL)
  : new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initials: who.initials, score: who.score, session: sessionOf(who), record: who.record }) });

function expectSaysNothingAbout(who, lines) {
  const session = sessionOf(who);
  for (const { text } of lines) {
    expect(text, 'a key reached the console').not.toMatch(A_KEY);
    expect(text, 'the initials reached the console').not.toContain(who.initials);
    expect(text, 'an id reached the console').not.toContain(who.id);
    expect(text, 'the seed reached the console').not.toContain(who.seed);
    expect(text, 'the game id reached the console').not.toContain(gameIdOf(who.seed));
    expect(text, 'the session\'s token reached the console').not.toContain(session.token);
    expect(text, 'the session reached the console').not.toContain(JSON.stringify(session));
    expect(text, 'the record reached the console').not.toContain(JSON.stringify(who.record));
    expect(text, 'the record\'s keys reached the console').not.toContain(who.record.keys);
  }
}

// A signing that reached its replay carries the replay's steps and replayMs on its line (DDD-R14); a GET, neither. This
// player's signing passes every check before the replay, so every POST here replayed, whatever the store did after.
function expectReplayNoted(verb, who, lines) {
  for (const { text } of lines) {
    const line = JSON.parse(text);
    if (verb === 'POST') expect(line, 'a line that replayed').toMatchObject({ steps: who.steps, replayMs: expect.any(Number) });
    else expect([Object.hasOwn(line, 'steps'), Object.hasOwn(line, 'replayMs')], 'a line that never replayed: no steps, no replayMs').toEqual([false, false]);
  }
}

test('whatever part of the store fails, every request is answered and the console says nothing about the player, its record included, and no row is lost', async () => {
  await fc.assert(fc.asyncProperty(player, operations, method, held, async (who, broken, verb, count) => {
    const store = freshStore();
    await holdRows(store, who, count);
    const port = createTablePort(failing(store, broken, ownKey(who)));
    const before = await snapshot(store);
    const { response, lines } = await capturingConsole(() =>
      handleScores(requestFor(verb, who), port, { now: () => NOW, log: logToConsole, where: LOCAL, sessions: SIGNING }));
    expect(response).toBeInstanceOf(Response);
    expectSaysNothingAbout(who, lines);
    expectReplayNoted(verb, who, lines);
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
  }), { numRuns: RUNS, examples: [[{ initials: 'FAB', id: 'zqt1', seed: GAMES[0].seed, score: GAMES[0].deposit, record: GAMES[0].record, steps: GAMES[0].steps }, ['list'], 'GET', 1]] });
});

test('when the clock itself fails, the answer is 500 unexpected, logged once as unexpected, and the console says nothing about the player', async () => {
  await fc.assert(fc.asyncProperty(player, method, held, async (who, verb, count) => {
    const store = freshStore();
    await holdRows(store, who, count);
    const before = await snapshot(store);
    const brokenClock = () => { throw new Error(`The clock failed while filing ${ownKey(who)} for ${JSON.stringify(sessionOf(who))}`); };
    const { response, lines } = await capturingConsole(() =>
      handleScores(requestFor(verb, who), createTablePort(store), { now: brokenClock, log: logToConsole, where: LOCAL, sessions: SIGNING }));
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'unexpected' });
    expect(lines.map(({ method }) => method), 'one log line per request').toEqual(['log']);
    expect(JSON.parse(lines[0].text)).toMatchObject({ event: 'scores.error', reason: 'unexpected', ...LOCAL });
    expectSaysNothingAbout(who, lines);
    assertStateDelta(before, await snapshot(store), { universe: UNIVERSE });
  }), { numRuns: RUNS });
});
