import { isDeepStrictEqual } from 'node:util';
import fc from 'fast-check';
import { expect } from '@playwright/test';
import { loadFreshGame, arrange } from '../../../../unit/support/fresh-game.js';
import { assertStateDelta, setTo, satisfying } from '../../../../common/state-delta.js';
import { GameEvent, BLOCKED_INITIALS, INITIALS_LENGTH, EntryNotice } from '../steps/domain-types.js';

// Tier B (Mandate 10) for the typed initials: the entry as a state machine, explored with fast-check (layer 2, PBT full,
// Mandate 9). The system is the real rules (src/game/game.js, a fresh copy per run, as in tests/unit); this file plays
// main.js's part: each frame it hands the rules what the keyboard reported, handlePresses(pressed, typed) (DDD-T2), the
// positions as a set of codes and the typed presses in order as plain data, [{ key }] (DDD-T1, DDD-T11): a press here
// carries its code only to build that set, as the browser's keydown does. The keyboard adapter
// (repeats, chords, preventDefault) and the views are out of scope: the browser scenarios and DELIVER's unit tests cover
// them, so no repeat and no chord is ever handed over here, as the adapter never reports one (DDD-T4).
//
// Shared vocabulary with the browser driver (steps/typed-entry-game.js): finishGameWith, typeKeys, pressKey, startNewGame,
// ... InMemoryEntry is this tier's composition root; TypedEntryGame is Tier A's.
//
// The oracle is Model below: DESIGN's "Rules operations (the entry only)" and the entry rows of the signing-status
// lifecycle, written as code. After every command the rules' observable state must change exactly as the model's did
// (state delta, fail-closed), over this universe, read ONLY from the read-only snapshot() that game.js exports and from
// the events the rules publish (never from g's fields):
//   entry             { letters: '' to 'ABC' (capitals, in the order typed), notice: null | 'too-few' | 'refused' } or null
//                     snapshot().entry = { letters, notice: null | { kind, n } } (settled in DISTILL, DESIGN open question 5)
//   skipped           snapshot().skipped: this game over was skipped with Esc (slice 02); a new game clears it
//   screen            snapshot().screen: title | play | over
//   signing           the current signing's { initials, status } (snapshot().signing), or null
//   sent              every initialsEntered event's initials, in order: what main.js would send to the table
//   toggles           every soundToggled and musicToggled event, { type, on }, in order
//   gamesStarted      gameStarted events so far
//   noticesAnnounced  a proxy for the notices the status mirror would announce: the distinct notice numbers (n) seen
//                     after a frame, across games (DDD-T6: numbered globally, so each notice is announced once, even when
//                     its words repeat; DDD-T10: one write per frame, so a notice cleared later in the same frame is never
//                     heard). It reads the rules, not the mirror: the mirror's own cadence is the browser scenarios' and
//                     status-mirror.spec.js's
// The closed world (DESIGN, Reuse Analysis and open question 10): around every handlePresses call made with the entry
// open, every key of g outside the entry's declared delta (ENTRY_DELTA) is compared before and after (structured clones,
// then isDeepStrictEqual), and the outbox is read through takeEvents(): at most one initialsEntered, nothing else. The
// notice counter is read through snapshot().entry.notice.n. That comparison is the one place this file reads g itself,
// and it only reads.
// The one sanctioned internal write is ARRANGING a game over, only through tests/unit/support/fresh-game.js's checked
// `arrange.deposit` and `arrange.formationOnPin`, as the leaderboard's Tier B does.

