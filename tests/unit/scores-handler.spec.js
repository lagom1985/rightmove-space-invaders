import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { startBlobsEmulator } from './support/blobs-emulator.js';
import { TABLE_SIZE, isAllowedInitials } from '../../src/game/high-scores.js';
import { createTablePort, decodeKey, encodeKey, handleScores, handleSessions } from '../../netlify/functions/scores.mjs';
import { createSessionSigner, readSessionSecret } from '../../netlify/scores/sessions.mjs';
import { TEST_SECRET } from '../common/session-secret.js';
import { assertStateDelta, satisfying, setTo } from '../common/state-delta.js';

// The read path is handed the port's listing and nothing else (DDD-4): a GET can't save or remove a row, because it
// holds no way to. The port is the production one, over a real BlobsServer (DDD-19), with only `list` passed on.
// Every signing carries a session for its game (rightmove-invaders-replay-verified-scores, DDD-R1), sealed by a signer
// built as the roots build theirs, from a known test secret (DDD-R17), and the handler is handed only the signer's
// verify and gameId: a row's id is its game id, so there is no id source to hand it (DDD-R4).
// The universe of the state delta: the keys in the table's store.

const URL = 'http://localhost/api/scores';
const SESSIONS_URL = 'http://localhost/api/sessions';
const UNIVERSE = ['table.keys'];
const NOW = 1_767_225_600_000;
const LOCAL = Object.freeze({ scope: 'local', context: 'missing', published: 'missing' });
const JSON_TYPE = Object.freeze({ 'content-type': 'application/json' });

const signer = createSessionSigner(readSessionSecret(TEST_SECRET));
// Each handler's part of the signer, as the roots hand them (DDD-R1, the user, 2026-10-27).
const ISSUING = Object.freeze({ sign: signer.sign });
const SIGNING = Object.freeze({ verify: signer.verify, gameId: signer.gameId });
// A row's id is its game id (DDD-R4, C1), computed here on its own, never by the code under test.
const gameIdOf = seed => createHash('sha256').update(seed).digest('hex').slice(0, 32);
const sessionFor = (seed, issuedAt = NOW) => ({ seed, issuedAt, token: signer.sign(seed, issuedAt) });

let emulator;
test.beforeAll(async () => { emulator = await startBlobsEmulator('scores-handler'); });
test.afterAll(() => emulator.stop());

const freshStore = () => emulator.freshStore();
const snapshot = async store => ({ 'table.keys': (await store.list()).blobs.map(blob => blob.key).sort() });

// Rows as they are held; no two share a score and a moment, so arcade order has one answer, and each is a game of its
// own, so every key held is a row (one row per game, DDD-R4).
const row = fc.record({
  initials: fc.stringMatching(/^[A-Z]{3}$/),
  score: fc.integer({ min: 1, max: 2000 }).map(units => units * 50),
  at: fc.integer({ min: NOW - 86_400_000, max: NOW }),
  id: fc.stringMatching(/^[a-z0-9]{1,12}$/),
});
const held = fc.uniqueArray(row, { maxLength: 14, comparator: (a, b) => a.id === b.id || (a.score === b.score && a.at === b.at) });
const arcadeOrder = (a, b) => b.score - a.score || a.at - b.at;
const bestTen = rows => [...rows].sort(arcadeOrder).slice(0, TABLE_SIZE).map(({ initials, score, id }) => ({ initials, score, id }));
const seed = fc.stringMatching(/^[0-9a-f]{32}$/);

test('a GET handed only the listing answers 200 with the best ten rows held, and leaves the table as it was', async () => {
  await fc.assert(fc.asyncProperty(held, async rows => {
    const store = freshStore();
    for (const r of rows) await store.set(encodeKey(r), '');
    const { list } = createTablePort(store);
    const before = await snapshot(store);
    const response = await handleScores(new Request(URL), Object.freeze({ list }), { now: () => NOW, log: () => {}, where: LOCAL });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ scores: bestTen(rows), listedAt: NOW });
    assertStateDelta(before, await snapshot(store), { universe: UNIVERSE });
  }), { numRuns: 15 });
});

