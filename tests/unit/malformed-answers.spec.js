import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { loadFreshGame, arrange } from './support/fresh-game.js';
import { assertStateDelta, setTo } from '../common/state-delta.js';
import { createLeaderboard } from '../../src/platform/leaderboard.js';
import { SCORE_STEP, TABLE_SIZE, isAllowedInitials } from '../../src/game/high-scores.js';
import { GameEvent } from '../../src/game/events.js';

// A 200 from the table can carry anything: a proxy's page, an older or a newer function, a body cut short. The adapter
// (src/platform/leaderboard.js) is where such an answer stops: load() and sign() reject a body that isn't the shape the
// rules read, so it takes the failure path main.js already has (tableFailed, signingFailed) and the outcome is
// unconfirmed (ADR-008, DDD-9). It never reaches the rules, the status mirror or the canvas, where a throw in a promise
// callback would leave a signing pending for good, and a throw in a frame would stop the game.
// The adapter's two ports are doubles: a network that answers 200 with the bodies given, and timers the test holds.
// Universe: the rules' snapshot(), and the timers the adapter still has set.

const STEP = 1 / 120;
const SETTLE_S = 0.7;   // the entry takes typed presses only 0.6 s after game over
const keyboard = { isDown: () => false };
const UNIVERSE = ['screen', 'table', 'entry', 'signing', 'settled', 'lastListedAt', 'timers.set'];

const threeLetters = fc.stringMatching(/^[A-Z]{3}$/).filter(isAllowedInitials);
const deposit = fc.integer({ min: 1, max: 400 }).map(units => units * SCORE_STEP);
const row = fc.record({ initials: threeLetters, score: deposit, id: fc.uuid() }, { noNullPrototype: true });
// Fewer than ten rows, best first: any deposit makes the table, so every game over asks for initials.
const rows = fc.array(row, { maxLength: TABLE_SIZE - 1 }).map(list => list.sort((a, b) => b.score - a.score));
const table = fc.record({ scores: rows, listedAt: fc.nat() }, { noNullPrototype: true });
// The game's pending session, already answered: sign() sends only once it has (DDD-R10), so these signings are sent.
const session = fc.record({ seed: fc.stringMatching(/^[0-9a-f]{32}$/), issuedAt: fc.nat(), token: fc.stringMatching(/^[A-Za-z0-9_-]{43}$/) }, { noNullPrototype: true });
const answered = given => Promise.resolve({ session: given, scores: [], listedAt: 0 });

// JSON values of every type but one, and every JSON value that isn't a plain object.
const notA = type => fc.jsonValue().filter(value => typeof value !== type);
const notAnObject = fc.jsonValue().filter(value => value === null || typeof value !== 'object' || Array.isArray(value));
const without = (object, field) => Object.fromEntries(Object.entries(object).filter(([key]) => key !== field));
const ROW_FIELDS = Object.freeze({ initials: 'string', score: 'number', id: 'string' });

// A row the rules couldn't read: not an object, or one of its fields missing or of another type.
const brokenRow = fc.oneof(
  notAnObject,
  fc.tuple(row, fc.constantFrom(...Object.keys(ROW_FIELDS))).chain(([good, field]) => fc.oneof(
    fc.constant(without(good, field)),
    notA(ROW_FIELDS[field]).map(value => ({ ...good, [field]: value })),
  )),
);

// Every body but { scores: [rows], listedAt }: no object at all, no scores or scores that aren't a list, a row that
// isn't one, no listedAt or one that isn't a number.
const brokenTable = fc.oneof(
  notAnObject,
  fc.constant({}),
  fc.nat().map(listedAt => ({ listedAt })),
  fc.tuple(fc.jsonValue().filter(scores => !Array.isArray(scores)), fc.nat()).map(([scores, listedAt]) => ({ scores, listedAt })),
  fc.tuple(table, brokenRow, fc.nat()).map(([{ scores, listedAt }, broken, at]) =>
    ({ scores: scores.toSpliced(at % (scores.length + 1), 0, broken), listedAt })),
  rows.map(scores => ({ scores })),
  fc.tuple(rows, notA('number')).map(([scores, listedAt]) => ({ scores, listedAt })),
);

// Every body but { scores, id, listedAt }: a broken table, with an id or without, or a good one whose id is missing or
// isn't a string.
const brokenSigning = fc.oneof(
  brokenTable,
  fc.tuple(brokenTable, fc.uuid()).map(([body, id]) => ({ ...body, id })),
  table,
  fc.tuple(table, notA('string')).map(([body, id]) => ({ ...body, id })),
);

