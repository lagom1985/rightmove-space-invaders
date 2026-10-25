import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { loadFreshGame, arrange } from './support/fresh-game.js';
import { createFakeStatusRoot } from './support/fake-status-root.js';
import { assertStateDelta, appendedWith, satisfying, setTo } from '../common/state-delta.js';
import { createStatus } from '../../src/view/status.js';
import { pounds } from '../../src/theme/theme.js';
import { ALPHABET } from '../../src/game/high-scores.js';
import { GameEvent } from '../../src/game/events.js';

// The status mirror (src/view/status.js) over the real rules (a fresh copy of src/game/game.js per run), synced any
// number of times after every move, as the frame loop syncs it once a frame whether anything changed or not. Signings
// are answered or fail in any order, during play, while paused or on a game-over screen, and some answer a signing a
// newer one has replaced (a moment the browser can't reach within the 5 s timeout).
// Universe: what the page exposes to a screen reader, `heard` (every write to the live region) and `list` (the High
// scores items, with the one marked as mine). The rules are read only through snapshot().

const STEP = 1 / 120;
const SETTLE_S = 0.7;   // Enter restarts only 0.6 s after game over
const keyboard = { isDown: () => false };
const UNIVERSE = ['heard', 'list'];

// What the game says about a settled signing (DISTILL, Messages).
const SAID = {
  confirmed: (initials, rank) => `Signed ${initials}, #${rank}.`,
  'off-table': initials => `The table filled up before ${initials} arrived.`,
  unconfirmed: initials => `Couldn't confirm ${initials}'s signing.`,
};
const ANY_OUTCOME = /Signed [A-Z]{3}, #\d+\.|The table filled up before [A-Z]{3} arrived\.|Couldn't confirm [A-Z]{3}'s signing\./;

class MirroredGame {
  static async fresh() {
    const game = await loadFreshGame();
    game.tableAnswered({ scores: [], listedAt: 0 });   // the page load's answer: an empty table
    return new MirroredGame(game);
  }

  constructor(game) {
    this.game = game;
    this.page = createFakeStatusRoot();
    this.sync = createStatus(this.page.root);
    this.signed = [];   // every initialsEntered: { n, initials }
  }

  observe() { return { heard: this.page.heard(), list: this.page.list() }; }

  // The rows shown while the table is available, the confirmed current signing's marked.
  expectedList() {
    const { table, signing } = this.game.snapshot();
    const mine = signing?.status === 'confirmed' ? signing.id : null;
    const rows = table.status === 'available' ? table.rows : [];
    return rows.map(row => ({ text: `${row.initials} ${pounds(row.score)}`, current: row.id === mine }));
  }

  // Does one move, then syncs `times` times: the first sync says `outcome` (or no outcome at all), every later one nothing.
  act(move, times = 1, outcome = null) {
    move();
    for (const event of this.game.takeEvents()) if (event.type === GameEvent.INITIALS_ENTERED) this.signed.push({ n: event.signing, initials: event.initials });
    for (let i = 0; i < times; i++) {
      const before = this.observe();
      this.sync(this.game.g);
      const heard = i === 0 && outcome ? appendedWith(outcome) : satisfying('nothing said about a signing\'s outcome', (was, now) =>
        now.length >= was.length && now.slice(was.length).every(text => !ANY_OUTCOME.test(text)));
      assertStateDelta(before, this.observe(), { universe: UNIVERSE, expected: { heard, list: setTo(this.expectedList()) } });
    }
  }

  press(key) { this.game.handlePresses(new Set([key])); }

  screen() { return this.game.snapshot().screen; }
}

// ---- the moves, with the little the model needs to know which ones can happen ----
const command = (description, check, run) => ({ check, run, toString: () => description });

const playAndSign = (initials, times) => command(`playAndSign(${initials})`, m => !m.paused, (m, r) => {
  if (r.screen() === 'over') r.act(() => r.game.update(SETTLE_S, keyboard));
  if (r.screen() !== 'play') r.act(() => r.press('Enter'));
  r.act(() => { arrange.deposit(r.game, 50); arrange.formationOnPin(r.game); r.game.update(STEP, keyboard); });
  expect(r.game.snapshot().entry, 'arranging: £50 should make a table that has room').not.toBeNull();
  for (const letter of initials) {
    for (let i = 0; i < ALPHABET.indexOf(letter); i++) r.act(() => r.press('ArrowUp'));
    r.act(() => r.press('Enter'), times);
  }
  m.inFlight.push(r.signed.at(-1));
});

