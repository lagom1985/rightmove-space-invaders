import { isDeepStrictEqual } from 'node:util';
import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { loadFreshGame, arrange } from './support/fresh-game.js';
import { createFakeStatusRoot } from './support/fake-status-root.js';
import { assertStateDelta, appendedWith, satisfying, setTo, unchanged } from '../common/state-delta.js';
import { createStatus } from '../../src/view/status.js';
import { pounds } from '../../src/theme/theme.js';
import { BLOCKED_INITIALS, INITIALS_LENGTH, isAllowedInitials } from '../../src/game/high-scores.js';
import { GameEvent } from '../../src/game/events.js';

// The status mirror (src/view/status.js) over the real rules (a fresh copy of src/game/game.js per run), synced any
// number of times after every move, as the frame loop syncs it once a frame whether anything changed or not. Signings
// are answered or fail in any order, during play, while paused or on a game-over screen, and some answer a signing a
// newer one has replaced (a moment the browser can't reach within the 5 s timeout).
// Universe: what the page exposes to a screen reader, `heard` (every write to the live region), `list` (the High
// scores items, with the one marked as mine) and `initials` (the data-hud="initials" field). The rules are read only
// through snapshot().

const STEP = 1 / 120;
const SETTLE_S = 0.7;   // Enter restarts, and the entry takes typed presses, only 0.6 s after game over
const keyboard = { isDown: () => false };
const UNIVERSE = ['heard', 'list', 'initials'];

// What the game says about a settled signing (DISTILL, Messages).
const SAID = {
  confirmed: (initials, rank) => `Signed ${initials}, #${rank}.`,
  'off-table': initials => `The table filled up before ${initials} arrived.`,
  unconfirmed: initials => `Couldn't confirm ${initials}'s signing.`,
};
const ANY_OUTCOME = /Signed [A-Z]{3}, #\d+\.|The table filled up before [A-Z]{3} arrived\.|Couldn't confirm [A-Z]{3}'s signing\./;

// What the initials field reads (typed-initials, Player-facing wording): the letters typed, spaced, and the next one to
// type, or Enter once all three are in; empty when not entering.
const FIELD = letters => {
  const spaced = [...letters].join(' ');
  if (!letters) return `No letters yet, letter 1 of ${INITIALS_LENGTH}`;
  return letters.length < INITIALS_LENGTH ? `${spaced}, letter ${letters.length + 1} of ${INITIALS_LENGTH}` : `${spaced}, press Enter to sign`;
};
const REFUSAL = 'Those initials aren\'t allowed. Type different ones.';
const ABOUT_THE_INITIALS = /No letters yet, letter 1 of 3|\b[A-Z](?: [A-Z]){0,2}, (?:letter [2-3] of 3|press Enter to sign)|Those initials aren't allowed|Type 3 letters to sign/;
const isLetter = key => /^[A-Za-z]$/.test(key);
// A key press's position, as the keyboard reports it beside the key (DDD-T1): a letter's key, or the key's own name.
const KEY_CODES = { é: 'Digit2', 1: 'Digit1' };
const codeOf = key => (isLetter(key) ? `Key${key.toUpperCase()}` : KEY_CODES[key] ?? key);