// A body's size is what is read from it, never what its Content-Length claims (DDD-5): a valid signing padded past
// 1 KB (1,024 bytes), claiming to be 1 KB or less and arriving in any chunks, is answered 413 and saves nothing.
const KB = 1024;
// Never on the word filter: a POST with those is refused 400 before anything is saved, which no signing below expects.
const signature = fc.record({ initials: fc.stringMatching(/^[A-Z]{3}$/).filter(isAllowedInitials), score: fc.integer({ min: 1, max: 2000 }).map(units => units * 50) });
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
  await fc.assert(fc.asyncProperty(signature, seed, claimed, pastOneKB, cuts, async (signed, game, length, size, at) => {
    const store = freshStore();
    const json = JSON.stringify({ ...signed, session: sessionFor(game) });
    const bytes = new TextEncoder().encode(json + ' '.repeat(size - json.length));
    const headers = { ...JSON_TYPE, 'content-length': String(length) };
    const request = new Request(URL, { method: 'POST', headers, body: streamed(bytes, at), duplex: 'half' });
    const before = await snapshot(store);
    const response = await handleScores(request, createTablePort(store), { now: () => NOW, log: () => {}, where: LOCAL, sessions: SIGNING });
    expect(response.status).toBe(413);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'payload-too-large' });
    assertStateDelta(before, await snapshot(store), { universe: UNIVERSE });
  }), { numRuns: 15, examples: [[{ initials: 'FAB', score: 1000 }, '0123456789abcdef0123456789abcdef', 20, KB + 1, []]] });
});

// A refusal is a bug, never a failed tidy-up (DDD-1, DDD-4): when the handler's port hands the real port's remove a key
// it refuses while tidying up, the signing answers 500 unexpected and is logged as unexpected, never prune-failed.
// The real port refuses every one of those keys, so the new row stays and no old score is removed.
// Held: 20 to 30 rows, so the listing after the write is over 20 keys and the signing always tidies up.
const enoughToTidy = fc.uniqueArray(row, { minLength: 20, maxLength: 30, selector: r => `${r.score}-${r.at}` });
const REFUSED = [key => `${key}\n`, key => `${key} `, key => `archive/${key}`, key => key.toLowerCase(), key => key.replace(/^s\/\d/, 's/')];
const signing = signed => new Request(URL, { method: 'POST', headers: JSON_TYPE, body: JSON.stringify(signed) });

test('a key refused while tidying up answers 500 unexpected, logged as unexpected and never prune-failed', async () => {
  await fc.assert(fc.asyncProperty(enoughToTidy, signature, seed, fc.constantFrom(...REFUSED), async (rows, signed, game, refused) => {
    const store = freshStore();
    for (const r of rows) await store.set(encodeKey(r), '');
    const real = createTablePort(store);
    const port = Object.freeze({ list: real.list, putIfNew: real.putIfNew, remove: key => real.remove(refused(key)) });
    const logs = [];
    const before = await snapshot(store);
    const response = await handleScores(signing({ ...signed, session: sessionFor(game) }), port, { now: () => NOW + 1, log: entry => logs.push(entry), where: LOCAL, sessions: SIGNING });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'unexpected' });
    expect(logs.map(({ event, reason }) => ({ event, reason }))).toEqual([{ event: 'scores.error', reason: 'unexpected' }]);
    assertStateDelta(before, await snapshot(store), {
      universe: UNIVERSE,
      expected: { 'table.keys': satisfying('the new row added, no old score removed', (was, now) => now.length === was.length + 1 && was.every(key => now.includes(key))) },
    });
  }), { numRuns: 10 });
});

