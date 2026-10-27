import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { loadFreshGame } from './support/fresh-game.js';
import { assertStateDelta, appendedWith, setTo, unchanged } from '../common/state-delta.js';
import { createLeaderboard } from '../../src/platform/leaderboard.js';
import { SCORE_STEP, TABLE_SIZE, isAllowedInitials } from '../../src/game/high-scores.js';
import { GameEvent } from '../../src/game/events.js';
import { RULES_VERSION } from '../../src/game/record.js';

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

// A signing waits for its game's session (DDD-R10, as clarified in DISTILL, 2026-10-27): sign({ initials, score,
// session: pendingSession, record }) sends nothing until the pending session resolves, then POSTs { initials, score,
// session, record }, the game's record as it was handed over, its own 5000 ms starting as it is sent. If the session
// fails (it can't be reached, answers an error or something other than a session, or never answers), sign rejects at
// once and sends nothing. No game ends within the session's 5 s, so no browser scenario can press a signing while its
// session is on its way: this is the wait's test.
// The client's ports are doubles the test holds: a network that answers each request when the test says, and timers on
// a clock the test moves. Universe: the requests the network saw and when each was sent, the timers still set and when
// each is due, and how the call to sign stands.

const WAIT_UNIVERSE = ['requests', 'timers', 'sign'];
const TIMEOUT_MS = 5000;

const withinTimeout = fc.integer({ min: 0, max: TIMEOUT_MS - 1 });
const signedTable = fc.tuple(table, fc.uuid()).map(([listing, id]) => ({ ...listing, id }));
// A game's record, as initialsEntered carries it (DDD-R5): the client sends it as it is, and only the table reads it.
const record = fc.record({ rules: fc.constant(RULES_VERSION), steps: fc.integer({ min: 1, max: 432_000 }), keys: fc.stringMatching(/^0[A-H](?:[1-9a-z][A-H]){0,6}$/) }, { noNullPrototype: true });
// When the session arrives, within its 5 s, and when the signing was pressed while it was on its way.
const pressedWhileOnItsWay = withinTimeout.chain(sessionAt => fc.record({ sessionAt: fc.constant(sessionAt), pressAt: fc.integer({ min: 0, max: sessionAt }) }));
// A seed, and every way its session fails, and when: it can't be reached, or answers an error or something other than
// its session, at any time within its 5 s; or it never answers, and fails as its 5 s run out.
const failedSession = fallenShort.chain(({ seed: sent, text }) => fc.record({
  seed: fc.constant(sent),
  failure: fc.oneof(
    fc.record({ trouble: fc.constant("can't be reached"), at: withinTimeout }),
    fc.record({ trouble: fc.constant('answers'), at: withinTimeout, status: fc.integer({ min: 400, max: 599 }), text: fc.constantFrom(...NOT_JSON) }),
    fc.record({ trouble: fc.constant('answers'), at: withinTimeout, status: fc.constant(200), text: fc.constant(text) }),
    fc.constant({ trouble: 'never answers', at: TIMEOUT_MS }),
  ),
}));

// The client on ports the test holds: a network that answers the nth request only when told to, and timers on a clock
// the test moves. An aborted request fails, as fetch's does. observe() is the universe.
function heldClient() {
  const requests = [], answers = [], timers = new Map();
  let now = 0, next = 1, signing = 'not asked';
  const leaderboard = createLeaderboard({
    fetch: (url, { method = 'GET', headers, body, signal } = {}) => new Promise((resolve, reject) => {
      requests.push({ url, method, headers: { ...headers }, body: body && JSON.parse(body), aborts: signal instanceof AbortSignal, sentAt: now });
      answers.push({ resolve, reject });
      signal.addEventListener('abort', () => reject(signal.reason));
    }),
    setTimeout: (callback, ms) => { timers.set(next, { callback, due: now + ms }); return next++; },
    clearTimeout: id => { timers.delete(id); },
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));   // lets every promise the last move freed run
  const dueFirst = () => [...timers].sort(([, a], [, b]) => a.due - b.due)[0];
  return {
    startSession: seed => leaderboard.startSession(seed),
    // Calls sign and watches its promise: pending, then answered or failed, at the time it settled.
    sign(fields) {
      signing = 'pending';
      leaderboard.sign(fields).then(answer => { signing = { outcome: 'answered', answer, at: now }; }, () => { signing = { outcome: 'failed', at: now }; });
    },
    observe: () => ({ requests: requests.map(request => ({ ...request })), timers: [...timers.values()].map(({ due }) => ({ due })), sign: signing }),
    async answer(n, { status, text }) {
      answers[n].resolve(new Response(text, { status, headers: { 'content-type': 'application/json' } }));
      await settle();
    },
    async unreachable(n) {
      answers[n].reject(new TypeError('Failed to fetch'));
      await settle();
    },
    // Moves the clock on to `time`, once what the last move freed has run, running each timer as it falls due.
    async advanceTo(time) {
      await settle();
      for (let first = dueFirst(); first && first[1].due <= time; first = dueFirst()) {
        const [id, { due, callback }] = first;
        timers.delete(id);
        now = due;
        callback();
        await settle();
      }
      now = time;
      await settle();
    },
  };
}

