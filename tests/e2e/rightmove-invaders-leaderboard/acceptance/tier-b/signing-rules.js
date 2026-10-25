import { isDeepStrictEqual } from 'node:util';
import fc from 'fast-check';
import { expect } from '@playwright/test';
import { loadFreshGame, arrange } from '../../../../unit/support/fresh-game.js';
import { assertStateDelta, setTo } from '../../../../common/state-delta.js';
import { GameEvent, ALPHABET, INITIALS_LENGTH, TABLE_SIZE, BLOCKED_INITIALS, SigningOutcome, TableStatus } from '../steps/domain-types.js';

// Tier B (Mandate 10): the signing lifecycle and the table status as a state machine, explored with fast-check's
// model-based testing. The system is the real rules (src/game/game.js, a fresh copy per run, as in tests/unit); this
// file plays main.js's part: it starts a load on page load and on every gameStarted, takes every initialsEntered as a
// signing, and hands the answers and failures back in ANY order, with any listing time (DDD-11, DDD-12). The network,
// the 5000 ms timeout and the views are out of scope: the browser scenarios (milestones 4-7) cover them.
//
// Shared vocabulary with the browser driver (steps/leaderboard-game.js): startNewGame, finishGameWith, signAs,
// answerSigning, ... InMemoryRules is this tier's composition root; LeaderboardGame is Tier A's.
//
// The oracle is Model below: DESIGN's "Rules operations", "Signing-status lifecycle" and "Table status" tables written
// as code. After every command, the rules' observable state must change exactly as the model's did (state delta,
// fail-closed), over this universe, read ONLY from the read-only snapshot() that game.js exports (the same view the
// views use; never from g's fields):
//   table        { status, rows: ids }            entry    { letters, index } or null
//   signing      { n, initials, status, id, rank } or null (id and rank once confirmed)
//   settled      { n, initials, outcome, rank } or null: the latest settled outcome, which the status mirror announces once
//   lastListedAt the last applied listedAt (DDD-12), or null
//   screen       title | play | over
// The one sanctioned internal access is ARRANGING a moment that random play seldom reaches (finishGameWith): it sets the
// deposit and puts the formation on the pin, only through tests/unit/support/fresh-game.js's checked `arrange.deposit`
// and `arrange.formationOnPin`, as the unit tests do; nothing here writes g's fields itself.
// Covers what the keyboard can't reach in the browser: a game over while the table is unknown, and the answer to a
// signing that a newer signing has replaced (a game takes longer than the 5 s timeout).

const STEP = 1 / 120;
const SETTLE_S = 0.7;                       // Enter restarts only 0.6 s after game over
const keyboard = { isDown: () => false };
const SEED = Number(process.env.FC_SEED ?? 20261023);
const RUNS = 100;
const UNIVERSE = ['table', 'entry', 'signing', 'settled', 'lastListedAt', 'screen'];
const rotate = (letter, by) => ALPHABET[(ALPHABET.indexOf(letter) + by + ALPHABET.length) % ALPHABET.length];

// ---- the in-memory composition root ----
export class InMemoryRules {
  static async fresh() {
    const rules = new InMemoryRules(await loadFreshGame());
    rules.loads = 1;   // the page load's
    return rules;
  }

  constructor(game) {
    this.game = game;
    this.loads = 0;      // loads in flight (they carry no number: the rules order them by listedAt)
    this.signed = [];    // every initialsEntered: { n, initials, score }
  }

  get view() { return this.game.snapshot(); }

  pump() {
    for (const event of this.game.takeEvents()) {
      if (event.type === GameEvent.GAME_STARTED) this.loads++;
      if (event.type === GameEvent.INITIALS_ENTERED) this.signed.push({ n: event.signing, initials: event.initials, score: event.score });
    }
  }

  press(key) {
    this.game.handlePresses(new Set([key]));
    this.pump();
  }

  startNewGame() {
    if (this.view.screen === 'over') this.game.update(SETTLE_S, keyboard);
    this.press('Enter');
  }