const startNewGame = times => command('startNewGame', m => !m.paused, (m, r) => {
  if (r.screen() === 'over') r.act(() => r.game.update(SETTLE_S, keyboard));
  if (r.screen() !== 'play') r.act(() => r.press('Enter'), times);
});

const togglePause = times => command('togglePause', () => true, (m, r) => {
  if (r.screen() !== 'play') return;
  r.act(() => r.press('KeyP'), times);
  m.paused = !m.paused;
});

// Settles one signing on its way, noting the moment it settled in.
function settle(m, r, pick, settleIt) {
  const [signing] = m.inFlight.splice(pick % m.inFlight.length, 1);
  if (r.game.snapshot().signing.n !== signing.n) m.seen.add('replaced');
  if (m.paused) m.seen.add('paused');
  m.seen.add(r.screen());
  m.seen.add(settleIt(signing));
}

// The table answers a signing with its own rows: `above` rows of others, then its row unless the table filled up first.
const answer = (pick, above, onTable, listedAt, times) => command(`answer(#${pick}, ${above} above, ${onTable ? 'on' : 'off'} the table, listedAt ${listedAt})`,
  m => m.inFlight.length > 0, (m, r) => {
    settle(m, r, pick, ({ n, initials }) => {
      const id = `id${n}`;
      const scores = Array.from({ length: above }, (_, i) => ({ initials: 'KIM', score: 1000, id: `r${n}-${i}` }));
      if (onTable) scores.push({ initials, score: 50, id });
      const said = onTable ? SAID.confirmed(initials, above + 1) : SAID['off-table'](initials);
      r.act(() => r.game.signingAnswered(n, { scores, id, listedAt }), times, said);
      return onTable ? 'confirmed' : 'off-table';
    });
  });

const fail = (pick, times) => command(`fail(#${pick})`, m => m.inFlight.length > 0, (m, r) => {
  settle(m, r, pick, ({ n, initials }) => {
    r.act(() => r.game.signingFailed(n), times, SAID.unconfirmed(initials));
    return 'unconfirmed';
  });
});

const syncs = fc.integer({ min: 1, max: 3 });
const COMMANDS = [
  fc.tuple(fc.constantFrom('FAB', 'ABC', 'BEA'), syncs).map(([initials, times]) => playAndSign(initials, times)),
  fc.tuple(fc.constantFrom('FAB', 'ABC', 'BEA'), syncs).map(([initials, times]) => playAndSign(initials, times)),
  syncs.map(startNewGame),
  syncs.map(togglePause),
  fc.tuple(fc.nat(), fc.integer({ min: 0, max: 3 }), fc.boolean(), fc.integer({ min: 0, max: 20 }), syncs).map(args => answer(...args)),
  fc.tuple(fc.nat(), fc.integer({ min: 0, max: 3 }), fc.boolean(), fc.integer({ min: 0, max: 20 }), syncs).map(args => answer(...args)),
  fc.tuple(fc.nat(), syncs).map(([pick, times]) => fail(pick, times)),
];

// Moments every run together must reach, or the property isn't exploring what it claims to.
const WITNESSES = ['confirmed', 'off-table', 'unconfirmed', 'replaced', 'paused', 'play', 'over'];

test('each settled signing is announced exactly once, however often the mirror syncs, in any game state and a replaced signing\'s included, and only the current confirmed row is marked', async () => {
  const seen = new Set();
  await fc.assert(fc.asyncProperty(fc.commands(COMMANDS, { maxCommands: 40, size: 'large' }), async commands => {
    const mirrored = await MirroredGame.fresh();
    const model = { inFlight: [], paused: false, seen };
    mirrored.act(() => {}, 2);   // the first frames: the title, no outcome
    fc.modelRun(() => ({ model, real: mirrored }), commands);
  }));
  expect(WITNESSES.filter(witness => !seen.has(witness)), 'moments no run reached').toEqual([]);
});
