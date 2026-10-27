import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { MAX_SCORE, TABLE_SIZE, isAllowedInitials } from '../../src/game/high-scores.js';
import { createTablePort, decodeKey, encodeKey, handleScores, planPrune, rankKeys } from '../../netlify/functions/scores.mjs';
import { createSessionSigner, readSessionSecret } from '../../netlify/scores/sessions.mjs';
import { TEST_SECRET } from '../common/session-secret.js';
import { assertStateDelta, satisfying } from '../common/state-delta.js';
import { scriptedGames } from '../common/played-games.js';

// A row's key is the persisted schema (ADR-004): s/{MAX_SCORE - score, 7 digits}-{epoch ms, 15 digits}-{initials}-{id},
// so that the keys sort as strings into arcade order. Only keys of exactly this shape are rows: a store also lists
// other things (the emulator's temporary files s/.xxxx, a malformed row, another prefix), and none of them is a row.

const row = fc.record({
  initials: fc.stringMatching(/^[A-Z]{3}$/),
  score: fc.integer({ min: 0, max: MAX_SCORE }),
  at: fc.integer({ min: 0, max: 999_999_999_999_999 }),
  id: fc.stringMatching(/^[a-z0-9]{1,32}$/),
});

// A score key broken in one place, the way a stray entry or a bug would break it.
const BREAKS = [
  key => key.slice('s/'.length),                                         // no prefix
  key => `archive/${key}`,                                               // another prefix
  key => `${key}\n`,                                                     // a trailing line break
  key => `${key} `,
  key => key.replace(/^s\/\d/, 's/'),                                    // a 6-digit score
  key => key.replace(/^s\//, 's/0'),                                     // an 8-digit score
  key => key.replace(/^(s\/\d{7}-)/, '$10'),                             // a 16-digit time
  key => key.replace(/-([A-Z]{3})-/, (_, initials) => `-${initials.toLowerCase()}-`),
  key => key.replace(/-([A-Z]{3})-/, '-$1X-'),                           // four letters
  key => key.replace(/-([A-Z]{3})-/, (_, initials) => `-${initials.slice(1)}-`),
  key => key.replace(/-[a-z0-9]+$/, '-'),                                // no id
  key => key.replace(/-([a-z0-9]+)$/, '-$1Z'),                           // a capital in the id
  key => key.replace(/-([a-z0-9]+)$/, '-$1-x'),                          // a dash in the id
];
const temporaryFile = fc.string().map(name => `s/.${name}`);
const brokenKey = fc.tuple(row, fc.constantFrom(...BREAKS)).map(([r, breakIt]) => breakIt(encodeKey(r)));
const SCORE_KEY = /^s\/\d{7}-\d{15}-[A-Z]{3}-[a-z0-9]+$/;
const notAKey = fc.oneof(temporaryFile, brokenKey, fc.string(), fc.constantFrom('', 's/', 's/.k3j2tmp', 's/FAB-1000', 'archive/s-0001-FAB'))
  .filter(key => !SCORE_KEY.test(key));

test('a row read back from its key is the same row, and the key has the persisted shape', () => {
  fc.assert(fc.property(row, r => {
    const key = encodeKey(r);
    const [prefix, rest] = [key.slice(0, 2), key.slice(2)];
    const [inverted, at, initials, id, ...more] = rest.split('-');
    expect({ prefix, inverted: inverted.length, at: at.length, more }).toEqual({ prefix: 's/', inverted: 7, at: 15, more: [] });
    expect({ score: MAX_SCORE - Number(inverted), at: Number(at), initials, id }).toEqual({ score: r.score, at: r.at, initials: r.initials, id: r.id });
    expect(decodeKey(key)).toEqual(r);
  }));
});

test('anything that is not a score key reads as no row, the emulator\'s temporary files included', () => {
  fc.assert(fc.property(notAKey, key => {
    expect(decodeKey(key)).toBeNull();
  }));
});

// A store's listing: rows and stray entries, in any order, the same row possibly listed twice.
const listing = fc.array(fc.oneof(row.map(r => ({ key: encodeKey(r), row: r })), notAKey.map(key => ({ key, row: null }))), { maxLength: 40 });
const outranksOrTies = (a, b) => a.score > b.score || (a.score === b.score && a.at <= b.at);

test('ranking keeps exactly the score keys: higher score first, then the earlier of two equal scores', () => {
  fc.assert(fc.property(listing, items => {
    const ranked = rankKeys(items.map(({ key }) => key));
    const rows = new Map(items.filter(item => item.row).map(item => [item.key, item.row]));
    expect([...ranked].sort()).toEqual(items.filter(item => item.row).map(item => item.key).sort());
    const order = ranked.map(key => rows.get(key));
    expect(order.slice(1).filter((next, i) => !outranksOrTies(order[i], next))).toEqual([]);
  }));
});

// One row per game (DDD-R4). A row's id is its game's, so a store can hold several keys of one game: per game id, the
// winner is the key signed first (the earliest at, then arcade order), and the others are its losers. The oracle below
// works that out on its own, from the keys alone.
const idOf = key => decodeKey(key).id;
const signedFirst = (a, b) => decodeKey(a).at - decodeKey(b).at || (a < b ? -1 : 1);
function byGame(keys) {
  const ranked = rankKeys(keys);
  const winnerOf = new Map();
  for (const key of ranked) if (!winnerOf.has(idOf(key)) || signedFirst(key, winnerOf.get(idOf(key))) < 0) winnerOf.set(idOf(key), key);
  const winners = ranked.filter(key => winnerOf.get(idOf(key)) === key);
  return { winners, losers: ranked.filter(key => !winners.includes(key)) };
}
const firstTenWinners = keys => byGame(keys).winners.slice(0, TABLE_SIZE).map(decodeKey).map(({ initials, score, id }) => ({ initials, score, id }));

// A store after any interleaving of signings: games with one to three keys each, signed at any moments, with any
// initials and deposits (a forger can sign one game with several). Every count of games from 0 to 30 is as likely as
// any other, so the runs cross the 20-winner edge, and the 5-loser one, many times.
const gameId = fc.stringMatching(/^[0-9a-f]{32}$/);
const keysOfAGame = id => fc.uniqueArray(row.map(r => encodeKey({ ...r, id })), { minLength: 1, maxLength: 3 });
const store = fc.integer({ min: 0, max: 30 })
  .chain(n => fc.uniqueArray(gameId, { minLength: n, maxLength: n }))
  .chain(ids => (ids.length ? fc.tuple(...ids.map(keysOfAGame)) : fc.constant([])))
  .map(games => rankKeys(games.flat()));
const KEPT_BEFORE_PRUNING = 20, PRUNED_AT_MOST = 5;

// The prune rule (DDD-R4): a game's other keys go first, whatever the count, then the lowest winners beyond 20; at
// most 5. So no row of the table is ever touched: a loser never shows, and a winner beyond 20 is ranked 21st or lower.
test('a tidy-up plans a game\'s other keys first, then the lowest winners beyond 20, at most 5, each once', () => {
  fc.assert(fc.property(store, keys => {
    const planned = planPrune(keys);
    const { winners, losers } = byGame(keys);
    const beyond = winners.slice(KEPT_BEFORE_PRUNING);
    const losersPlanned = Math.min(PRUNED_AT_MOST, losers.length);
    const winnersPlanned = Math.min(PRUNED_AT_MOST - losersPlanned, beyond.length);
    expect(planned).toHaveLength(losersPlanned + winnersPlanned);
    expect(planned.slice(0, losersPlanned).filter(key => !losers.includes(key)), 'planned first, but not a game\'s other key').toEqual([]);
    expect([...planned.slice(losersPlanned)].sort(), 'then the lowest winners beyond 20').toEqual(beyond.slice(beyond.length - winnersPlanned).sort());
    expect(new Set(planned).size, 'a key planned twice').toBe(planned.length);
  }));
});

// After any interleaving of signings (DDD-R4, DESIGN's reuse table): every signing, and every reading between them, is
// the production handler over the production port, and the store behind the port does each list, write and delete
// whole, in the order fast-check's scheduler picks. Each request's own listing, write and removals are noted at the
// port, so its answer can be checked against what it saw:
// - every answer with rows shows the first 10 winners of its own listing;
// - a signing keeps its key (200) only if its listing showed no other key of its game; otherwise it removes its own
//   key and nothing else (409 already-signed);
// - a 200 removes its listing's losers first, then its lowest winners beyond 20, and no signing removes more than 5.
// Each game is one really played in Node (tests/common/played-games.js): every signing of it carries its record and
// claims the deposit it played to, so the handler replays it and goes on to the store (DDD-R3, DDD-R9).
// The universe: the keys held, and the rows a reading shows. The keys change by exactly the writes and removals the
// requests made, and the rows are the first 10 winners of what is held, with every row shown before still held.
const NOW = 1_767_225_600_000;
const LOCAL = Object.freeze({ scope: 'local', context: 'missing', published: 'missing' });
const URL = 'http://localhost/api/scores';
const signer = createSessionSigner(readSessionSecret(TEST_SECRET));
const SIGNING = Object.freeze({ verify: signer.verify, gameId: signer.gameId });
const gameIdOf = seed => createHash('sha256').update(seed).digest('hex').slice(0, 32);

// The store's side of the port, in memory: each operation takes effect whole when the scheduler lets it.
function scheduledStore(s, keys) {
  const held = new Set(keys);
  const when = async (label, effect) => { await s.schedule(Promise.resolve(label), label); return effect(); };
  return Object.freeze({
    list: ({ prefix }) => when('list', () => ({ blobs: [...held].filter(key => key.startsWith(prefix)).map(key => ({ key })) })),
    set: (key, value, { onlyIfNew }) => when(`set ${key}`, () => {
      expect({ value, onlyIfNew }, 'the port writes empty bodies, only if new').toEqual({ value: '', onlyIfNew: true });
      const modified = !held.has(key);
      held.add(key);
      return { modified };
    }),
    delete: key => when(`delete ${key}`, () => { held.delete(key); }),
    keys: () => [...held].sort(),
  });
}

// One request's view of the port, noting what it saw and did.
function noting(port) {
  const seen = { listed: null, put: null, removed: [] };
  return {
    seen,
    port: Object.freeze({
      list: async () => (seen.listed = await port.list()),
      putIfNew: async key => { seen.put = key; return port.putIfNew(key); },
      remove: async key => { seen.removed.push(key); return port.remove(key); },
    }),
  };
}

const played = fc.shuffledSubarray(scriptedGames(6), { minLength: 1, maxLength: 3 });
const interleaving = played.chain(games => fc.record({
  games: fc.constant(games),
  // held: other games' keys, and sometimes a key of one of the games about to sign
  held: fc.array(fc.tuple(fc.oneof(gameId, fc.constantFrom(...games.map(game => gameIdOf(game.seed)))), row), { maxLength: 28 })
    .map(rows => rankKeys(rows.map(([id, r]) => encodeKey({ ...r, at: r.at % NOW, id })))),
  signings: fc.array(fc.record({
    game: fc.constantFrom(...games),
    initials: fc.stringMatching(/^[A-Z]{3}$/).filter(isAllowedInitials),
  }), { minLength: 1, maxLength: 6 }),
  readings: fc.integer({ min: 0, max: 2 }),
}));

// Each game's session issued as long before NOW as the game lasted, plus a second, as a real game's is (the acceptance
// harness's rule), so the clock check (row 14) lets it through.
const onTime = game => {
  const issuedAt = NOW - Math.ceil(game.steps * 1000 / 120) - 1000;
  return { seed: game.seed, issuedAt, token: signer.sign(game.seed, issuedAt) };
};

test('after any interleaving of signings, every answer shows the first 10 winners, losers are pruned first, and no signing removes more than 5 keys', async () => {
  await fc.assert(fc.asyncProperty(fc.scheduler(), interleaving, async (s, { held, signings, readings }) => {
    const store = scheduledStore(s, held);
    const port = createTablePort(store);
    let clock = NOW;
    const options = { now: () => ++clock, log: () => {}, where: LOCAL, sessions: SIGNING };
    const snapshot = keys => ({ 'table.keys': keys, 'table.rows': firstTenWinners(keys) });
    const before = snapshot(store.keys());

    const requests = [
      ...signings.map(({ game, initials }) => ({
        body: { initials, score: game.deposit, session: onTime(game), record: game.record },
      })),
      ...Array.from({ length: readings }, () => ({ body: null })),
    ].map(request => ({ ...request, ...noting(port) }));
    const answered = Promise.all(requests.map(async ({ body, port: own }) => {
      const request = body ? new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) : new Request(URL);
      const response = await handleScores(request, body ? own : Object.freeze({ list: own.list }), options);
      return { status: response.status, body: await response.json() };
    }));
    const answers = await s.waitFor(answered);

    const puts = [], removals = [];
    answers.forEach((answer, at) => {
      const { body, seen } = requests[at];
      const { winners, losers } = byGame(seen.listed ?? []);
      if (answer.status === 200) expect(answer.body.scores, 'the rows answered are the first 10 winners of its listing').toEqual(firstTenWinners(seen.listed));
      removals.push(...seen.removed);
      if (!body) return;
      puts.push(seen.put);
      const id = gameIdOf(body.session.seed);
      const others = seen.listed.filter(key => idOf(key) === id && key !== seen.put);
      expect(seen.removed.length, 'keys one signing removed').toBeLessThanOrEqual(PRUNED_AT_MOST);
      if (others.length) {
        expect(answer, 'a game whose listing showed another key of it').toEqual({ status: 409, body: { error: 'already-signed' } });
        expect(seen.removed, 'a refused signing removes its own key and nothing else').toEqual([seen.put]);
        return;
      }
      expect(answer.status, 'a game whose listing showed no other key of it keeps its key').toBe(200);
      expect(answer.body.id, 'the id answered is the game\'s').toBe(id);
      const beyond = winners.slice(KEPT_BEFORE_PRUNING);
      const losersRemoved = Math.min(PRUNED_AT_MOST, losers.length);
      expect(seen.removed.slice(0, losersRemoved).filter(key => !losers.includes(key)), 'losers first').toEqual([]);
      expect([...seen.removed.slice(losersRemoved)].sort(), 'then the lowest winners beyond 20')
        .toEqual(beyond.slice(beyond.length - Math.min(PRUNED_AT_MOST - losersRemoved, beyond.length)).sort());
    });

    const after = snapshot(store.keys());
    const written = new Set([...before['table.keys'], ...puts]);
    removals.forEach(key => written.delete(key));
    assertStateDelta(before, after, {
      universe: ['table.keys', 'table.rows'],
      expected: {
        'table.keys': satisfying('the signings\' writes added and their removals gone, nothing else', (_, now) => isDeepStrictEqual(now, [...written].sort())),
        'table.rows': satisfying('the first 10 winners held, every row shown before still held', (was, now) =>
          isDeepStrictEqual(now, firstTenWinners(after['table.keys'])) && was.every(shown => after['table.keys'].some(key => isDeepStrictEqual(decodeKey(key), { ...decodeKey(key), ...shown })))),
      },
    });
  }), { numRuns: 60 });
});