// One of the store's lies (DDD-18), forced from the composition root's side: the clock is what the handler is handed,
// and a row's id is its game's. A write to a key that already exists: the store reports it as not modified, with no
// error. A clock that never moves and the same game signed again, with the session it signed with or another for the
// same seed, give the second signing the first one's key, so the store sees exactly that.
test('with a stopped clock, the same game signed again with the same initials and deposit is refused by the store: 503 not-saved, never kept, one row', async () => {
  await fc.assert(fc.asyncProperty(signature, seed, fc.boolean(), async (signed, game, anotherSession) => {
    const store = freshStore();
    const logs = [];
    const options = { now: () => NOW, log: entry => logs.push(entry), where: LOCAL, sessions: SIGNING };
    const first = sessionFor(game);
    expect((await handleScores(signing({ ...signed, session: first }), createTablePort(store), options)).status, 'arranging: the first signing').toBe(200);
    const before = await snapshot(store);
    expect(before['table.keys'], 'arranging: the first signing\'s row').toEqual([encodeKey({ ...signed, at: NOW, id: gameIdOf(game) })]);
    const again = anotherSession ? sessionFor(game, NOW - 1000) : first;
    const response = await handleScores(signing({ ...signed, session: again }), createTablePort(store), options);
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'not-saved' });
    expect(logs.slice(1).map(({ event, reason }) => ({ event, reason }))).toEqual([{ event: 'scores.not_saved', reason: 'key-exists' }]);
    assertStateDelta(before, await snapshot(store), { universe: UNIVERSE });
  }), { numRuns: 15 });
});

// One row per game (DDD-R4, the user's decision of 2026-10-27): a game signed again, with the session it signed with or
// another for the same seed, is 409 already-signed even when the store fails to remove its key. Its one log line is
// scores.rejected already-signed with removed: false, and nothing of the player. The key is left to pruning: it is the
// game's loser, so the table a reading shows is as it was.
const readingOf = async store => (await (await handleScores(new Request(URL), Object.freeze({ list: createTablePort(store).list }), ONLY_THE_CLOCK_LOG_AND_WHERE)).json()).scores;
const snapshotWithRows = async store => ({ ...(await snapshot(store)), 'table.rows': await readingOf(store) });

test('a game signed again whose own key the store fails to remove is still 409 already-signed, in one line with removed: false', async () => {
  await fc.assert(fc.asyncProperty(held, signature, signature, seed, fc.boolean(), async (rows, first, again, game, anotherSession) => {
    const store = freshStore();
    for (const r of rows) await store.set(encodeKey(r), '');
    const logs = [];
    const options = { now: movingClock(NOW).now, log: entry => logs.push(entry), where: LOCAL, sessions: SIGNING };
    const session = sessionFor(game);
    expect((await handleScores(signing({ ...first, session }), createTablePort(store), options)).status, 'arranging: the first signing').toBe(200);
    const before = await snapshotWithRows(store);
    const real = createTablePort(store);
    const port = Object.freeze({ ...real, remove: async () => { throw new Error('The store could not delete a key'); } });
    const response = await handleScores(signing({ ...again, session: anotherSession ? sessionFor(game, NOW - 1000) : session }), port, options);
    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'already-signed' });
    expect(logs.slice(1), 'one line, its reason and removed: false, nothing of the player').toEqual([{ event: 'scores.rejected', reason: 'already-signed', ms: expect.any(Number), removed: false, ...LOCAL }]);
    const leftBehind = (was, now) => {
      const added = now.filter(key => !was.includes(key)).map(decodeKey);
      return was.every(key => now.includes(key)) && added.length === 1 && added[0].id === gameIdOf(game) && added[0].initials === again.initials;
    };
    assertStateDelta(before, await snapshotWithRows(store), {
      universe: [...UNIVERSE, 'table.rows'],
      expected: { 'table.keys': satisfying('its key left to pruning, nothing else changed', leftBehind) },
    });
  }), { numRuns: 15 });
});