class MirroredGame {
  // The page load has answered with an empty table, unless the table is to stay unknown until something says otherwise.
  static async fresh({ answered = true } = {}) {
    const game = await loadFreshGame();
    if (answered) game.tableAnswered({ scores: [], listedAt: 0 });
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
    return entry ? FIELD(entry.letters) : '';
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

  // One frame's typed presses, as main.js hands them over: their positions as a set of codes, and { key } in order.
  type(...keys) { this.game.handlePresses(new Set(keys.map(codeOf)), keys.map(key => ({ key }))); }

  // Enter, as a position alone: it starts a game only once no entry is open, since an open entry takes typed presses.
  restart() {
    expect(this.game.snapshot().entry, 'arranging: a new game is started only once no entry is open').toBeNull();
    this.press('Enter');
  }

  screen() { return this.game.snapshot().screen; }
}

// ---- the moves, with the little the model needs to know which ones can happen ----
const command = (description, check, run) => ({ check, run, toString: () => description });

const playAndSign = (initials, times) => command(`playAndSign(${initials})`, m => !m.paused, (m, r) => {
  if (r.screen() === 'over') r.act(() => r.game.update(SETTLE_S, keyboard));
  if (r.screen() !== 'play') r.act(() => r.restart());
  r.act(() => { arrange.deposit(r.game, 50); arrange.formationOnPin(r.game); r.game.update(STEP, keyboard); });
  expect(r.game.snapshot().entry, 'arranging: £50 should make a table that has room').not.toBeNull();
  r.act(() => r.game.update(SETTLE_S, keyboard));
  for (const letter of initials) r.act(() => r.type(letter.toLowerCase()), times);
  r.act(() => r.type('Enter'), times);
  m.inFlight.push(r.signed.at(-1));
});

const startNewGame = times => command('startNewGame', m => !m.paused, (m, r) => {
  if (r.screen() === 'over') r.act(() => r.game.update(SETTLE_S, keyboard));
  if (r.screen() !== 'play') r.act(() => r.restart(), times);
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

// ---- the initials field and its announcements (DDD-T10) ----
// The typed entry as DESIGN's rules operations describe it: the entry opens empty, a letter fills the next slot in
// capitals (a fourth is ignored), Backspace takes back the last letter (and does nothing on an empty entry), every other
// key does nothing, Enter with fewer than three letters shows the too-few hint and keeps them, and Enter with three
// allowed letters signs and drops the rest of the frame. A frame's typed presses reach the rules together, in order, so
// the mirror hears the frame once: the hint it leaves on show if that hint is new, then the field if it changed. Each
// hint is a new notice with a new number (DDD-T6), so it is heard even when one is on show already, and in a later game
// even after an earlier game's; a hint left on show by a key the entry ignores is not heard again, and one shown and
// cleared within a frame is never heard (DDD-T10's accepted edge). The word filter's refusal (01-08, parked below) is
// not drawn here: a frame is played only when its Enter with three letters signs.
const ENTRY_KEYS = ['a', 'l', 'x', 'm', 'F', 'Backspace', 'ArrowUp', '1', 'é', 'Enter'];
const QUIET_KEYS = ['a', 'l', 'x', 'Backspace', 'ArrowUp', '1', 'é'];   // keys that do nothing on a game-over screen with no entry
const HINT = 'Type 3 letters to sign.';

// What one key does to the letters, and which moment that was; Enter is the frame's own (keysDo).
function keyDoes(letters, key) {
  if (key === 'Backspace') return letters ? { letters: letters.slice(0, -1), moment: 'a letter taken back' } : { letters, moment: 'Backspace on an empty entry' };
  if (!isLetter(key)) return { letters, moment: null };
  return letters.length < INITIALS_LENGTH ? { letters: letters + key.toUpperCase(), moment: null } : { letters, moment: 'a fourth letter' };
}

// Enter too early: a new hint, and which moment that was, by the hint the frame had on show until then.
const HINT_AGAIN = { kept: 'a hint again', new: 'two hints within one frame' };

// One frame's typed presses on the entry, with or without a hint on show -> { letters (null once signed), hint (null,
// 'kept' when the hint on show stays, 'new' when the frame leaves a new one), signed (the initials signed), moments (what
// its keys did) }, or null when an Enter in it would be refused. A key that changes the letters clears the hint.
function keysDo(letters, hintShown, keys) {
  let typed = letters, hint = hintShown ? 'kept' : null;
  const moments = [];
  for (const key of keys) {
    if (key === 'Enter' && typed.length === INITIALS_LENGTH) return isAllowedInitials(typed) ? { letters: null, hint: null, signed: typed, moments } : null;
    if (key === 'Enter') {
      if (hint) moments.push(HINT_AGAIN[hint]);
      hint = 'new';
      continue;
    }
    const { letters: after, moment } = keyDoes(typed, key);
    if (after !== typed) {
      if (hint) moments.push(hint === 'new' ? 'a hint shown and cleared within one frame' : 'a hint cleared');
      hint = null;
    }
    typed = after;
    if (moment) moments.push(moment);
  }
  if (hint === 'kept' && keys.length) moments.push('a hint left on show');
  return { letters: typed, hint, signed: null, moments };
}

const nothingAboutTheInitials = satisfying('nothing said about the initials', (was, now) =>
  now.length >= was.length && now.slice(was.length).every(text => !ABOUT_THE_INITIALS.test(text)));

// What the first sync after a frame on an open entry hears and shows, and which moment that frame was. The Enter that
// signs is heard as the signing alone, as the game-over screen describes it; a new hint comes before the field.
function heardAfter(was, { letters, hint, signed }) {
  if (signed) return { heard: appendedWith(`Signing ${signed}… Press Enter to house-hunt again.`), field: '', moment: 'signed' };
  const field = FIELD(letters);
  if (hint === 'new') return letters === was ? { heard: appendedWith(HINT), field, moment: 'a hint' } : { heard: appendedWith(`${HINT} ${field}`), field, moment: 'a hint and other letters' };
  if (letters === was) return { heard: unchanged(), field, moment: 'no change' };
  const added = letters.length - was.length;
  return { heard: appendedWith(field), field, moment: added > 1 ? 'letters within one frame' : added === 1 ? 'a letter' : 'other letters' };
}

// A game, then a game over with £50 on an empty table: the entry opens empty, announced by the prompt rather than spelled,
// and takes typed presses once 0.6 s of game over have passed.
function openEntry(m, r, times) {
  const quiet = { heard: nothingAboutTheInitials, field: '' };
  if (r.screen() === 'over') r.frame(() => r.game.update(SETTLE_S, keyboard), times, quiet);
  r.frame(() => r.restart(), times, quiet);
  r.frame(() => { arrange.deposit(r.game, 50); arrange.formationOnPin(r.game); r.game.update(STEP, keyboard); }, times,
    { heard: nothingAboutTheInitials, field: FIELD('') });
  r.frame(() => r.game.update(SETTLE_S, keyboard), times, { heard: unchanged(), field: FIELD('') });
  m.entry = '';
  m.hint = false;
}

// The model's entry is the letters typed, or null while no entry is open; hint, whether the too-few hint is on show.
const typeKeys = (keys, times) => command(`type(${keys.join(' ') || 'nothing'}, ${times} syncs)`,
  m => m.entry !== null && keysDo(m.entry, m.hint, keys) !== null, (m, r) => {
    const after = keysDo(m.entry, m.hint, keys);
    const { heard, field, moment } = heardAfter(m.entry, after);
    [moment, ...after.moments].forEach(seen => m.seen.add(seen));
    r.frame(() => r.type(...keys), times, { heard, field });
    m.entry = after.letters;
    m.hint = after.hint !== null;
  });

const typeWithNoEntry = (keys, times) => command(`typeWithNoEntry(${keys.join(' ') || 'nothing'}, ${times} syncs)`, m => m.entry === null, (m, r) => {
  m.seen.add('not entering');
  r.frame(() => r.type(...keys), times, { heard: unchanged(), field: '' });
});

// Takes back any letters typed, one frame, then types the initials a frame apart and signs them.
const signLetters = (initials, times) => command(`signLetters(${initials}, ${times} syncs)`, m => m.entry !== null, (m, r) => {
  if (m.entry) typeKeys([...m.entry].map(() => 'Backspace'), times).run(m, r);
  for (const letter of initials.toLowerCase()) typeKeys([letter], times).run(m, r);
  typeKeys(['Enter'], times).run(m, r);
});

const nextEntry = times => command(`nextEntry(${times} syncs)`, m => m.entry === null, (m, r) => openEntry(m, r, times));

const frameOf = keys => fc.array(fc.constantFrom(...keys), { maxLength: 4 });
const ENTRY_COMMANDS = [
  fc.tuple(frameOf(ENTRY_KEYS), syncs).map(([keys, times]) => typeKeys(keys, times)),
  fc.tuple(frameOf(ENTRY_KEYS), syncs).map(([keys, times]) => typeKeys(keys, times)),
  // Frames about the hint, which random frames seldom are.
  fc.tuple(fc.constantFrom(['Enter'], ['Enter', 'Enter'], ['l', 'Enter'], ['Enter', 'a'], ['ArrowUp']), syncs).map(([keys, times]) => typeKeys(keys, times)),
  fc.tuple(frameOf(QUIET_KEYS), syncs).map(([keys, times]) => typeWithNoEntry(keys, times)),
  fc.tuple(fc.constantFrom('FAB', 'ZZY'), syncs).map(([initials, times]) => signLetters(initials, times)),
  syncs.map(nextEntry),
];

// Moments every run together must reach.
const ENTRY_WITNESSES = ['a letter', 'letters within one frame', 'a letter taken back', 'Backspace on an empty entry', 'a fourth letter',
  'no change', 'signed', 'not entering', 'a hint', 'a hint and other letters', 'a hint again', 'two hints within one frame',
  'a hint cleared', 'a hint left on show', 'a hint shown and cleared within one frame'];

test('the initials field reads the typed entry and is empty otherwise, each frame that changes the letters (a letter, or Backspace taking one back) is announced once as the field it leaves, a frame or a sync that changes nothing (Backspace on an empty entry, a fourth letter, a key the entry ignores with the hint on show) says nothing, each too-few hint is announced once, by its number, before the field, in the same game and the next, and the Enter that signs is heard as the signing', async () => {
  const seen = new Set();
  await fc.assert(fc.asyncProperty(syncs, fc.commands(ENTRY_COMMANDS, { maxCommands: 30 }), async (times, commands) => {
    const mirrored = await MirroredGame.fresh();
    const model = { entry: null, hint: false, seen };
    mirrored.frame(() => {}, times, { heard: nothingAboutTheInitials, field: '' });   // the title
    openEntry(model, mirrored, times);
    fc.modelRun(() => ({ model, real: mirrored }), commands);
  }));
  expect(ENTRY_WITNESSES.filter(witness => !seen.has(witness)), 'moments no run reached').toEqual([]);
});

// Two games, each with its early Enters, a frame apart, after some letters, then signed: each hint is heard, game 2's
// too, though game 1's last hint had the same words. It fails if the notice numbers restart with each entry (DDD-T6).
const earlyEnters = fc.record({ letters: fc.constantFrom('', 'a', 'al'), enters: fc.integer({ min: 1, max: 2 }) });

test('a too-few hint in the next game is heard, once, even after the last game\'s hint with the same words', async () => {
  await fc.assert(fc.asyncProperty(syncs, earlyEnters, earlyEnters, async (times, ...games) => {
    const mirrored = await MirroredGame.fresh();
    const model = { entry: null, hint: false, seen: new Set() };
    mirrored.frame(() => {}, times, { heard: nothingAboutTheInitials, field: '' });   // the title
    for (const { letters, enters } of games) {
      openEntry(model, mirrored, times);
      if (letters) typeKeys([...letters], times).run(model, mirrored);
      for (let i = 0; i < enters; i++) typeKeys(['Enter'], times).run(model, mirrored);
      signLetters('FAB', times).run(model, mirrored);
    }
  }));
});

// The word filter's refusal (D4): the entry is emptied, and the refusal is heard once, by its number, with the empty
// field, in one write (DDD-T6, DDD-T9, DDD-T10).
test('initials on the word filter are refused at Enter: the entry is emptied, and the refusal is heard once, with the empty field', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom(...BLOCKED_INITIALS), syncs, async (blocked, times) => {
    const mirrored = await MirroredGame.fresh();
    const model = { entry: null, hint: false, seen: new Set() };
    mirrored.frame(() => {}, times, { heard: nothingAboutTheInitials, field: '' });   // the title
    openEntry(model, mirrored, times);
    for (const letter of blocked.toLowerCase()) typeKeys([letter], times).run(model, mirrored);
    mirrored.frame(() => mirrored.type('Enter'), times, { heard: appendedWith(`${REFUSAL} ${FIELD('')}`), field: FIELD('') });
  }));
});

