import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { loadFreshGame } from './support/fresh-game.js';
import { assertStateDelta, appendedWith, setTo, unchanged } from '../common/state-delta.js';
import { createLeaderboard } from '../../src/platform/leaderboard.js';
import { SCORE_STEP, TABLE_SIZE, isAllowedInitials } from '../../src/game/high-scores.js';
import { GameEvent } from '../../src/game/events.js';

// Every game asks the table for its session as it starts (DDD-R10): startSession(seed) POSTs { seed } to /api/sessions,
// once, and only an answer with rows, a listedAt and a session for that seed resolves, to its body as it came. Anything
// else rejects, so main.js hands the failure to the rules' tableFailed and the promise it keeps for that game, the game's
// pending session, is that rejection. A well-formed answer's rows go to tableAnswered, under the listing-time rule
// (DDD-12): they replace the table shown unless they were listed before it.
// The client's ports are doubles: a network that answers 200 with the text given and notes each request, and timers
// the test holds. Universe: the rules' snapshot(), the requests the network saw, and the timers the client still has set.

const UNIVERSE = ['screen', 'table', 'entry', 'skipped', 'signing', 'settled', 'lastListedAt', 'requests', 'timers.set'];

const seed = fc.stringMatching(/^[0-9a-f]{32}$/);
const threeLetters = fc.stringMatching(/^[A-Z]{3}$/).filter(isAllowedInitials);
const deposit = fc.integer({ min: 1, max: 400 }).map(units => units * SCORE_STEP);
const row = fc.record({ initials: threeLetters, score: deposit, id: fc.uuid() }, { noNullPrototype: true });
const rows = fc.array(row, { maxLength: TABLE_SIZE }).map(list => list.sort((a, b) => b.score - a.score));
const table = fc.record({ scores: rows, listedAt: fc.nat() }, { noNullPrototype: true });
const token = fc.stringMatching(/^[A-Za-z0-9_-]{43}$/);
// What the table shows as the game starts: nothing yet, nothing since the page load failed, or a table.
const shownBefore = fc.oneof(fc.constantFrom('nothing yet', 'failed'), table);

// A seed and the table's answer to it: its session, with the table as the server listed it.
const answered = seed.chain(sent => fc.record({
  seed: fc.constant(sent),
  answer: fc.tuple(fc.record({ seed: fc.constant(sent), issuedAt: fc.nat(), token }, { noNullPrototype: true }), table)
    .map(([session, { scores, listedAt }]) => ({ session, scores, listedAt })),
}));

// JSON values of every type but one, and every JSON value that isn't a plain object.
const notA = type => fc.jsonValue().filter(value => typeof value !== type);
const notAnObject = fc.jsonValue().filter(value => value === null || typeof value !== 'object' || Array.isArray(value));
const without = (object, field) => Object.fromEntries(Object.entries(object).filter(([key]) => key !== field));
const notARow = fc.oneof(notAnObject, row.map(good => without(good, 'id')), fc.tuple(row, notA('number')).map(([good, score]) => ({ ...good, score })));
const NOT_JSON = ['', 'Not found', '<!doctype html><title>Moved</title>'];

// Every way an answer to `sent` falls short: no object at all; no rows, or rows that aren't a list of rows; no listedAt
// or one that isn't a number; no session, or one for another seed, or one missing its seed, issue time or seal, or
// holding one of another kind.
const shortOf = ({ seed: sent, answer }) => fc.oneof(
  notAnObject,
  fc.constantFrom('scores', 'listedAt', 'session').map(field => without(answer, field)),
  fc.jsonValue().filter(scores => !Array.isArray(scores)).map(scores => ({ ...answer, scores })),
  fc.tuple(notARow, fc.nat()).map(([broken, at]) => ({ ...answer, scores: answer.scores.toSpliced(at % (answer.scores.length + 1), 0, broken) })),
  notA('number').map(listedAt => ({ ...answer, listedAt })),
  notAnObject.map(session => ({ ...answer, session })),
  seed.filter(other => other !== sent).map(other => ({ ...answer, session: { ...answer.session, seed: other } })),
  fc.constantFrom('seed', 'issuedAt', 'token').map(field => ({ ...answer, session: without(answer.session, field) })),
  notA('string').map(other => ({ ...answer, session: { ...answer.session, seed: other } })),
  fc.oneof(notA('number'), fc.double().filter(value => !Number.isSafeInteger(value))).map(issuedAt => ({ ...answer, session: { ...answer.session, issuedAt } })),
  notA('string').map(other => ({ ...answer, session: { ...answer.session, token: other } })),
);
const fallenShort = answered.chain(given => fc.record({
  seed: fc.constant(given.seed),
  text: fc.oneof(shortOf(given).map(body => JSON.stringify(body)), fc.constantFrom(...NOT_JSON)),
}));