// Instances' clocks can differ, so two listings a few ms apart can be misordered by listedAt (DDD-12, accepted). What
// holds is that a listing's listedAt is read after that listing returns: the clock moves on at every reading, and the
// port notes the latest reading at the moment its listing returns.
function movingClock(start) {
  let reading = start;
  return { now: () => ++reading, latest: () => reading };
}

function notingWhenListed(port, clock) {
  const listedBy = [];
  const list = async () => {
    const keys = await port.list();
    listedBy.push(clock.latest());
    return keys;
  };
  return { port: Object.freeze({ ...port, list }), listedBy };
}

test('listedAt is read from the clock after the listing returns, on a read and after a signing', async () => {
  await fc.assert(fc.asyncProperty(held, fc.option(signature, { nil: null }), seed, async (rows, signed, game) => {
    const store = freshStore();
    for (const r of rows) await store.set(encodeKey(r), '');
    const clock = movingClock(NOW);
    const { port, listedBy } = notingWhenListed(createTablePort(store), clock);
    const before = await snapshot(store);
    const request = signed ? signing({ ...signed, session: sessionFor(game) }) : new Request(URL);
    const response = await handleScores(request, port, { now: clock.now, log: () => {}, where: LOCAL, sessions: SIGNING });
    expect(response.status).toBe(200);
    const { listedAt } = await response.json();
    expect(listedBy, 'one listing per request').toHaveLength(1);
    expect(listedAt, 'listedAt is a later reading than any taken before the listing returned').toBeGreaterThan(listedBy[0]);
    const signersRowAdded = (was, now) => {
      const added = now.filter(key => !was.includes(key)).map(decodeKey);
      return was.every(key => now.includes(key)) && added.length === 1 && added[0].id === gameIdOf(game) && added[0].initials === signed.initials;
    };
    assertStateDelta(before, await snapshot(store), {
      universe: UNIVERSE,
      expected: signed ? { 'table.keys': satisfying('the signer\'s row added, nothing removed', signersRowAdded) } : {},
    });
  }), { numRuns: 15 });
});

// The user's decisions of 2026-10-27 (DDD-R1, DDD-R4): a GET and the session request are handed the port's listing
// alone, frozen; the session request is handed the signer's sign alone, the signing its verify and gameId alone; and no
// handler is handed an id source, since a row's id is its game's. Each part is all its handler needs: a handler that
// reached for anything else would find nothing there, and answer 500.
const sessionRequest = game => new Request(SESSIONS_URL, { method: 'POST', headers: JSON_TYPE, body: JSON.stringify({ seed: game }) });
const ONLY_THE_CLOCK_LOG_AND_WHERE = Object.freeze({ now: () => NOW, log: () => {}, where: LOCAL });