const STEP = 1 / 120;
const GUARD_S = 0.6;                        // no key acts on the entry until the game has been over this long (D11)
const PAST_THE_GUARD_S = 0.7;
const keyboard = { isDown: () => false };
const SEED = Number(process.env.FC_SEED ?? 20261023);
const RUNS = 100;
const UNIVERSE = ['entry', 'skipped', 'screen', 'signing', 'sent', 'toggles', 'gamesStarted', 'noticesAnnounced'];
// Exactly the keys of g a frame of the entry writes (DESIGN, Reuse Analysis): the entry, the skip flag and, through
// sign(), the signing and signedThisGame. `settled` is not among them: the entry never settles a signing, so the deep
// compare covers it. The outbox, onTheirWay and the notice counter are module-level in game.js, outside g (the counter is
// read as snapshot().entry.notice.n); the events are checked as `sent` and `toggles`. The skip flag's name is DISTILL's
// guess at DESIGN's suggestion: DELIVER renames it here with the field.
const ENTRY_DELTA = ['initials', 'skipped', 'signing', 'signedThisGame'];
const outsideTheEntry = g => Object.fromEntries(Object.entries(g).filter(([key]) => !ENTRY_DELTA.includes(key)));
const isLetter = key => /^[A-Za-z]$/.test(key);   // exactly one ASCII letter (DDD-T3)
const isAllowed = initials => !BLOCKED_INITIALS.includes(initials);

// A key press as the keyboard reports it: `key`, what it types (or its name), and `code`, its position.
const press = (key, code) => Object.freeze({ key, code });
const NAMED = Object.freeze({ Enter: press('Enter', 'Enter'), Esc: press('Escape', 'Escape'), Backspace: press('Backspace', 'Backspace'), Up: press('ArrowUp', 'ArrowUp') });
const letterPress = letter => press(letter, `Key${letter.toUpperCase()}`);
// "a l x Enter m" -> the presses, in order.
const pressesOf = text => text.split(' ').filter(Boolean).map(token => NAMED[token] ?? letterPress(token));

// ---- the in-memory composition root ----
export class InMemoryEntry {
  // The page has loaded an empty table, and a game is in play.
  static async fresh() {
    const rules = new InMemoryEntry(await loadFreshGame());
    rules.game.tableAnswered({ scores: [], listedAt: 1 });
    rules.frame([NAMED.Enter]);
    return rules;
  }

  constructor(game) {
    this.game = game;
    this.sent = [];
    this.toggles = [];
    this.gamesStarted = 0;
    this.notices = new Set();
    this.entryFrames = 0;     // frames that started with the entry open
    this.breaches = [];       // keys of g outside ENTRY_DELTA that such a frame changed
  }

  get view() { return this.game.snapshot(); }

  // -> the events taken.
  pump() {
    const events = this.game.takeEvents();
    for (const event of events) {
      if (event.type === GameEvent.GAME_STARTED) this.gamesStarted++;
      if (event.type === GameEvent.INITIALS_ENTERED) this.sent.push(event.initials);
      if (event.type === GameEvent.SOUND_TOGGLED || event.type === GameEvent.MUSIC_TOGGLED) this.toggles.push({ type: event.type, on: event.on });
    }
    return events;
  }

  // One frame, as main.js hands it over: the positions pressed (a set of codes) and the typed presses, in order, as { key }.
  // With the entry open, the closed world wraps the handlePresses call alone (never update): every key of g outside
  // ENTRY_DELTA is the same after it, and the outbox, read through takeEvents(), holds at most one initialsEntered and
  // no other event (the entry step itself publishes none; sign() publishes the one).
  frame(presses) {
    const entryOpen = this.view.entry !== null;
    const before = entryOpen ? structuredClone(outsideTheEntry(this.game.g)) : null;
    this.game.handlePresses(new Set(presses.map(({ code }) => code)), presses.map(({ key }) => ({ key })));
    const after = entryOpen ? structuredClone(outsideTheEntry(this.game.g)) : null;
    const events = this.pump();
    if (entryOpen) {
      this.entryFrames++;
      const keys = JSON.stringify(presses.map(({ key }) => key));
      const changed = Object.keys({ ...before, ...after }).filter(key => !isDeepStrictEqual(before[key], after[key]));
      this.breaches.push(...changed.map(key => `g.${key} changed, after ${keys}`));
      const signings = events.filter(event => event.type === GameEvent.INITIALS_ENTERED).length;
      const others = events.filter(event => event.type !== GameEvent.INITIALS_ENTERED).map(event => event.type);
      if (signings > 1) this.breaches.push(`${signings} initialsEntered events, after ${keys}`);
      if (others.length) this.breaches.push(`events ${JSON.stringify(others)} published, after ${keys}`);
    }
    const n = this.view.entry?.notice?.n;
    if (n !== undefined && n !== null) this.notices.add(n);
  }