// ---- what game over says about the table (DDD-9) ----
// No load ever answers here, so the table is unknown until a load fails, and unavailable from then on; loads fail at
// any moment (on the title, in play or on the game-over screen), any number of times. Game over with the table
// unavailable says 'High-score table unavailable.' once: in the game-over message, or on its own when the table turns
// unavailable on the game-over screen. With the table unknown, game over says nothing about the table (DISTILL,
// Messages: no neutral wording). Either way nobody is asked for initials, no list is shown, and the game plays on.
const TABLE_UNAVAILABLE = 'High-score table unavailable.';
const PLAY_AGAIN = 'Press Enter to house-hunt again.';
const ABOUT_THE_TABLE = /High-score table|Enter your initials/;
const occurrences = (text, part) => text.split(part).length - 1;
const keptWhatWasSaid = (was, now) => isDeepStrictEqual(now.slice(0, was.length), was);

const nothingAboutTheTable = satisfying('nothing said about the table', (was, now) =>
  keptWhatWasSaid(was, now) && now.slice(was.length).every(text => !ABOUT_THE_TABLE.test(text)));

// The game-over message alone: the deposit, the table line once if the table is unavailable and nothing else about the
// table, no prompt, and the way to play on.
const gameOverSays = (deposit, unavailable) => satisfying(
  `the game-over message for ${pounds(deposit)}, ${unavailable ? 'saying once that the table is unavailable' : 'saying nothing about the table'}`,
  (was, now) => {
    if (now.length !== was.length + 1 || !keptWhatWasSaid(was, now)) return false;
    const said = now.at(-1);
    return said.startsWith('Game over: ') && said.includes(`Deposit saved ${pounds(deposit)}.`) && said.endsWith(PLAY_AGAIN) &&
      occurrences(said, TABLE_UNAVAILABLE) === Number(unavailable) && !ABOUT_THE_TABLE.test(said.replace(TABLE_UNAVAILABLE, ''));
  });