test('each handler is handed only its part of the port and of the signer, and the signing path no newId', async () => {
  await fc.assert(fc.asyncProperty(held, seed, signature, async (rows, game, signed) => {
    const store = freshStore();
    for (const r of rows) await store.set(encodeKey(r), '');
    const port = createTablePort(store);
    const listing = Object.freeze({ list: port.list });

    const beforeSession = await snapshot(store);
    const issued = await handleSessions(sessionRequest(game), listing, { ...ONLY_THE_CLOCK_LOG_AND_WHERE, sessions: ISSUING });
    expect(issued.status, 'the session request').toBe(200);
    expect(issued.headers.get('cache-control')).toBe('no-store');
    const { session, scores, listedAt } = await issued.json();
    expect(session).toEqual({ seed: game, issuedAt: NOW, token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(signer.verify(session), 'the session is sealed with the root\'s secret').toBe(true);
    expect({ scores, listedAt }, 'the table, as its own listing found it').toEqual({ scores: bestTen(rows), listedAt: NOW });
    assertStateDelta(beforeSession, await snapshot(store), { universe: UNIVERSE });

    const read = await handleScores(new Request(URL), listing, { ...ONLY_THE_CLOCK_LOG_AND_WHERE, sessions: SIGNING });
    expect(read.status, 'the GET').toBe(200);
    assertStateDelta(beforeSession, await snapshot(store), { universe: UNIVERSE });

    const saved = await handleScores(signing({ ...signed, session }), port, { ...ONLY_THE_CLOCK_LOG_AND_WHERE, sessions: SIGNING });
    expect(saved.status, 'the signing').toBe(200);
    expect((await saved.json()).id, 'the new row\'s id is its game id').toBe(gameIdOf(game));
    const ownRow = encodeKey({ ...signed, at: NOW, id: gameIdOf(game) });
    assertStateDelta(beforeSession, await snapshot(store), {
      universe: UNIVERSE,
      expected: { 'table.keys': setTo([...beforeSession['table.keys'], ownRow].sort()) },
    });
  }), { numRuns: 15 });
});

// A session request is exactly { seed }, its seed 32 lowercase hex characters (DDD-R1, C4). Any other body sent as JSON
// within 1 KB is 400 invalid-seed: any JSON value but that one, the near misses of it (its seed in capitals, cut short
// or run long, not hex, not text, or with another field beside it), and a body that isn't JSON at all. The refusal
// issues no session, is never kept, is logged sessions.rejected invalid-seed and never with the seed, and the table is
// as it was.
const isExactlyASeedRequest = body => typeof body === 'object' && body !== null && !Array.isArray(body)
  && Object.keys(body).length === 1 && typeof body.seed === 'string' && /^[0-9a-f]{32}$/.test(body.seed);
const isJson = text => { try { JSON.parse(text); return true; } catch { return false; } };
const notASeed = fc.oneof(
  seed.filter(game => /[a-f]/.test(game)).map(game => game.toUpperCase()),
  fc.stringMatching(/^[0-9a-f]{0,31}$/),
  fc.stringMatching(/^[0-9a-f]{33,40}$/),
  fc.string({ minLength: 32, maxLength: 32 }).filter(text => !/^[0-9a-f]{32}$/.test(text)),
  fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), seed.map(game => [game]), seed.map(game => ({ seed: game }))),
);
const anotherField = fc.dictionary(fc.string({ maxLength: 8 }).filter(field => field !== 'seed'), fc.jsonValue({ maxDepth: 1 }), { minKeys: 1, maxKeys: 3 });
const notASeedRequest = fc.oneof(
  notASeed.map(wrong => JSON.stringify({ seed: wrong })),
  fc.tuple(seed, anotherField).map(([game, extra]) => JSON.stringify({ seed: game, ...extra })),
  fc.jsonValue({ maxDepth: 2 }).filter(body => !isExactlyASeedRequest(body)).map(body => JSON.stringify(body)),
  fc.string().filter(text => !isJson(text)),
).filter(body => new TextEncoder().encode(body).length <= KB);

test('any session request whose body isn\'t exactly { seed } with 32 lowercase hex characters is invalid-seed, and the table is unchanged', async () => {
  await fc.assert(fc.asyncProperty(held, notASeedRequest, async (rows, body) => {
    const store = freshStore();
    for (const r of rows) await store.set(encodeKey(r), '');
    const logs = [];
    const before = await snapshot(store);
    const request = new Request(SESSIONS_URL, { method: 'POST', headers: JSON_TYPE, body });
    const response = await handleSessions(request, Object.freeze({ list: createTablePort(store).list }), { now: () => NOW, log: entry => logs.push(entry), where: LOCAL, sessions: ISSUING });
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json(), 'no session is issued').toEqual({ error: 'invalid-seed' });
    expect(logs, 'one line, its reason, never the seed').toEqual([{ event: 'sessions.rejected', reason: 'invalid-seed', ms: expect.any(Number), ...LOCAL }]);
    assertStateDelta(before, await snapshot(store), { universe: UNIVERSE });
  }), { numRuns: 25, examples: [[[], JSON.stringify({ seed: 'ABCDEF0123456789ABCDEF0123456789' })], [[], '']] });
});