// The client's ports: a network that answers each request 200 with `text`, and timers the test holds.
function answering(text) {
  const requests = [], timers = new Map();
  let next = 1;
  const leaderboard = createLeaderboard({
    fetch: async (url, { method = 'GET', headers, body, signal } = {}) => {
      requests.push({ url, method, headers: { ...headers }, body: body && JSON.parse(body), aborts: signal instanceof AbortSignal });
      return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
    },
    setTimeout: (callback, ms) => { timers.set(next, { callback, ms }); return next++; },
    clearTimeout: id => { timers.delete(id); },
  });
  return { leaderboard, requests: () => requests.map(request => ({ ...request })), timersSet: () => timers.size };
}
const sessionRequest = sent => ({ url: '/api/sessions', method: 'POST', headers: { 'content-type': 'application/json' }, body: { seed: sent }, aborts: true });

// A game just started with `shown` on the table: -> the rules.
async function gameStartedWith(shown) {
  const rules = await loadFreshGame();
  if (shown === 'failed') rules.tableFailed();
  if (typeof shown === 'object') rules.tableAnswered(shown);
  rules.handlePresses(new Set(['Enter']));
  expect(rules.takeEvents().map(event => event.type), 'arranging: Enter did not start a game').toContain(GameEvent.GAME_STARTED);
  return rules;
}

// main.js's hand-over on gameStarted (DDD-R10): the session's rows to tableAnswered, a failure to tableFailed. It keeps
// the promise startSession returned for that game, as the game's pending session.
function startSessionThrough(leaderboard, rules, sent) {
  const pendingSession = leaderboard.startSession(sent);
  const handedOver = pendingSession.then(({ scores, listedAt }) => rules.tableAnswered({ scores, listedAt }), () => rules.tableFailed());
  return { pendingSession, handedOver };
}

test('startSession rejects an answer without rows, a listedAt or a session for the seed it sent, and the game treats the table as failed', async () => {
  await fc.assert(fc.asyncProperty(shownBefore, fallenShort, async (shown, { seed: sent, text }) => {
    const rules = await gameStartedWith(shown);
    const network = answering(text);
    const observe = () => ({ ...rules.snapshot(), requests: network.requests(), 'timers.set': network.timersSet() });
    const before = observe();
    const { pendingSession, handedOver } = startSessionThrough(network.leaderboard, rules, sent);
    await handedOver;
    await expect(pendingSession, text).rejects.toThrow();
    assertStateDelta(before, observe(), {
      universe: UNIVERSE,
      expected: {
        // Unavailable only while no table has ever loaded: a failure keeps the last good table (DDD-9).
        table: before.table.status === 'unknown' ? setTo({ status: 'unavailable', rows: [] }) : unchanged(),
        requests: appendedWith(sessionRequest(sent)),
      },
    });
  }));
});

test('a well-formed answer resolves to its body as it came, and its rows replace the table shown unless listed before it', async () => {
  await fc.assert(fc.asyncProperty(shownBefore, answered, async (shown, { seed: sent, answer }) => {
    const rules = await gameStartedWith(shown);
    const network = answering(JSON.stringify(answer));
    const observe = () => ({ ...rules.snapshot(), requests: network.requests(), 'timers.set': network.timersSet() });
    const before = observe();
    const { pendingSession, handedOver } = startSessionThrough(network.leaderboard, rules, sent);
    await handedOver;
    await expect(pendingSession).resolves.toEqual(answer);
    const listedBefore = before.lastListedAt !== null && answer.listedAt < before.lastListedAt;
    assertStateDelta(before, observe(), {
      universe: UNIVERSE,
      expected: {
        ...(!listedBefore && { table: setTo({ status: 'available', rows: answer.scores }), lastListedAt: setTo(answer.listedAt) }),
        requests: appendedWith(sessionRequest(sent)),
      },
    });
  }));
});