// How each trouble meets the session request, the client's first: a network error, an answer, or nothing at all.
const TROUBLE = {
  "can't be reached": held => held.unreachable(0),
  answers: (held, { status, text }) => held.answer(0, { status, text }),
  'never answers': () => {},
};
const signingRequest = (body, sentAt) => ({ url: '/api/scores', method: 'POST', headers: { 'content-type': 'application/json' }, body, aborts: true, sentAt });

test('a signing pressed while its session is on its way is sent as the session arrives, and its 5000 ms start then', async () => {
  const run = fc.record({ given: answered, times: pressedWhileOnItsWay, answerAfter: fc.nat({ max: 2 * TIMEOUT_MS }), initials: threeLetters, score: deposit, played: record, signed: signedTable });
  await fc.assert(fc.asyncProperty(run, async ({ given: { seed: sent, answer }, times: { sessionAt, pressAt }, answerAfter, initials, score, played, signed }) => {
    const held = heldClient();
    const pendingSession = held.startSession(sent);
    await held.advanceTo(pressAt);
    const before = held.observe();
    held.sign({ initials, score, session: pendingSession, record: played });
    await held.advanceTo(sessionAt);
    await held.answer(0, { status: 200, text: JSON.stringify(answer) });
    const whenSent = held.observe();
    assertStateDelta(before, whenSent, {
      universe: WAIT_UNIVERSE,
      expected: {
        requests: appendedWith(signingRequest({ initials, score, session: answer.session, record: played }, sessionAt)),
        timers: setTo([{ due: sessionAt + TIMEOUT_MS }]),
        sign: setTo('pending'),
      },
    });
    await held.advanceTo(sessionAt + answerAfter);
    await held.answer(1, { status: 200, text: JSON.stringify(signed) });   // too late if its 5000 ms ran out first
    assertStateDelta(whenSent, held.observe(), {
      universe: WAIT_UNIVERSE,
      expected: {
        timers: setTo([]),
        sign: setTo(answerAfter < TIMEOUT_MS
          ? { outcome: 'answered', answer: signed, at: sessionAt + answerAfter }
          : { outcome: 'failed', at: sessionAt + TIMEOUT_MS }),
      },
    });
  }));
});

test('a signing whose session fails fails at once, and is never sent', async () => {
  const run = fc.record({ given: failedSession, pressAt: fc.nat({ max: 2 * TIMEOUT_MS }), initials: threeLetters, score: deposit, played: record });
  await fc.assert(fc.asyncProperty(run, async ({ given: { seed: sent, failure }, pressAt, initials, score, played }) => {
    const held = heldClient();
    const pendingSession = held.startSession(sent);
    pendingSession.catch(() => {});   // main.js hands every session's failure to tableFailed
    await held.advanceTo(0);
    const before = held.observe();
    const moments = [
      { at: pressAt, act: () => held.sign({ initials, score, session: pendingSession, record: played }) },
      { at: failure.at, act: () => TROUBLE[failure.trouble](held, failure) },   // never answering, it times out on the way
    ];
    for (const { at, act } of moments.toSorted((a, b) => a.at - b.at)) {
      await held.advanceTo(at);
      await act();
    }
    await held.advanceTo(Math.max(pressAt, failure.at) + 2 * TIMEOUT_MS);
    assertStateDelta(before, held.observe(), {
      universe: WAIT_UNIVERSE,
      expected: {
        timers: setTo([]),
        sign: setTo({ outcome: 'failed', at: Math.max(pressAt, failure.at) }),
      },
    });
  }));
});