// Bodies past what a JSON value can say: numbers JSON.parse reads as Infinity, and bodies that aren't JSON at all.
const NOT_JSON = ['', 'Not found', '<!doctype html><title>Moved</title>'];
const OVERFLOWING_TABLES = ['{"scores":[],"listedAt":1e999}', '{"scores":[{"initials":"FAB","score":1e999,"id":"a1"}],"listedAt":1}'];
const OVERFLOWING_SIGNINGS = OVERFLOWING_TABLES.map(text => text.replace(/}$/, ',"id":"a1"}'));
const brokenTableText = fc.oneof(brokenTable.map(body => JSON.stringify(body)), fc.constantFrom(...NOT_JSON, ...OVERFLOWING_TABLES));
const brokenSigningText = fc.oneof(brokenSigning.map(body => JSON.stringify(body)), fc.constantFrom(...NOT_JSON, ...OVERFLOWING_SIGNINGS));

// The adapter's ports: a network that answers each request 200 with the next of `texts`, and timers the test holds.
function answering(...texts) {
  const requests = [], timers = new Map();
  let next = 1;
  const leaderboard = createLeaderboard({
    fetch: async (url, { method = 'GET', signal } = {}) => {
      requests.push({ url, method, aborts: signal instanceof AbortSignal });
      return new Response(texts.shift(), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    setTimeout: (callback, ms) => { timers.set(next, { callback, ms }); return next++; },
    clearTimeout: id => { timers.delete(id); },
  });
  return { leaderboard, requests: () => [...requests], timersSet: () => timers.size };
}

test('load() and sign() reject a 200 whose body isn\'t the table they promise, and leave no timer set', async () => {
  await fc.assert(fc.asyncProperty(brokenTableText, brokenSigningText, row, session, async (loaded, signed, { initials, score }, given) => {
    const network = answering(loaded, signed);
    await expect(network.leaderboard.load(), loaded).rejects.toThrow();
    await expect(network.leaderboard.sign({ initials, score, session: answered(given) }), signed).rejects.toThrow();
    expect(network.requests()).toEqual([{ url: '/api/scores', method: 'GET', aborts: true }, { url: '/api/scores', method: 'POST', aborts: true }]);
    expect(network.timersSet()).toBe(0);
  }));
});

// The other side of the check: what the function answers (netlify/functions/scores.mjs) still comes through, as it came.
test('a well-formed answer to load() or sign() resolves to its body as it came', async () => {
  await fc.assert(fc.asyncProperty(table, fc.uuid(), row, session, async (loaded, id, { initials, score }, given) => {
    const signed = { ...loaded, id };
    const network = answering(JSON.stringify(loaded), JSON.stringify(signed));
    await expect(network.leaderboard.load()).resolves.toEqual(loaded);
    await expect(network.leaderboard.sign({ initials, score, session: answered(given) })).resolves.toEqual(signed);
    expect(network.timersSet()).toBe(0);
  }));
});

// main.js's hand-overs (DDD-11): an answer to the rules' answered operation, a failure to their failed one.
const loadThrough = (leaderboard, rules) => leaderboard.load().then(answer => rules.tableAnswered(answer), () => rules.tableFailed());
const signThrough = (leaderboard, rules, { initials, score, signing, record }, pendingSession) =>
  leaderboard.sign({ initials, score, session: pendingSession, record }).then(answer => rules.signingAnswered(signing, answer), () => rules.signingFailed(signing));

// A game over whose deposit made the table, signed with `initials`: -> the rules, and the INITIALS_ENTERED event main.js
// takes to the table.
async function signedAtGameOver(shown, initials, score) {
  const rules = await loadFreshGame();
  rules.tableAnswered(shown);
  rules.handlePresses(new Set(['Enter']));
  arrange.deposit(rules, score);
  arrange.formationOnPin(rules);
  rules.update(STEP, keyboard);
  rules.update(SETTLE_S, keyboard);
  for (const letter of initials) rules.handlePresses(new Set([`Key${letter}`]), [{ key: letter.toLowerCase() }]);
  rules.handlePresses(new Set(['Enter']), [{ key: 'Enter' }]);
  const entered = rules.takeEvents().find(event => event.type === GameEvent.INITIALS_ENTERED);
  expect(entered, `arranging: ${initials} was not signed`).toMatchObject({ initials, score });
  return { rules, entered };
}

test('through the rules, a malformed answer settles the signing as unconfirmed, and neither it nor a malformed load changes the table', async () => {
  const run = fc.record({ shown: table, initials: threeLetters, score: deposit, signed: brokenSigningText, loaded: brokenTableText, given: session });
  await fc.assert(fc.asyncProperty(run, async ({ shown, initials, score, signed, loaded, given }) => {
    const { rules, entered } = await signedAtGameOver(shown, initials, score);
    const network = answering(signed, loaded);
    const observe = () => ({ ...rules.snapshot(), 'timers.set': network.timersSet() });
    const before = observe();
    await signThrough(network.leaderboard, rules, entered, answered(given));
    assertStateDelta(before, observe(), {
      universe: UNIVERSE,
      expected: {
        signing: setTo({ ...before.signing, status: 'unconfirmed' }),
        settled: setTo({ n: entered.signing, initials, outcome: 'unconfirmed', rank: null }),
      },
    });
    const settled = observe();
    await loadThrough(network.leaderboard, rules);
    assertStateDelta(settled, observe(), { universe: UNIVERSE });
  }));
});