  finishGameWith(deposit) {
    expect(this.view.screen, 'arranging: a game must be in play').toBe('play');
    arrange.deposit(this.game, deposit);      // sanctioned arranging (see the header)
    arrange.formationOnPin(this.game);
    this.game.update(STEP, keyboard);
    this.pump();
    expect(this.view.screen, 'arranging: the game did not end').toBe('over');
  }

  pressUp() { this.press('ArrowUp'); }

  pressDown() { this.press('ArrowDown'); }

  pressEnter() { this.press('Enter'); }

  signAs(initials) {
    for (const letter of initials) {
      const { letters, index } = this.view.entry;
      for (let i = 0; i < (ALPHABET.indexOf(letter) - ALPHABET.indexOf(letters[index]) + ALPHABET.length) % ALPHABET.length; i++) this.pressUp();
      this.pressEnter();
    }
  }

  answerTable(answer) {
    this.loads--;
    this.game.tableAnswered(answer);
    this.pump();
  }

  failTable() {
    this.loads--;
    this.game.tableFailed();
    this.pump();
  }

  answerSigning(n, answer) {
    this.game.signingAnswered(n, answer);
    this.pump();
  }

  failSigning(n) {
    this.game.signingFailed(n);
    this.pump();
  }

  observe() {
    const { table, entry, signing, settled, lastListedAt, screen } = this.view;
    const confirmed = s => s.status === SigningOutcome.CONFIRMED || s.outcome === SigningOutcome.CONFIRMED;
    return {
      table: { status: table.status, rows: table.rows.map(row => row.id) },
      entry: entry ? { letters: entry.letters, index: entry.index } : null,
      signing: signing ? { n: signing.n, initials: signing.initials, status: signing.status, ...(confirmed(signing) ? { id: signing.id, rank: signing.rank } : {}) } : null,
      settled: settled ? { n: settled.n, initials: settled.initials, outcome: settled.outcome, ...(confirmed(settled) ? { rank: settled.rank } : {}) } : null,
      lastListedAt: lastListedAt ?? null,
      screen,
    };
  }
}

// ---- the oracle: DESIGN's rules operations ----
class Model {
  status = TableStatus.UNKNOWN;
  rows = [];
  lastListedAt = null;
  screen = 'title';
  entry = null;
  signing = null;
  settled = null;
  inFlight = [];        // signings waiting for an answer: { n, initials, score }
  loads = 1;
  seen = new Set();     // witnesses: which states this run reached

  makesTheTable(deposit) {
    return this.status === TableStatus.AVAILABLE && deposit > 0 && (this.rows.length < TABLE_SIZE || deposit > this.rows[TABLE_SIZE - 1].score);
  }

  applyRows(rows, listedAt) {
    if (this.lastListedAt !== null && listedAt < this.lastListedAt) { this.seen.add('older rows ignored'); return; }
    this.rows = rows;
    this.status = TableStatus.AVAILABLE;
    this.lastListedAt = listedAt;
  }

  settle(signing, outcome, rank, id) {
    this.inFlight = this.inFlight.filter(s => s !== signing);
    this.settled = { n: signing.n, initials: signing.initials, outcome, ...(outcome === SigningOutcome.CONFIRMED ? { rank } : {}) };
    this.seen.add(outcome);
    if (this.signing?.n !== signing.n) { this.seen.add('replaced signing settled'); return; }
    this.signing = { ...this.signing, status: outcome, ...(outcome === SigningOutcome.CONFIRMED ? { id, rank } : {}) };
  }

  view() {
    return {
      table: { status: this.status, rows: this.rows.map(row => row.id) },
      entry: this.entry ? { ...this.entry } : null,
      signing: this.signing ? { ...this.signing } : null,
      settled: this.settled ? { ...this.settled } : null,
      lastListedAt: this.lastListedAt,
      screen: this.screen,
    };
  }
}

// Runs one step on both sides, then checks that the rules' state changed exactly as the model's did.
function stepBoth(model, rules, act) {
  const before = rules.observe();
  act();
  const expected = Object.fromEntries(UNIVERSE.filter(slot => !isDeepStrictEqual(before[slot], model.view()[slot])).map(slot => [slot, setTo(model.view()[slot])]));
  assertStateDelta(before, rules.observe(), { universe: UNIVERSE, expected });
}