const failureMoments = fc.array(fc.constantFrom('title', 'play', 'over'), { maxLength: 4 });
const TABLE_WITNESSES = ['unknown at game over', 'unavailable before game over', 'unavailable on the game-over screen', 'failed again on the game-over screen'];

test('at game over an unavailable table is said to be unavailable once, an unknown one says nothing about the table, and neither asks for initials or shows a list', async () => {
  const seen = new Set();
  await fc.assert(fc.asyncProperty(failureMoments, fc.integer({ min: 0, max: 20 }), syncs, async (moments, fifties, times) => {
    const r = await MirroredGame.fresh({ answered: false });
    const deposit = fifties * 50;
    const quiet = { heard: nothingAboutTheTable, field: '' };
    const failuresOn = screen => moments.filter(moment => moment === screen);
    let unavailable = false;
    const failBeforeGameOver = () => {
      r.frame(() => r.game.tableFailed(), times, quiet);
      unavailable = true;
    };
    r.frame(() => {}, times, quiet);   // the title
    failuresOn('title').forEach(failBeforeGameOver);
    r.frame(() => r.press('Enter'), times, quiet);
    failuresOn('play').forEach(failBeforeGameOver);
    seen.add(unavailable ? 'unavailable before game over' : 'unknown at game over');
    r.frame(() => { arrange.deposit(r.game, deposit); arrange.formationOnPin(r.game); r.game.update(STEP, keyboard); }, times,
      { heard: gameOverSays(deposit, unavailable), field: '' });
    expect(r.screen(), 'arranging: the game should be over').toBe('over');
    failuresOn('over').forEach(() => {
      seen.add(unavailable ? 'failed again on the game-over screen' : 'unavailable on the game-over screen');
      r.frame(() => r.game.tableFailed(), times, { heard: unavailable ? unchanged() : appendedWith(TABLE_UNAVAILABLE), field: '' });
      unavailable = true;
    });
    r.frame(() => r.game.update(SETTLE_S, keyboard), times, { heard: unchanged(), field: '' });
    r.frame(() => r.press('Enter'), times, quiet);
    expect(r.screen(), 'the game plays on').toBe('play');
  }));
  expect(TABLE_WITNESSES.filter(witness => !seen.has(witness)), 'moments no run reached').toEqual([]);
});
