import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { loadFreshGame } from './support/fresh-game.js';
import { assertStateDelta, setTo } from '../common/state-delta.js';
import {
  BLOCKED_INITIALS, MAX_PLAUSIBLE_SCORE, MAX_SCORE, SCORE_STEP, TABLE_SIZE, isAllowedInitials, isPlausibleScore, isValidSignature, makesTheTable,
} from '../../src/game/high-scores.js';
import { HURDLES, DREAM_BONUSES } from '../../src/theme/theme.js';

// The shared high-score rules (ADR-006, DDD-3). The word filter and makesTheTable are pure: no state to watch, so their
// properties check the answer alone. The table state the rules keep (src/game/game.js) is read only through snapshot().

const ARCADE_INITIALS = /^[A-Z]{3}$/;
const threeLetters = fc.stringMatching(ARCADE_INITIALS);

// Three letters A-Z broken in one place, the way a hand-made request or a bug would break them.
const NEAR_MISSES = [
  initials => initials.toLowerCase(),
  initials => initials.slice(1),                  // two letters
  initials => `${initials}A`,                     // four letters
  initials => ` ${initials}`,
  initials => `${initials}\n`,
  initials => initials.replace(/^./, 'É'),         // a letter outside A-Z
  initials => initials.replace(/.$/, '1'),
  initials => [...initials],                      // the letters, but not a string
];
const notArcadeInitials = fc.oneof(
  fc.tuple(threeLetters, fc.constantFrom(...NEAR_MISSES)).map(([initials, breakThem]) => breakThem(initials)),
  fc.string(),
  fc.anything(),
).filter(value => !(typeof value === 'string' && ARCADE_INITIALS.test(value)));

test('three letters A-Z are allowed unless they are on the word filter, and every word on it is refused', () => {
  fc.assert(fc.property(fc.oneof(threeLetters, fc.constantFrom(...BLOCKED_INITIALS)), initials => {
    expect(isAllowedInitials(initials)).toBe(!BLOCKED_INITIALS.includes(initials));
  }), { examples: BLOCKED_INITIALS.map(word => [word]) });
});

test('anything that isn\'t three letters A-Z is never allowed', () => {
  fc.assert(fc.property(notArcadeInitials, value => {
    expect(isAllowedInitials(value)).toBe(false);
  }));
});

// ---- who is asked for initials ----
const deposit = fc.integer({ min: 0, max: 400 }).map(units => units * SCORE_STEP);
// Plain objects, as rows parsed from the table's JSON answer always are.
const signature = fc.record({ initials: threeLetters, score: deposit.filter(score => score > 0), id: fc.uuid() }, { noNullPrototype: true });
const rowsOf = sizes => fc.array(signature, sizes).map(rows => Object.freeze(rows.sort((a, b) => b.score - a.score).map(Object.freeze)));
const tableOf = (status, sizes) => fc.tuple(status, rowsOf(sizes)).map(([s, rows]) => Object.freeze({ status: s, rows }));
const anyRows = { maxLength: TABLE_SIZE };
const withRoom = { maxLength: TABLE_SIZE - 1 };
const full = { minLength: TABLE_SIZE, maxLength: TABLE_SIZE };

test('a table that isn\'t available, or no deposit, never asks for initials, whatever the table holds', () => {
  const notAvailable = fc.tuple(tableOf(fc.constantFrom('unknown', 'unavailable'), anyRows), deposit);
  const noDeposit = fc.tuple(tableOf(fc.constant('available'), anyRows), fc.constant(0));
  fc.assert(fc.property(fc.oneof(notAvailable, noDeposit), ([table, amount]) => {
    expect(makesTheTable(table, amount)).toBe(false);
  }));
});

const EMPTY_TABLE = Object.freeze({ status: 'available', rows: Object.freeze([]) });

test('while an available table has room, any deposit above £0 up to the plausible ceiling makes it', () => {
  fc.assert(fc.property(tableOf(fc.constant('available'), withRoom), deposit.filter(amount => amount > 0), (table, amount) => {
    expect(makesTheTable(table, amount)).toBe(true);
  }), { examples: [[EMPTY_TABLE, MAX_PLAUSIBLE_SCORE]] });
});

// ---- the plausible ceiling (docs/analysis/root-cause-analysis-forged-high-scores.md, S1) ----
// The key's 7-digit field holds up to £9,999,999 (ADR-004), far beyond any game. Above MAX_PLAUSIBLE_SCORE the table
// refuses a score (400 implausible-score) and the game asks for no initials, so it never sends one.
const unitsOf = amount => Math.floor(amount / SCORE_STEP);
const aboveTheCeiling = fc.integer({ min: unitsOf(MAX_PLAUSIBLE_SCORE) + 1, max: unitsOf(MAX_SCORE) }).map(units => units * SCORE_STEP);
const anyValidScore = fc.integer({ min: 1, max: unitsOf(MAX_SCORE) }).map(units => units * SCORE_STEP);