const command = (description, check, run) => ({ check, run, toString: () => description });

const startNewGame = () => command('startNewGame', m => m.screen === 'title' || (m.screen === 'over' && !m.entry), (m, r) => stepBoth(m, r, () => {
  r.startNewGame();
  Object.assign(m, { screen: 'play', entry: null, loads: m.loads + 1 });
}));

const finishGameWith = deposit => command(`finishGameWith(${deposit})`, m => m.screen === 'play', (m, r) => stepBoth(m, r, () => {
  r.finishGameWith(deposit);
  if (m.status === TableStatus.UNKNOWN) m.seen.add('game over while unknown');
  m.screen = 'over';
  m.entry = m.makesTheTable(deposit) ? { letters: 'A'.repeat(INITIALS_LENGTH), index: 0 } : null;
  if (m.entry) m.seen.add('asked for initials');
  m.deposit = deposit;
}));

const turn = by => command(by > 0 ? 'pressUp' : 'pressDown', m => m.entry !== null, (m, r) => stepBoth(m, r, () => {
  if (by > 0) r.pressUp(); else r.pressDown();
  const letters = [...m.entry.letters];
  letters[m.entry.index] = rotate(letters[m.entry.index], by);
  m.entry = { ...m.entry, letters: letters.join('') };
}));

// Enter on the initials: takes the letter; the third one signs, unless the initials are on the word filter, which keeps
// the entry open with the letters kept and the first letter current (DISTILL's choice).
function takeLetter(m, r) {
  stepBoth(m, r, () => {
    const signedBefore = r.signed.length;
    r.pressEnter();
    const index = m.entry.index + 1;
    if (index < INITIALS_LENGTH) { m.entry = { ...m.entry, index }; return; }
    if (BLOCKED_INITIALS.includes(m.entry.letters)) { m.entry = { ...m.entry, index: 0 }; m.seen.add('refused'); return; }
    const n = r.signed.length > signedBefore ? r.signed.at(-1).n : 'no initialsEntered event';
    const signing = { n, initials: m.entry.letters, score: m.deposit };
    m.entry = null;
    m.inFlight.push(signing);
    m.signing = { n, initials: signing.initials, status: SigningOutcome.PENDING };
  });
}

const typeLetter = letter => command(`type ${letter}`, m => m.entry !== null, (m, r) => {
  const steps = (ALPHABET.indexOf(letter) - ALPHABET.indexOf(m.entry.letters[m.entry.index]) + ALPHABET.length) % ALPHABET.length;
  for (let i = 0; i < steps; i++) turn(1).run(m, r);
  takeLetter(m, r);
});

const signAs = initials => command(`signAs(${initials})`, m => m.entry !== null && m.entry.index === 0, (m, r) => {
  for (const letter of initials) typeLetter(letter).run(m, r);
});

const answerTable = (rows, listedAt) => command(`answerTable(${rows.length} rows, listedAt ${listedAt})`, m => m.loads > 0, (m, r) => stepBoth(m, r, () => {
  r.answerTable({ scores: rows, listedAt });
  m.loads--;
  m.applyRows(rows, listedAt);
}));

const failTable = () => command('failTable', m => m.loads > 0, (m, r) => stepBoth(m, r, () => {
  r.failTable();
  m.loads--;
  if (m.status === TableStatus.UNKNOWN) { m.status = TableStatus.UNAVAILABLE; m.seen.add('unavailable'); }
}));

