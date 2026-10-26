import { defineParameterType } from 'playwright-bdd';
import { KeyboardLayout, NamedKey, Modifier, HudState, EntryNotice, Leaving, GameOverWithoutEntry, keyNamed } from './domain-types.js';

// Business phrases in the typed initials' .feature files -> typed domain values. Parameter types are global to the whole
// suite, so their names differ from the sound feature's (key, onOff, ...) and the leaderboard's (amount, initials,
// duration, pressSpacing, ... which this feature reuses).
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const oneOf = phrases => new RegExp(Object.keys(phrases).sort((a, b) => b.length - a.length).map(escape).join('|'));
const phraseType = (name, phrases) => defineParameterType({ name, regexp: oneOf(phrases), transformer: s => phrases[s] });

phraseType('keyboardLayout', Object.fromEntries(Object.values(KeyboardLayout).map(layout => [layout.name, layout])));
phraseType('heldModifier', Object.fromEntries(Object.values(Modifier).map(modifier => [modifier.name, modifier])));
phraseType('hudState', { On: HudState.ON, Off: HudState.OFF });
phraseType('entryNotice', { 'no notice': EntryNotice.NONE, 'the too-few hint': EntryNotice.TOO_FEW, 'the refusal': EntryNotice.REFUSED });
// A key by its name ("Up", "full stop", "slash", "Backspace") or, for a letter or a digit, by itself ("D", "7"):
// -> { name, key }, key being what Playwright's keyboard presses (and the browser reports as the key's position, `code`).
const KEY_NAME = `(?:${oneOf(NamedKey).source}|[A-Za-z0-9])`;
const keyOf = name => Object.freeze({ name, key: keyNamed(name) });
defineParameterType({ name: 'keyName', regexp: new RegExp(KEY_NAME), transformer: keyOf });
// Several keys, "Up, Down, 7 and slash" -> [{ name, key }, ...], in the order written.
defineParameterType({
  name: 'keyNames',
  regexp: new RegExp(`${KEY_NAME}(?:, ${KEY_NAME})* and ${KEY_NAME}`),
  transformer: text => Object.freeze(text.split(/, | and /).map(keyOf)),
});
phraseType('leaving', Object.fromEntries(Object.values(Leaving).map(leaving => [leaving, leaving])));
phraseType('gameOverWithoutEntry', Object.fromEntries(Object.values(GameOverWithoutEntry).map(situation => [situation, situation])));
