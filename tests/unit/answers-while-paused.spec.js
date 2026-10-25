import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { loadFreshGame, arrange } from './support/fresh-game.js';
import { assertStateDelta, setTo } from '../common/state-delta.js';
import { ALPHABET, TABLE_SIZE, SCORE_STEP, isAllowedInitials } from '../../src/game/high-scores.js';
import { GameEvent } from '../../src/game/events.js';

// The table answers in promise callbacks, and main.js hands each answer to the rules there, between frames (DDD-11). A
// paused game runs no steps, and a blurred window or a hidden tab pauses it (main.js calls pause()), so the rules must
// take an answer in without a frame: snapshot() shows it as soon as tableAnswered or signingAnswered returns, and no
// update() is ever called here. The game is paused with P, with Escape, or by pause(), while a signing made at the last
// game over is on its way; the table's answers then arrive in any order, with any listing time (DDD-12).
// Universe: the rules' read-only snapshot(), and whether the game is still paused (an answer doesn't resume it).

const STEP = 1 / 120;
const SETTLE_S = 0.7;   // Enter restarts only 0.6 s after game over
const keyboard = { isDown: () => false };
const UNIVERSE = ['screen', 'table', 'entry', 'signing', 'settled', 'lastListedAt', 'paused'];
const LISTED_AT_PAGE_LOAD = 10;

const threeLetters = fc.stringMatching(/^[A-Z]{3}$/).filter(isAllowedInitials);
const deposit = fc.integer({ min: 1, max: 400 }).map(units => units * SCORE_STEP);
const signature = fc.record({ initials: threeLetters, score: deposit, id: fc.uuid() }, { noNullPrototype: true });
const best = (a, b) => b.score - a.score;
const rowsOf = sizes => fc.array(signature, sizes).map(rows => rows.sort(best));
const listedAt = fc.integer({ min: 0, max: 2 * LISTED_AT_PAGE_LOAD });

// The answers that arrive while paused: table loads, and once, somewhere among them, the signing's own answer.
const tableAnswer = fc.record({ scores: rowsOf({ maxLength: TABLE_SIZE }), listedAt });
const signingAnswer = fc.record({ rows: rowsOf({ maxLength: TABLE_SIZE - 1 }), onTheTable: fc.boolean(), listedAt });
const answers = fc.tuple(fc.array(tableAnswer, { maxLength: 6 }), signingAnswer, fc.nat())
  .map(([loads, signing, at]) => loads.toSpliced(at % (loads.length + 1), 0, { signing }));

const PAUSES = {
  P: rules => rules.handlePresses(new Set(['KeyP'])),
  Escape: rules => rules.handlePresses(new Set(['Escape'])),
  'pause()': rules => rules.pause(),   // a blurred window or a hidden tab
};

const observe = rules => ({ ...rules.snapshot(), paused: rules.g.paused });

// A game in play, paused, with the signing made at the last game over still on its way: { n, initials, score }.
async function pausedWithASigningOnItsWay(initials, score, pauseWith) {
  const rules = await loadFreshGame();
  rules.tableAnswered({ scores: [], listedAt: LISTED_AT_PAGE_LOAD });
  rules.handlePresses(new Set(['Enter']));
  arrange.deposit(rules, score);
  arrange.formationOnPin(rules);
  rules.update(STEP, keyboard);
  for (const letter of initials) {
    for (let i = 0; i < ALPHABET.indexOf(letter); i++) rules.handlePresses(new Set(['ArrowUp']));
    rules.handlePresses(new Set(['Enter']));
  }
  const entered = rules.takeEvents().find(event => event.type === GameEvent.INITIALS_ENTERED);
  expect(entered, `arranging: ${initials} was not signed`).toMatchObject({ initials, score });
  rules.update(SETTLE_S, keyboard);
  rules.handlePresses(new Set(['Enter']));
  PAUSES[pauseWith](rules);
  rules.takeEvents();
  expect(observe(rules), 'arranging: a paused game with the signing on its way').toMatchObject({
    screen: 'play', paused: true, signing: { n: entered.signing, initials, status: 'pending' },
  });
  return { rules, n: entered.signing };
}

// The signing's own answer: its row among the others when it made the table, at its place by score.
function answerTo({ initials, score }, { rows, onTheTable, listedAt: at }, id) {
  const scores = onTheTable ? [...rows, { initials, score, id }].sort(best) : rows;
  return { scores, id, listedAt: at };
}

const rowsApply = (before, at) => before.lastListedAt === null || at >= before.lastListedAt;
const tableDelta = (before, { scores, listedAt: at }) =>
  (rowsApply(before, at) ? { table: setTo({ status: 'available', rows: scores }), lastListedAt: setTo(at) } : {});

// Settled from its own rows, even when they are too old to apply: confirmed at its row's place, or off the table.
function signingDelta(before, n, answer) {
  const at = answer.scores.findIndex(row => row.id === answer.id);
  const [outcome, id, rank] = at < 0 ? ['off-table', null, null] : ['confirmed', answer.id, at + 1];
  const { initials } = before.signing;
  return {
    ...tableDelta(before, answer),
    signing: setTo({ n, initials, status: outcome, id, rank }),
    settled: setTo({ n, initials, outcome, rank }),
  };
}

// Each hands an answer over, as main.js's promise callbacks do, and says what it must do to the state.
function handTableAnswer(rules, before, answer) {
  rules.tableAnswered(answer);
  return tableDelta(before, answer);
}

function handSigningAnswer(rules, before, n, answer) {
  rules.signingAnswered(n, answer);
  return signingDelta(before, n, answer);
}

test('an answer handed to a paused game shows in snapshot() at once, with no frame, and leaves it paused', async () => {
  const run = fc.record({
    initials: threeLetters, score: deposit, pauseWith: fc.constantFrom(...Object.keys(PAUSES)), id: fc.uuid(), answers,
  });
  await fc.assert(fc.asyncProperty(run, async ({ initials, score, pauseWith, id, answers: inOrder }) => {
    const { rules, n } = await pausedWithASigningOnItsWay(initials, score, pauseWith);
    for (const answer of inOrder) {
      const before = observe(rules);
      const expected = answer.signing ? handSigningAnswer(rules, before, n, answerTo({ initials, score }, answer.signing, id))
        : handTableAnswer(rules, before, answer);
      assertStateDelta(before, observe(rules), { universe: UNIVERSE, expected });
      expect(rules.takeEvents(), 'handing an answer over publishes nothing').toEqual([]);
    }
  }));
});