// The answer to one in-flight signing: its own rows, with its row at `rank` (1-10) or not at all (off the table).
const answerSigning = (pick, rows, rank, listedAt) => command(`answerSigning(#${pick}, rank ${rank}, listedAt ${listedAt})`, m => m.inFlight.length > 0, (m, r) => stepBoth(m, r, () => {
  const signing = m.inFlight[pick % m.inFlight.length];
  const id = `id${signing.n}`;
  const own = [...rows];
  if (rank !== null) own.splice(Math.min(rank - 1, own.length, TABLE_SIZE - 1), 0, { initials: signing.initials, score: signing.score, id });
  const scores = own.slice(0, TABLE_SIZE);
  r.answerSigning(signing.n, { scores, id, listedAt });
  m.applyRows(scores, listedAt);
  const at = scores.findIndex(row => row.id === id);
  m.settle(signing, at >= 0 ? SigningOutcome.CONFIRMED : SigningOutcome.OFF_TABLE, at + 1, id);
}));

const failSigning = pick => command(`failSigning(#${pick})`, m => m.inFlight.length > 0, (m, r) => stepBoth(m, r, () => {
  const signing = m.inFlight[pick % m.inFlight.length];
  r.failSigning(signing.n);
  m.settle(signing, SigningOutcome.UNCONFIRMED);
}));

// A whole signed game as one command: startNewGame, finishGameWith(deposit) and signAs(initials), each checked and
// stepped on both sides exactly as on its own. Drawn one at a time, those three nearly always lose the race to the
// older signing's answer, so a newer signing seldom overtook it and, for most seeds, no replaced signing ever settled.
// Its initials are never on the word filter: signAs on its own covers refusals.
const anotherSignedGame = (deposit, initials) => command(`anotherSignedGame(${deposit}, ${initials})`, m => startNewGame().check(m), (m, r) => {
  for (const next of [startNewGame(), finishGameWith(deposit), signAs(initials)]) if (next.check(m)) next.run(m, r);
});

const deposit = fc.integer({ min: 0, max: 40 }).map(units => units * 50);
const rowsOfOthers = fc.array(fc.record({ initials: fc.constantFrom('KIM', 'LEO', 'MAX', 'NED'), score: deposit.filter(d => d > 0) }), { maxLength: TABLE_SIZE })
  .map(rows => rows.sort((a, b) => b.score - a.score).map((row, i) => ({ ...row, id: `r${i}` })));
const listedAt = fc.integer({ min: 0, max: 20 });
const ALLOWED_INITIALS = ['FAB', 'ABC', 'ZZY'];
const allowedInitials = fc.constantFrom(...ALLOWED_INITIALS);
const initials = fc.constantFrom(...ALLOWED_INITIALS, ...BLOCKED_INITIALS);

// Weighted by repetition: games, signings and answers often enough that replaced signings and late answers happen, for
// any seed (anotherSignedGame is what lets a newer signing overtake an older one's answer).
const COMMANDS = [
  fc.constant(startNewGame()), fc.constant(startNewGame()), fc.constant(startNewGame()),
  deposit.map(finishGameWith), deposit.map(finishGameWith), deposit.map(finishGameWith),
  fc.constantFrom(1, -1).map(turn),
  fc.constantFrom(...ALPHABET).map(typeLetter),
  initials.map(signAs), initials.map(signAs), initials.map(signAs),
  fc.tuple(rowsOfOthers, listedAt).map(([rows, t]) => answerTable(rows, t)), fc.tuple(rowsOfOthers, listedAt).map(([rows, t]) => answerTable(rows, t)),
  fc.constant(failTable()),
  ...Array.from({ length: 3 }, () => fc.tuple(fc.nat(), rowsOfOthers, fc.option(fc.integer({ min: 1, max: TABLE_SIZE }), { nil: null }), listedAt).map(args => answerSigning(...args))),
  fc.nat().map(failSigning), fc.nat().map(failSigning),
  ...Array.from({ length: 2 }, () => fc.tuple(deposit, allowedInitials).map(([amount, letters]) => anotherSignedGame(amount, letters))),
];

// States every run together must reach, or the property is not exploring what it claims to. The refusal needs the
// owner-reviewed word list, which checkFollowsTheRules demands first (a data gap fails loudly, never silently).
const WITNESSES = ['asked for initials', 'game over while unknown', 'unavailable', 'older rows ignored', SigningOutcome.CONFIRMED,
  SigningOutcome.OFF_TABLE, SigningOutcome.UNCONFIRMED, 'replaced signing settled', 'refused'];