test('the plausible ceiling is itself a deposit the table takes', () => {
  expect(isValidSignature({ initials: 'FAB', score: MAX_PLAUSIBLE_SCORE })).toBe(true);
});

test('a valid score is plausible exactly when it is no more than the ceiling', () => {
  fc.assert(fc.property(anyValidScore, score => {
    expect(isPlausibleScore(score)).toBe(score <= MAX_PLAUSIBLE_SCORE);
  }), { examples: [[MAX_PLAUSIBLE_SCORE], [MAX_PLAUSIBLE_SCORE + SCORE_STEP], [unitsOf(MAX_SCORE) * SCORE_STEP]] });
});

test('a deposit above the plausible ceiling never makes the table, not even an empty one', () => {
  fc.assert(fc.property(tableOf(fc.constant('available'), anyRows), aboveTheCeiling, (table, amount) => {
    expect(makesTheTable(table, amount)).toBe(false);
  }), { examples: [[EMPTY_TABLE, MAX_PLAUSIBLE_SCORE + SCORE_STEP]] });
});

// Deposits a few steps either side of the 10th row's score, so a tie comes up often.
test('a full table is made only by beating its 10th row: a tie misses', () => {
  const nearTheTenth = fc.tuple(tableOf(fc.constant('available'), full), fc.integer({ min: -3, max: 3 }))
    .map(([table, steps]) => [table, table.rows[TABLE_SIZE - 1].score + steps * SCORE_STEP])
    .filter(([, amount]) => amount > 0);
  fc.assert(fc.property(nearTheTenth, ([table, amount]) => {
    expect(makesTheTable(table, amount)).toBe(amount > table.rows[TABLE_SIZE - 1].score);
  }));
});

// ---- the deposit a game can save ----
// Every hurdle value and Dream Home bonus is a multiple of SCORE_STEP, so whatever a game saves the table takes
// (DESIGN, Reuse Analysis). Each value on its own is an example, so every one of them is checked on every run.
const VALUES = [...HURDLES.map(hurdle => hurdle.value), ...DREAM_BONUSES];

test('a deposit made of hurdles and Dream Homes is always a multiple of the £50 step, so the table takes it', () => {
  fc.assert(fc.property(fc.array(fc.constantFrom(...VALUES), { minLength: 1 }), values => {
    const saved = values.reduce((sum, value) => sum + value, 0);
    expect(saved % SCORE_STEP, `${values.join(' + ')} = £${saved}`).toBe(0);
    expect(isValidSignature({ initials: 'FAB', score: saved }), `£${saved} as a signature`).toBe(true);
  }), { examples: VALUES.map(value => [[value]]) });
});

// ---- the table state, read through snapshot() ----
// The page load's answer and the refreshes' arrive in any order, with any listing time (DDD-12), or fail (DDD-9).
const UNIVERSE = ['screen', 'table', 'entry', 'signing', 'settled', 'lastListedAt'];
const loadOutcome = fc.oneof(
  fc.record({ answered: fc.constant(true), scores: rowsOf(anyRows), listedAt: fc.integer({ min: 0, max: 20 }) }),
  fc.constant({ answered: false }),
);

// What one outcome does to the table, as DESIGN's "Rules operations" table says.
function expectedDelta(before, outcome) {
  if (!outcome.answered) return before.table.status === 'unknown' ? { table: setTo({ status: 'unavailable', rows: [] }) } : {};
  if (before.lastListedAt !== null && outcome.listedAt < before.lastListedAt) return {};
  return { table: setTo({ status: 'available', rows: outcome.scores }), lastListedAt: setTo(outcome.listedAt) };
}

const isDeeplyFrozen = value => typeof value !== 'object' || value === null || (Object.isFrozen(value) && Object.values(value).every(isDeeplyFrozen));

test('rows apply only when listed no earlier than the rows shown, and only a first load that fails makes the table unavailable', async () => {
  await fc.assert(fc.asyncProperty(fc.array(loadOutcome, { minLength: 1, maxLength: 12 }), async outcomes => {
    const game = await loadFreshGame();
    expect(game.snapshot(), 'a fresh game: the table unknown').toEqual({
      screen: 'title', table: { status: 'unknown', rows: [] }, entry: null, skipped: false, signing: null, settled: null,
      lastListedAt: null,
    });
    for (const outcome of outcomes) {
      const before = game.snapshot();
      if (outcome.answered) game.tableAnswered({ scores: outcome.scores, listedAt: outcome.listedAt }); else game.tableFailed();
      const after = game.snapshot();
      assertStateDelta(before, after, { universe: UNIVERSE, expected: expectedDelta(before, outcome) });
      expect(isDeeplyFrozen(after), 'the snapshot is read-only').toBe(true);
    }
  }));
});
