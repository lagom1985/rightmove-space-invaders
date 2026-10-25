import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { loadFreshGame, arrange } from './support/fresh-game.js';
import { createFakeStatusRoot } from './support/fake-status-root.js';
import { assertStateDelta, appendedWith, satisfying, setTo, unchanged } from '../common/state-delta.js';
import { createStatus } from '../../src/view/status.js';
import { pounds } from '../../src/theme/theme.js';
import { ALPHABET, BLOCKED_INITIALS, INITIALS_LENGTH } from '../../src/game/high-scores.js';
import { GameEvent } from '../../src/game/events.js';

// The status mirror (src/view/status.js) over the real rules (a fresh copy of src/game/game.js per run), synced any
// number of times after every move, as the frame loop syncs it once a frame whether anything changed or not. Signings
// are answered or fail in any order, during play, while paused or on a game-over screen, and some answer a signing a
// newer one has replaced (a moment the browser can't reach within the 5 s timeout).
// Universe: what the page exposes to a screen reader, `heard` (every write to the live region), `list` (the High
// scores items, with the one marked as mine) and `initials` (the data-hud="initials" field). The rules are read only
// through snapshot().

const STEP = 1 / 120;
const SETTLE_S = 0.7;   // Enter restarts only 0.6 s after game over
const keyboard = { isDown: () => false };
const UNIVERSE = ['heard', 'list', 'initials'];

// What the game says about a settled signing (DISTILL, Messages).
const SAID = {
  confirmed: (initials, rank) => `Signed ${initials}, #${rank}.`,
  'off-table': initials => `The table filled up before ${initials} arrived.`,
  unconfirmed: initials => `Couldn't confirm ${initials}'s signing.`,
};
const ANY_OUTCOME = /Signed [A-Z]{3}, #\d+\.|The table filled up before [A-Z]{3} arrived\.|Couldn't confirm [A-Z]{3}'s signing\./;