// Only a session the table sealed can sign (DDD-R2, Signing checks row 9). A session issued in the last two hours with
// any one of its fields changed (its seed another, its issue time another, its seal with one character changed, cut
// short, run long, made up or any other value), a field dropped or one added, or any value that isn't a session at
// all, sent in an otherwise good signing within 1 KB, is 400 invalid-session, never kept. It is logged scores.rejected
// invalid-session and nothing else: never the session, its seal, its seed, its game id, the initials or the client's
// IP. Nothing is saved.
const HOUR = 3_600_000;
const SEAL_CHARACTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'];
const SESSION_FIELDS = ['seed', 'issuedAt', 'token'];
const CLIENT_IP_HEADER = 'x-nf-client-connection-ip';
const sealed = fc.tuple(seed, fc.integer({ min: NOW - 2 * HOUR, max: NOW })).map(([game, issuedAt]) => sessionFor(game, issuedAt));
const unlike = (value, arbitrary) => arbitrary.filter(other => !isDeepStrictEqual(other, value));
const withField = (session, field, value) => ({ ...session, [field]: value });
const withoutField = (session, field) => Object.fromEntries(Object.entries(session).filter(([name]) => name !== field));
const oneCharacterChanged = token => fc.tuple(fc.nat({ max: token.length - 1 }), fc.constantFrom(...SEAL_CHARACTERS))
  .filter(([at, character]) => token[at] !== character)
  .map(([at, character]) => `${token.slice(0, at)}${character}${token.slice(at + 1)}`);
const otherSeal = token => fc.oneof(
  oneCharacterChanged(token),
  fc.nat({ max: token.length - 1 }).map(length => token.slice(0, length)),
  fc.stringMatching(/^[A-Za-z0-9_-]{1,8}$/).map(more => token + more),
  unlike(token, fc.oneof(fc.stringMatching(/^[A-Za-z0-9_-]{43}$/), fc.jsonValue({ maxDepth: 1 }))),
);
const oneFieldChanged = session => fc.oneof(
  unlike(session.seed, fc.oneof(seed, fc.jsonValue({ maxDepth: 1 }))).map(other => withField(session, 'seed', other)),
  unlike(session.issuedAt, fc.oneof(fc.integer({ min: session.issuedAt - 2 * HOUR, max: session.issuedAt + 2 * HOUR }), fc.jsonValue({ maxDepth: 1 })))
    .map(other => withField(session, 'issuedAt', other)),
  otherSeal(session.token).map(other => withField(session, 'token', other)),
  fc.constantFrom(...SESSION_FIELDS).map(field => withoutField(session, field)),
  fc.tuple(fc.string({ maxLength: 8 }).filter(field => !SESSION_FIELDS.includes(field)), fc.jsonValue({ maxDepth: 1 }))
    .map(([field, value]) => withField(session, field, value)),
);
const notASession = fc.oneof(fc.constant('a session'), fc.jsonValue({ maxDepth: 2 }));
const unsealedSigning = fc.tuple(signature, fc.oneof(sealed.chain(oneFieldChanged), notASession))
  .map(([signed, session]) => JSON.stringify({ ...signed, session }))
  .filter(body => new TextEncoder().encode(body).length <= KB);