  expectClosedWorld() { expect(this.breaches, 'keys of the game outside the entry that a frame of the entry changed').toEqual([]); }

  wait(seconds) {
    this.game.update(seconds, keyboard);
    this.pump();
  }

  finishGameWith(deposit) {
    expect(this.view.screen, 'arranging: a game must be in play').toBe('play');
    arrange.deposit(this.game, deposit);      // sanctioned arranging (see the header)
    arrange.formationOnPin(this.game);
    this.game.update(STEP, keyboard);
    this.pump();
    expect(this.view.screen, 'arranging: the game did not end').toBe('over');
  }

  typeKeys(text) { for (const letter of text) this.frame([letterPress(letter)]); }

  pressKey(name) { this.frame([NAMED[name]]); }

  startNewGame() {
    if (this.view.screen === 'over') this.wait(PAST_THE_GUARD_S);
    this.pressKey('Enter');
  }

  observe() {
    const { entry, skipped, screen, signing } = this.view;
    return {
      entry: entry ? { letters: entry.letters, notice: entry.notice?.kind ?? null } : null,
      skipped,
      screen,
      signing: signing ? { initials: signing.initials, status: signing.status } : null,
      sent: [...this.sent],
      toggles: this.toggles.map(toggle => ({ ...toggle })),
      gamesStarted: this.gamesStarted,
      noticesAnnounced: this.notices.size,
    };
  }
}

// ---- the oracle: DESIGN's rules operations for the entry ----
class Model {
  screen = 'play';
  entry = null;
  overT = 0;
  skipped = false;
  signing = null;
  sent = [];
  toggles = [];
  gamesStarted = 1;
  noticesAnnounced = 0;
  settings = { sound: true, music: true };
  seen = new Set();     // witnesses: which states this run reached

  view() {
    return {
      entry: this.entry ? { ...this.entry } : null, skipped: this.skipped, screen: this.screen,
      signing: this.signing ? { ...this.signing } : null, sent: [...this.sent],
      toggles: this.toggles.map(toggle => ({ ...toggle })), gamesStarted: this.gamesStarted, noticesAnnounced: this.noticesAnnounced,
    };
  }

  // The table is empty and never answers here, so any deposit above 0 makes it.
  finishGameWith(deposit) {
    this.screen = 'over';
    this.overT = 0;
    this.entry = deposit > 0 ? { letters: '', notice: EntryNotice.NONE } : null;
  }

  // The model adds the same seconds in the same order as update(dt) does, so its overT is the rules' to the last bit, and
  // a wait that lands on exactly 0.6 s tests the boundary itself.
  wait(seconds) { if (this.screen === 'over') this.overT += seconds; }

  startGame() {
    if (this.skipped) this.seen.add('new game after a skip');
    Object.assign(this, { screen: 'play', entry: null, skipped: false, gamesStarted: this.gamesStarted + 1 });
    this.seen.add('new game');
  }

  toggle(setting, type) {
    this.settings[setting] = !this.settings[setting];
    this.toggles.push({ type, on: this.settings[setting] });
    if (this.screen === 'over') this.seen.add('a game key after the entry closed');
  }

  // A frame that starts with the entry open belongs to the entry: its typed presses, in order; the positions are
  // ignored (no M or N toggle, no restart). Any other frame reads the positions only.
  frame(presses) {
    if (this.entry) return this.entryFrame(presses);
    const codes = new Set(presses.map(({ code }) => code));
    if (this.screen === 'over' && this.overT > GUARD_S && codes.has('Enter')) this.startGame();
    if (codes.has('KeyM')) this.toggle('sound', GameEvent.SOUND_TOGGLED);
    if (codes.has('KeyN')) this.toggle('music', GameEvent.MUSIC_TOGGLED);
  }