// ---- what the step definitions call ----
export class SigningRules {
  async start() {
    this.rules = await InMemoryRules.fresh();
    this.listedAt = 0;
  }

  // ---- examples ----
  expectTableUnknown() { expect(this.rules.observe().table?.status, 'the table status').toBe(TableStatus.UNKNOWN); }

  gameEndsWith(amount) {
    this.rules.startNewGame();
    this.rules.finishGameWith(amount);
  }

  expectNoEntry() { expect(this.rules.observe().entry, 'initials asked for').toBeNull(); }

  expectNoTableAtGameOver() {
    const { table, screen } = this.rules.observe();
    expect(screen).toBe('over');
    expect(table, 'unknown: no list, and no table line').toEqual({ status: TableStatus.UNKNOWN, rows: [] });
  }

  // The page load answered with an empty table, then a game worth £50 signed as `initials`.
  signingOnItsWay(initials) {
    this.rules.answerTable({ scores: [], listedAt: ++this.listedAt });
    this.signAgain(initials);
  }

  signAgain(initials) {
    this.gameEndsWith(50);
    expect(this.rules.observe().entry, 'arranging: £50 should make an empty table').not.toBeNull();
    this.rules.signAs(initials);
    expect(this.rules.observe().signing, `arranging: ${initials}'s signing`).toMatchObject({ initials, status: SigningOutcome.PENDING });
  }

  newerSigningConfirmed(initials, rank) {
    this.signAgain(initials);
    this.answer(initials, rank);
    expect(this.rules.observe().signing, `arranging: ${initials}'s signing`).toMatchObject({ initials, status: SigningOutcome.CONFIRMED, rank });
  }

  // The table answers `initials`'s signing with the rows it now holds plus that signing's row at `rank`, listed later.
  answer(initials, rank) {
    const { n, score } = this.rules.signed.findLast(s => s.initials === initials);
    const id = `id${n}`;
    const rows = this.rules.view.table.rows.filter(row => row.id !== id);
    rows.splice(rank - 1, 0, { initials, score, id });
    this.before = this.rules.observe();
    this.rules.answerSigning(n, { scores: rows.slice(0, TABLE_SIZE), id, listedAt: ++this.listedAt });
  }

  expectSettledOnce(initials, outcome, rank) {
    const { n } = this.rules.signed.findLast(s => s.initials === initials);
    expect(this.before.settled?.n, 'the outcome was already announced before this answer').not.toBe(n);
    expect(this.rules.observe().settled).toEqual({ n, initials, outcome, rank });
  }

  expectCurrentConfirmed(initials, rank) {
    const { signing, table } = this.rules.observe();
    expect(signing, 'the current signing').toMatchObject({ initials, status: SigningOutcome.CONFIRMED, rank });
    expect(table.rows, 'its row is on the table, so it is the one marked as mine').toContain(signing.id);
  }

  // ---- the property: the When chooses the generator, the Then states the invariant ----
  // 'large' sequences: a replaced signing needs a sign, a new game, a second sign and only then the first answer.
  forAnyJourney() { this.journeys = fc.commands(COMMANDS, { maxCommands: 80, size: 'large' }); }

  async checkFollowsTheRules() {
    expect(BLOCKED_INITIALS.length, 'DATA GAP: the owner-reviewed word list is empty (BLOCKED_INITIALS in src/game/high-scores.js)').toBeGreaterThan(0);
    const seen = new Set();
    await fc.assert(fc.asyncProperty(this.journeys, async commands => {
      const rules = await InMemoryRules.fresh();
      const model = new Model();
      expect(rules.observe(), 'a fresh game: table unknown, no entry, no signing').toEqual(model.view());
      fc.modelRun(() => ({ model, real: rules }), commands);
      for (const witness of model.seen) seen.add(witness);
    }), { seed: SEED, numRuns: RUNS });
    expect(WITNESSES.filter(witness => !seen.has(witness)), 'states no run reached').toEqual([]);
  }
}