test('a signing whose session the table didn\'t seal is invalid-session, logged without the player, and the table is unchanged', async () => {
  await fc.assert(fc.asyncProperty(held, unsealedSigning, fc.ipV4(), async (rows, body, ip) => {
    const store = freshStore();
    for (const r of rows) await store.set(encodeKey(r), '');
    const logs = [];
    const before = await snapshot(store);
    const request = new Request(URL, { method: 'POST', headers: { ...JSON_TYPE, [CLIENT_IP_HEADER]: ip }, body });
    const response = await handleScores(request, createTablePort(store), { now: () => NOW, log: entry => logs.push(entry), where: LOCAL, sessions: SIGNING });
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'invalid-session' });
    expect(logs, 'one line, its reason, nothing of the player').toEqual([{ event: 'scores.rejected', reason: 'invalid-session', ms: expect.any(Number), ...LOCAL }]);
    assertStateDelta(before, await snapshot(store), { universe: UNIVERSE });
  }), { numRuns: 25 });
});

// A session lasts 2 hours, on the handler's own clock (D18; DDD-R2's lifetime; Signing checks rows 9b and 10, C8): verify
// takes no clock, so the handler judges a sealed session's issue time with its now and the roots' clockAllowanceMs
// (10 s). For any issue time, an otherwise good signing is 400 session-expired exactly when its session is more than 2
// hours old (now - issuedAt > 7,200,000), and 400 invalid-session exactly when it was issued more than 10 s after now.
// Either is never kept, is logged scores.rejected with its reason and nothing of the player, and saves nothing; any
// other issue time signs. The issue times crowd both edges, so a check one millisecond off is caught.
const CLOCK_ALLOWANCE_MS = 10_000;
const LIFETIME_MS = 2 * HOUR;
const issuedFromNow = fc.oneof(
  fc.integer({ min: -3 * HOUR, max: 60_000 }),
  fc.integer({ min: -LIFETIME_MS - 2, max: -LIFETIME_MS + 2 }),
  fc.integer({ min: CLOCK_ALLOWANCE_MS - 2, max: CLOCK_ALLOWANCE_MS + 2 }),
);
const lifetimeRefusal = fromNow => {
  if (fromNow > CLOCK_ALLOWANCE_MS) return 'invalid-session';
  return -fromNow > LIFETIME_MS ? 'session-expired' : null;
};

test('a signing is session-expired exactly past 2 hours, and invalid-session exactly when issued more than 10 s ahead, and the table is unchanged', async () => {
  await fc.assert(fc.asyncProperty(held, signature, seed, issuedFromNow, async (rows, signed, game, fromNow) => {
    const store = freshStore();
    for (const r of rows) await store.set(encodeKey(r), '');
    const logs = [];
    const before = await snapshot(store);
    const options = { now: () => NOW, log: entry => logs.push(entry), where: LOCAL, sessions: SIGNING, clockAllowanceMs: CLOCK_ALLOWANCE_MS };
    const response = await handleScores(signing({ ...signed, session: sessionFor(game, NOW + fromNow) }), createTablePort(store), options);
    const refused = lifetimeRefusal(fromNow);
    const ownRow = encodeKey({ ...signed, at: NOW, id: gameIdOf(game) });
    expect(response.status, `issued ${fromNow} ms from now`).toBe(refused ? 400 : 200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject(refused ? { error: refused } : { id: gameIdOf(game) });
    expect(logs.map(({ event, reason }) => ({ event, reason })), 'one line, its reason').toEqual([refused ? { event: 'scores.rejected', reason: refused } : { event: 'scores.signed', reason: 'ok' }]);
    if (refused) expect(logs[0], 'nothing of the player').toEqual({ event: 'scores.rejected', reason: refused, ms: expect.any(Number), ...LOCAL });
    assertStateDelta(before, await snapshot(store), {
      universe: UNIVERSE,
      expected: refused ? {} : { 'table.keys': setTo([...before['table.keys'], ownRow].sort()) },
    });
  }), { numRuns: 40, examples: [[[], { initials: 'FAB', score: 1000 }, '0123456789abcdef0123456789abcdef', -LIFETIME_MS - 1], [[], { initials: 'FAB', score: 1000 }, '0123456789abcdef0123456789abcdef', CLOCK_ALLOWANCE_MS + 1]] });
});