  entryFrame(presses) {
    if (this.overT <= GUARD_S) { this.seen.add('dropped by the guard'); return; }
    let noticeShown = false;
    for (const { key } of presses) {
      if (!this.entry) { this.seen.add('dropped after the entry closed'); break; }
      const { letters } = this.entry;
      if (isLetter(key)) {
        if (letters.length < INITIALS_LENGTH) { this.entry = { letters: letters + key.toUpperCase(), notice: EntryNotice.NONE }; noticeShown = false; } else this.seen.add('a fourth letter ignored');
      } else if (key === 'Backspace') {
        if (letters.length) { this.entry = { letters: letters.slice(0, -1), notice: EntryNotice.NONE }; noticeShown = false; } else this.seen.add('Backspace on an empty entry');
      } else if (key === 'Enter') {
        noticeShown = this.enter(letters) || noticeShown;
      } else if (key === 'Escape') {
        this.entry = null;
        this.skipped = true;
        this.seen.add('skipped');
      } else this.seen.add('a key the entry ignores');
    }
    if (noticeShown && this.entry?.notice) this.noticesAnnounced++;
  }

  // -> true when Enter shows a notice (a new one, even when the same words are already on show).
  enter(letters) {
    if (this.entry.notice && (letters.length < INITIALS_LENGTH || !isAllowed(letters))) this.seen.add('a notice shown again');
    if (letters.length < INITIALS_LENGTH) { this.entry = { letters, notice: EntryNotice.TOO_FEW }; this.seen.add('too few'); return true; }
    if (!isAllowed(letters)) { this.entry = { letters: '', notice: EntryNotice.REFUSED }; this.seen.add('refused'); return true; }
    this.entry = null;
    this.sent.push(letters);
    this.signing = { initials: letters, status: 'pending' };
    this.seen.add('signed');
    return false;
  }
}

// Runs one step on both sides, then checks that the rules' state changed exactly as the model's did, and that no frame of
// the entry touched the rest of the game.
function stepBoth(model, rules, act) {
  const before = rules.observe();
  act();
  const expected = Object.fromEntries(UNIVERSE.filter(slot => !isDeepStrictEqual(before[slot], model.view()[slot])).map(slot => [slot, setTo(model.view()[slot])]));
  assertStateDelta(before, rules.observe(), { universe: UNIVERSE, expected });
  rules.expectClosedWorld();
}

const command = (description, check, run) => ({ check, run, toString: () => description });