// What the initials field reads (DISTILL, Messages): the letters spaced, and the one being chosen; empty when not entering.
const FIELD = (letters, index) => `${[...letters].join(' ')}, letter ${index + 1} of ${INITIALS_LENGTH}`;
const REFUSAL = 'Those initials aren\'t allowed. Change a letter.';
const ABOUT_THE_INITIALS = /[A-Z] [A-Z] [A-Z], letter [1-3] of 3|Those initials aren't allowed/;

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
    this.initialsField = this.page.root.querySelectorAll('[data-hud]').find(field => field.dataset.hud === 'initials');
    this.signed = [];   // every initialsEntered: { n, initials }
  }

  observe() { return { heard: this.page.heard(), list: this.page.list(), initials: this.initialsField.textContent }; }

  // The entry the rules are showing, as the field reads it.
  expectedField() {
    const { entry } = this.game.snapshot();
    return entry ? FIELD(entry.letters, entry.index) : '';
  }

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
    this.takeSignings();
    for (let i = 0; i < times; i++) {
      const before = this.observe();
      this.sync(this.game.g);
      const heard = i === 0 && outcome ? appendedWith(outcome) : satisfying('nothing said about a signing\'s outcome', (was, now) =>
        now.length >= was.length && now.slice(was.length).every(text => !ANY_OUTCOME.test(text)));
      assertStateDelta(before, this.observe(), { universe: UNIVERSE, expected: { heard, list: setTo(this.expectedList()), initials: setTo(this.expectedField()) } });
    }
  }

  // Does one move, then syncs `times` times: the first sync is heard as `heard` says and shows `field`, every later
  // one changes nothing at all.
  frame(move, times, { heard, field }) {
    move();
    this.takeSignings();
    for (let i = 0; i < times; i++) {
      const before = this.observe();
      this.sync(this.game.g);
      const expected = i === 0 ? { heard, initials: setTo(field) } : {};
      assertStateDelta(before, this.observe(), { universe: UNIVERSE, expected: { ...expected, list: setTo(this.expectedList()) } });
    }
  }

  takeSignings() {
    for (const event of this.game.takeEvents()) if (event.type === GameEvent.INITIALS_ENTERED) this.signed.push({ n: event.signing, initials: event.initials });
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

// ---- the initials field and its announcements (DDD-14) ----
// The entry as DESIGN's rules operations describe it: every letter starts at A, Up and Down move it round the alphabet,
// Enter takes it and moves on, and the third Enter signs, unless the initials are on the word filter: then the letters
// are kept and the first letter is current again (DISTILL's choice). A frame's presses reach the rules as one set (the
// keyboard has already made presses of the same key within a frame one press).
const rotate = (letter, by) => ALPHABET[(ALPHABET.indexOf(letter) + by + ALPHABET.length) % ALPHABET.length];
const NEW_ENTRY = Object.freeze({ letters: 'A'.repeat(INITIALS_LENGTH), index: 0 });

// One frame's keys on the entry -> { entry (null once signed), refused }.
function keysDo({ letters, index }, keys) {
  const chosen = [...letters];
  chosen[index] = rotate(chosen[index], keys.has('ArrowUp') - keys.has('ArrowDown'));
  const initials = chosen.join('');
  if (!keys.has('Enter')) return { entry: { letters: initials, index }, refused: false };
  if (index + 1 < INITIALS_LENGTH) return { entry: { letters: initials, index: index + 1 }, refused: false };
  if (BLOCKED_INITIALS.includes(initials)) return { entry: { letters: initials, index: 0 }, refused: true };
  return { entry: null, refused: false };
}

const nothingAboutTheInitials = satisfying('nothing said about the initials', (was, now) =>
  now.length >= was.length && now.slice(was.length).every(text => !ABOUT_THE_INITIALS.test(text)));

// What the first sync after a frame on an open entry hears and shows, and which moment that frame was.
function heardAfter(was, { entry, refused }) {
  const field = FIELD(entry.letters, entry.index);
  if (field === FIELD(was.letters, was.index)) return { heard: unchanged(), field, moment: 'no change' };
  const moment = refused ? 'refused' : entry.index !== was.index ? 'position' : 'letter';
  return { heard: appendedWith(refused ? `${REFUSAL} ${field}` : field), field, moment };
}

// A game, then a game over with £50 on an empty table: the entry opens, announced by the prompt rather than spelled.
function openEntry(m, r, times) {
  const quiet = { heard: nothingAboutTheInitials, field: '' };
  if (r.screen() === 'over') r.frame(() => r.game.update(SETTLE_S, keyboard), times, quiet);
  r.frame(() => r.press('Enter'), times, quiet);
  r.frame(() => { arrange.deposit(r.game, 50); arrange.formationOnPin(r.game); r.game.update(STEP, keyboard); }, times,
    { heard: nothingAboutTheInitials, field: FIELD(NEW_ENTRY.letters, NEW_ENTRY.index) });
  m.entry = NEW_ENTRY;
}

const pressKeys = (keys, times) => command(`press(${[...keys].join('+') || 'no key'}, ${times} syncs)`, () => true, (m, r) => {
  const press = () => r.game.handlePresses(keys);
  if (!m.entry) {
    m.seen.add('not entering');
    r.frame(press, times, { heard: unchanged(), field: '' });
    return;
  }
  const after = keysDo(m.entry, keys);
  if (after.entry) {
    const { heard, field, moment } = heardAfter(m.entry, after);
    m.seen.add(moment);
    r.frame(press, times, { heard, field });
  } else {
    m.seen.add('signed');
    r.frame(press, times, { heard: nothingAboutTheInitials, field: '' });
  }
  m.entry = after.entry;
});

const signLetters = (initials, times) => command(`signLetters(${initials}, ${times} syncs)`, m => m.entry !== null && m.entry.index === 0, (m, r) => {
  for (const letter of initials) {
    const ups = (ALPHABET.indexOf(letter) - ALPHABET.indexOf(m.entry.letters[m.entry.index]) + ALPHABET.length) % ALPHABET.length;
    for (let i = 0; i < ups; i++) pressKeys(new Set(['ArrowUp']), times).run(m, r);
    pressKeys(new Set(['Enter']), times).run(m, r);
  }
});

const nextEntry = times => command(`nextEntry(${times} syncs)`, m => m.entry === null, (m, r) => openEntry(m, r, times));

const frameKeys = fc.subarray(['ArrowUp', 'ArrowDown', 'Enter', 'Space']).map(keys => new Set(keys));
const ENTRY_COMMANDS = [
  fc.tuple(frameKeys, syncs).map(([keys, times]) => pressKeys(keys, times)),
  fc.tuple(frameKeys, syncs).map(([keys, times]) => pressKeys(keys, times)),
  fc.tuple(fc.constantFrom('FAB', 'ZZY', ...BLOCKED_INITIALS), syncs).map(([initials, times]) => signLetters(initials, times)),
  syncs.map(nextEntry),
];

// Moments every run together must reach.
const ENTRY_WITNESSES = ['letter', 'position', 'refused', 'no change', 'signed', 'not entering'];

test('the initials field reads the entry and is empty otherwise, each change of letter or position is announced once (a refusal with it), and a frame or a sync that changes neither says nothing', async () => {
  const seen = new Set();
  await fc.assert(fc.asyncProperty(syncs, fc.commands(ENTRY_COMMANDS, { maxCommands: 30 }), async (times, commands) => {
    const mirrored = await MirroredGame.fresh();
    const model = { entry: null, seen };
    mirrored.frame(() => {}, times, { heard: nothingAboutTheInitials, field: '' });   // the title
    openEntry(model, mirrored, times);
    fc.modelRun(() => ({ model, real: mirrored }), commands);
  }));
  expect(ENTRY_WITNESSES.filter(witness => !seen.has(witness)), 'moments no run reached').toEqual([]);
});
