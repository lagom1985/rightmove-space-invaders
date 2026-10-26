// The typed initials' test vocabulary: domain nouns only, each one used by a driver (Mandate 12). The initials rules come
// from the game's own shared module (src/game/high-scores.js, unchanged by this feature, D9) and the event names from
// src/game/events.js. The high-score table's own vocabulary (signing statuses, press spacing, ...) is the leaderboard's,
// re-exported where it means the same.
// The player-facing wording lives in the .feature files, which are the scenario SSOT ("Wave: DISTILL / [REF] Messages" in
// the feature delta). This file holds only the phrases a driver itself waits for or recognises.
export { BLOCKED_INITIALS, INITIALS_LENGTH } from '../../../../../src/game/high-scores.js';
export { GameEvent } from '../../../../../src/game/events.js';
export { PressSpacing } from '../../../rightmove-invaders-leaderboard/acceptance/steps/domain-types.js';

// What the status mirror says, where a driver has to recognise it.
export const Message = Object.freeze({
  GAME_OVER: 'Game over',
  GAME_STARTED: 'Game started',
  LAST_HOME_LOST: 'No homes left',          // said 1.4 s (the respawn time) before an "Offer rejected" game over
  SKIPPED: 'Signing skipped',
  REFUSED: 'Those initials aren\'t allowed',
});

// Any live-region text about the typed initials: the field ("No letters yet, letter 1 of 3", "A, letter 2 of 3",
// "A L, letter 3 of 3", "A L X, press Enter to sign"), the refusal and the too-few hint.
export const ABOUT_THE_INITIALS = /No letters yet, letter 1 of 3|\b[A-Z](?: [A-Z]){0,2}, (?:letter [2-3] of 3|press Enter to sign)|Those initials aren't allowed|Type 3 letters to sign/;
// Just the field, for counting how often the letters were announced.
export const INITIALS_FIELD = /No letters yet, letter 1 of 3|\b[A-Z](?: [A-Z]){0,2}, (?:letter [2-3] of 3|press Enter to sign)/;

// A key on the keyboard, by what is printed on it, as the browser reports it: `key` is the character it types (or its
// name), `code` its position on the keyboard. Playwright's own key presses are US-layout, so a layout where they differ
// is stood in for by a synthetic keydown and keyup on the window (DDD-T11; the DISTILL probe checked all three engines).
const press = (key, code) => Object.freeze({ key, code });
const letterKey = printed => press(printed.toLowerCase(), `Key${printed.toUpperCase()}`);

// Only the keys that differ from UK QWERTY are listed; every other letter is where it is on UK QWERTY.
export const KeyboardLayout = Object.freeze({
  UK_QWERTY: Object.freeze({ name: 'UK QWERTY', keys: Object.freeze({}) }),
  FRENCH_AZERTY: Object.freeze({
    name: 'French AZERTY',
    keys: Object.freeze({ A: press('a', 'KeyQ'), Q: press('q', 'KeyA'), Z: press('z', 'KeyW'), W: press('w', 'KeyZ'), M: press('m', 'Semicolon'), É: press('é', 'Digit2') }),
  }),
  SWEDISH: Object.freeze({ name: 'Swedish', keys: Object.freeze({ Å: press('å', 'BracketLeft'), Ä: press('ä', 'Quote'), Ö: press('ö', 'Semicolon') }) }),
  GERMAN_QWERTZ: Object.freeze({
    name: 'German QWERTZ',
    keys: Object.freeze({ Z: press('z', 'KeyY'), Y: press('y', 'KeyZ'), Ü: press('ü', 'BracketLeft'), Ö: press('ö', 'Semicolon'), Ä: press('ä', 'Quote'), ß: press('ß', 'Minus') }),
  }),
});
// printedKey and keyNamed are pure lookups over the tables above (accepted here, as the leaderboard's Message.initialsField
// is: they derive a domain value, they hold no test logic). The parameter types use keyNamed; the driver, printedKey.
export const printedKey = (layout, printed) => layout.keys[printed] ?? letterKey(printed);
// The key of this layout that types `character` (é, ü, ß, å): the character itself, as the key sends it.
export const keyTyping = (layout, character) => Object.values(layout.keys).find(({ key }) => key === character);

// Keys by the name a player gives them, as Playwright's keyboard presses them. A single letter or digit is its own key.
export const NamedKey = Object.freeze({
  Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight', Space: 'Space', 'full stop': 'Period',
  hyphen: 'Minus', slash: 'Slash', apostrophe: 'Quote', Backspace: 'Backspace', Tab: 'Tab', Enter: 'Enter', Esc: 'Escape',
});
export const keyNamed = name => NamedKey[name] ?? (/^[A-Za-z]$/.test(name) ? `Key${name.toUpperCase()}` : `Digit${name}`);

// A letter typed with a modifier held: Ctrl and Cmd are shortcuts (Playwright sends them as a real chord). Option is the
// Mac's character key, whose letters aren't A to Z (Option+A types å on a UK Mac); Alt on Windows reports the plain
// letter with altKey, for the program's menu accelerators (DDD-T4). Both are stood in for by a synthetic keydown.
export const Modifier = Object.freeze({
  CTRL: Object.freeze({ name: 'Ctrl', chord: 'Control' }),
  CMD: Object.freeze({ name: 'Cmd', chord: 'Meta' }),
  OPTION: Object.freeze({ name: 'Option', typesOn: Object.freeze({ a: 'å', s: 'ß', u: '¨' }) }),
  ALT: Object.freeze({ name: 'Alt', typesOn: Object.freeze({ a: 'a', s: 's', u: 'u' }) }),
});

// The game-over screen with no entry open (D19): a deposit that doesn't make a full table, after a signing, after a skip.
export const GameOverWithoutEntry = Object.freeze({ NOT_ASKED: "after a deposit that doesn't make a full table", SIGNED: 'after signing', SKIPPED: 'after skipping' });

// Ways of leaving the game mid-entry (D20, DDD-T1): the window loses focus, or the tab is hidden.
export const Leaving = Object.freeze({ SWITCH_WINDOW: 'switched to another window', HIDE_TAB: "hid the game's tab" });

// What the HUD shows for the sound and the music.
export const HudState = Object.freeze({ ON: 'On', OFF: 'Off' });

// The notice an open entry shows (DDD-T6), as the rules' read model names it: snapshot().entry.notice.kind.
export const EntryNotice = Object.freeze({ NONE: null, TOO_FEW: 'too-few', REFUSED: 'refused' });