// ---- what can be pressed: every key a browser can report, not only the ones a test thinks of ----
// A letter at its UK position, or where AZERTY or QWERTZ puts it (the rules read the letter, never the position).
const MOVED = Object.freeze({ a: 'KeyQ', q: 'KeyA', z: 'KeyW', w: 'KeyZ', m: 'Semicolon', y: 'KeyZ' });
const asciiLetter = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ');
const aLetter = fc.tuple(asciiLetter, fc.boolean()).map(([key, moved]) => press(key, (moved && MOVED[key.toLowerCase()]) || `Key${key.toUpperCase()}`));
// The traps (DDD-T3): characters that upper-case or normalise to a letter, key names, dead keys and IME, digits, punctuation.
const TRAPS = ['ß', 'ı', 'ſ', 'K', 'é', 'é', 'å', 'ü', 'Ö', 'Dead', 'Process', 'Unidentified', ' ', '7', '0', '/', "'", '.', '-', ',',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Shift', 'CapsLock', 'Alt', 'Meta', 'Control', 'F5', 'Delete', 'Home', 'AB'];
const MEANINGFUL = ['Backspace', 'Enter', 'Escape'];
// The traps that become, or look like, a plain letter under toUpperCase or normalisation (DDD-T3).
const LOOKS_LIKE_A_LETTER = ['ß', 'ı', 'ſ', '\u212A', 'é', 'e\u0301', 'å', 'ü', 'Ö'];
const anyCode = fc.constantFrom('Digit2', 'Digit7', 'Minus', 'BracketLeft', 'Semicolon', 'Slash', 'Quote', 'Period', 'Comma', 'Space', 'ArrowUp', 'KeyM', 'KeyN', 'KeyP', 'KeyA', 'IntlBackslash');
const notALetterKey = fc.oneof(fc.constantFrom(...TRAPS), fc.string({ unit: 'grapheme', minLength: 1, maxLength: 3 }).filter(key => !isLetter(key) && !MEANINGFUL.includes(key)));
const notALetter = fc.tuple(notALetterKey, anyCode).map(([key, code]) => press(key, code));
const backspace = fc.constant(NAMED.Backspace);
const enterOrEsc = fc.constantFrom(NAMED.Enter, NAMED.Esc);
const typing = fc.oneof({ arbitrary: aLetter, weight: 5 }, { arbitrary: backspace, weight: 2 }, { arbitrary: notALetter, weight: 2 });
const anyPress = fc.oneof({ arbitrary: aLetter, weight: 5 }, { arbitrary: backspace, weight: 1 }, { arbitrary: notALetter, weight: 2 }, { arbitrary: enterOrEsc, weight: 2 });
const frameOf = presses => fc.array(presses, { minLength: 1, maxLength: 5 });
// Three letters and Enter, a frame each: allowed initials, or initials on the word filter.
const wordInitials = fc.oneof(fc.stringMatching(/^[a-z]{3}$/), fc.constantFrom(...BLOCKED_INITIALS.map(initials => initials.toLowerCase())));

// The fold the first property states: the first three letters typed, in capitals, less those taken back with Backspace.
const foldTyping = frames => frames.flat().reduce((letters, { key }) => {
  if (isLetter(key)) return letters.length < INITIALS_LENGTH ? letters + key.toUpperCase() : letters;
  if (key === 'Backspace') return letters.slice(0, -1);
  return letters;
}, '');

// ---- the journey's commands ----
const finishGameWith = deposit => command(`finishGameWith(${deposit})`, m => m.screen === 'play', (m, r) => stepBoth(m, r, () => {
  r.finishGameWith(deposit);
  m.finishGameWith(deposit);
}));

const wait = seconds => command(`wait(${seconds})`, m => m.screen === 'over', (m, r) => stepBoth(m, r, () => {
  r.wait(seconds);
  m.wait(seconds);
}));

const aFrame = presses => command(`frame(${JSON.stringify(presses)})`, m => m.screen === 'over', (m, r) => stepBoth(m, r, () => {
  r.frame(presses);
  m.frame(presses);
}));

const typeInitials = letters => command(`typeInitials(${letters})`, m => m.screen === 'over' && m.entry !== null, (m, r) => {
  for (const letter of letters) aFrame([letterPress(letter)]).run(m, r);
  aFrame([NAMED.Enter]).run(m, r);
});

const startNewGame = () => command('startNewGame', m => m.screen === 'over' && m.entry === null, (m, r) => {
  if (m.overT <= GUARD_S) wait(PAST_THE_GUARD_S).run(m, r);
  aFrame([NAMED.Enter]).run(m, r);
});

const COMMANDS = [
  fc.constantFrom(0, 50, 1000).map(finishGameWith), fc.constantFrom(50, 1000).map(finishGameWith),
  fc.constantFrom(0.1, 0.25, 0.6, 1).map(wait),
  frameOf(anyPress).map(aFrame), frameOf(anyPress).map(aFrame), frameOf(typing).map(aFrame),
  wordInitials.map(typeInitials), wordInitials.map(typeInitials),
  fc.constant(aFrame([NAMED.Enter])), fc.constant(aFrame([NAMED.Enter])),   // a lone Enter, so a notice is shown again
  fc.constant(startNewGame()),
];

const WITNESSES = ['dropped by the guard', 'signed', 'refused', 'too few', 'a notice shown again', 'a fourth letter ignored', 'Backspace on an empty entry',
  'skipped', 'dropped after the entry closed', 'a key the entry ignores', 'new game', 'new game after a skip', 'a game key after the entry closed'];

// A fresh game over whose £50 made the table, past the guard: where the first three properties start.
async function openEntryPastTheGuard() {
  const rules = await InMemoryEntry.fresh();
  rules.finishGameWith(50);
  rules.wait(PAST_THE_GUARD_S);
  return rules;
}

const expectTyped = rules => expect(rules.view.entry, 'the typed entry: snapshot().entry = { letters, notice }').toMatchObject({ letters: '', notice: null });

// What one action of the third property may send: nothing for a wait or a new game; for keys, at most one signing, of
// three letters A to Z that aren't on the word filter (DDD-T2: the Enter that signs drops the rest of its frame).
const isValidInitials = initials => /^[A-Z]{3}$/.test(initials) && isAllowed(initials);
const leavesAtMostOneValidSigning = action => satisfying(`after ${action.type}, at most one signing of three allowed letters A to Z`, (before, after) => {
  const added = after.slice(before.length);
  const most = action.type === 'frame' || action.type === 'initials' ? 1 : 0;
  return isDeepStrictEqual(after.slice(0, before.length), before) && added.length <= most && added.every(isValidInitials);
});

// ---- what the step definitions call ----
export class EntryRules {
  async openEntry() {
    this.rules = await InMemoryEntry.fresh();
    this.rules.finishGameWith(50);
    expect(this.rules.view.entry, 'arranging: £50 should make an empty table').not.toBeNull();
  }

  gameEndedAgo(ms) { this.rules.wait(ms / 1000); }

  refuseBlockedInitials() {
    const [blocked] = BLOCKED_INITIALS;
    expect(blocked, 'DATA GAP: the word list is empty (BLOCKED_INITIALS in src/game/high-scores.js)').toBeTruthy();
    this.rules.wait(PAST_THE_GUARD_S);
    this.rules.typeKeys(blocked.toLowerCase());
    this.rules.pressKey('Enter');
    expect(this.rules.observe().entry, `arranging: typed ${blocked} and Enter should be refused, the entry emptied`).toEqual({ letters: '', notice: EntryNotice.REFUSED });
  }

  // ---- examples ----
  pressInOneGo(text) {
    this.before = this.rules.observe();
    this.entryFramesBefore = this.rules.entryFrames;
    this.rules.frame(pressesOf(text));
  }

  expectNothingElseChanged() {
    expect(this.rules.entryFrames, 'the frame did not start with the entry open').toBeGreaterThan(this.entryFramesBefore);
    this.rules.expectClosedWorld();
  }

  expectEntry(letters, notice) {
    assertStateDelta(this.before, this.rules.observe(), {
      universe: ['entry', 'sent', 'skipped', 'screen', 'signing'],
      expected: { entry: setTo({ letters, notice }) },
    });
  }

  expectSentOnly(initials) {
    assertStateDelta(this.before, this.rules.observe(), {
      universe: ['entry', 'sent', 'signing'],
      expected: { entry: setTo(null), sent: setTo([initials]), signing: setTo({ initials, status: 'pending' }) },
    });
  }

  expectNoGameKey() {
    assertStateDelta(this.before, this.rules.observe(), { universe: ['toggles', 'gamesStarted', 'screen', 'skipped'], expected: {} });
  }

  // ---- the properties: the When chooses the generator, the Then states the invariant ----
  forAnyTyping() { this.typing = fc.array(frameOf(typing), { maxLength: 12 }); }

  async checkTyping() {
    let full = 0, takenBack = 0;
    await fc.assert(fc.asyncProperty(this.typing, async frames => {
      const rules = await openEntryPastTheGuard();
      expectTyped(rules);
      const before = rules.observe();
      for (const presses of frames) rules.frame(presses);
      rules.expectClosedWorld();
      const letters = foldTyping(frames);
      if (letters.length === INITIALS_LENGTH) full++;
      if (frames.flat().some(({ key }) => key === 'Backspace')) takenBack++;
      assertStateDelta(before, rules.observe(), { universe: UNIVERSE, expected: { entry: setTo({ letters, notice: EntryNotice.NONE }) } });
    }), { seed: SEED, numRuns: RUNS });
    expect(full, 'no run filled all three letters').toBeGreaterThan(0);
    expect(takenBack, 'no run took a letter back').toBeGreaterThan(0);
  }

  forAnyNonLetter() { this.nonLetters = fc.tuple(fc.stringMatching(/^[a-z]{0,3}$/), frameOf(notALetter)); }

  async checkNonLetters() {
    const witnessed = { afterLetters: 0, aTrapThatLooksLikeALetter: 0 };
    await fc.assert(fc.asyncProperty(this.nonLetters, async ([typed, presses]) => {
      const rules = await openEntryPastTheGuard();
      expectTyped(rules);
      rules.typeKeys(typed);
      const before = rules.observe();
      rules.frame(presses);
      assertStateDelta(before, rules.observe(), { universe: UNIVERSE, expected: {} });
      rules.expectClosedWorld();
      if (typed.length) witnessed.afterLetters++;
      if (presses.some(({ key }) => LOOKS_LIKE_A_LETTER.includes(key))) witnessed.aTrapThatLooksLikeALetter++;
    }), { seed: SEED, numRuns: RUNS });
    expect(Object.entries(witnessed).filter(([, count]) => count === 0).map(([what]) => what), 'what no run tried').toEqual([]);
  }

  forAnySigning() {
    const action = fc.oneof(
      { arbitrary: wordInitials.map(letters => ({ type: 'initials', letters })), weight: 3 },
      { arbitrary: frameOf(anyPress).map(presses => ({ type: 'frame', presses })), weight: 3 },
      // Two sets of initials and two Enters in one go: the Enter that signs drops the rest of its frame (DDD-T2).
      { arbitrary: fc.tuple(wordInitials, wordInitials).map(words => ({ type: 'frame', presses: words.flatMap(word => [...word].map(letterPress).concat(NAMED.Enter)) })), weight: 1 },
      { arbitrary: fc.constantFrom(0.25, 0.6, 1).map(seconds => ({ type: 'wait', seconds })), weight: 1 },
      { arbitrary: fc.constantFrom(0, 50).map(deposit => ({ type: 'game', deposit })), weight: 2 },
    );
    this.signing = fc.array(action, { maxLength: 40 });
  }

  async checkOnlyValidInitialsLeave() {
    let signed = 0;
    await fc.assert(fc.asyncProperty(this.signing, async actions => {
      const rules = await openEntryPastTheGuard();
      expectTyped(rules);
      for (const action of actions) {
        const { screen, entry } = rules.view;
        const before = rules.observe();
        if (action.type === 'wait' && screen === 'over') rules.wait(action.seconds);
        if (action.type === 'frame' && screen === 'over') rules.frame(action.presses);
        if (action.type === 'initials' && entry) { rules.typeKeys(action.letters); rules.pressKey('Enter'); }
        if (action.type === 'game' && screen === 'over' && !entry) rules.startNewGame();
        else if (action.type === 'game' && screen === 'play') { rules.finishGameWith(action.deposit); rules.wait(PAST_THE_GUARD_S); }
        // Per action: at most one signing leaves, only for a keypress action, and only as three allowed letters A to Z.
        assertStateDelta(before, rules.observe(), { universe: ['sent'], expected: { sent: leavesAtMostOneValidSigning(action) } });
      }
      rules.expectClosedWorld();
      signed += rules.sent.length;
      expect(rules.sent.filter(initials => !isValidInitials(initials)), 'initials that left for the table').toEqual([]);
    }), { seed: SEED, numRuns: RUNS });
    expect(signed, 'no run ever signed, so the property proves nothing').toBeGreaterThan(0);
  }

  // 'large' journeys: a skip, then a new game, then a signing in it, needs a dozen commands or more.
  forAnyJourney() { this.journeys = fc.commands(COMMANDS, { maxCommands: 60, size: 'large' }); }

  async checkJourney() {
    expect(BLOCKED_INITIALS.length, 'DATA GAP: the word list is empty (BLOCKED_INITIALS in src/game/high-scores.js)').toBeGreaterThan(0);
    const seen = new Set();
    await fc.assert(fc.asyncProperty(this.journeys, async commands => {
      const rules = await InMemoryEntry.fresh();
      const model = new Model();
      expect(rules.observe(), 'a fresh game in play: no entry, no signing, nothing sent').toEqual(model.view());
      fc.modelRun(() => ({ model, real: rules }), commands);
      for (const witness of model.seen) seen.add(witness);
    }), { seed: SEED, numRuns: RUNS });
    expect(WITNESSES.filter(witness => !seen.has(witness)), 'states no run reached').toEqual([]);
  }
}

