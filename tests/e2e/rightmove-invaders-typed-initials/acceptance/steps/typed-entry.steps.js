import { createBdd } from 'playwright-bdd';
import { test } from './fixtures.js';
import './parameter-types.js';

// The player's side of the typed initials: the real page, the real keyboard (and synthetic key events for other layouts),
// the real table behind scripts/serve.mjs. Every body is one call to the TypedEntryGame driver (steps/typed-entry-game.js).
// The high-score table's own steps (rightmove-invaders-leaderboard/acceptance/steps/*.steps.js) are reused where they say
// the same thing: the table's rows, opening the game, starting a game, "my deposit makes the high-score table",
// "I press Enter", "the game tells me", "the initials field shows", the signing statuses and the marked row.
const { Given, When, Then } = createBdd(test);

// ---- arranging ----
Given('my keyboard is {keyboardLayout}', ({ game }, layout) => game.useKeyboardLayout(layout));
Given('the sound and the music are on', ({ game }) => game.expectSoundAndMusicOn());
Given('I have typed {string}', ({ game }, text) => game.typeKeys(text));
Given('I have typed initials on the word filter', ({ game }) => game.typeBlocked());
Given('I have pressed Enter', ({ game }) => game.pressEnter());
Given('I have pressed the {keyName} key', ({ game }, key) => game.pressKey(key));
Given('I have pressed the keys printed {string}', ({ game }, printed) => game.pressPrinted(printed));
Given('I have signed by typing {string} and pressing Enter', ({ game }, text) => game.signByTyping(text));
Given('my initials on the word filter have just been refused', ({ game }) => game.refuseBlockedInitials());
Given('I have skipped signing', ({ game }) => game.skipSigning());
Given('the game ended {duration} ago with a deposit of {amount} that makes the high-score table', ({ game }, ms, deposit) => game.gameEndedAgo(ms, deposit));
Given('I am holding the {keyName} key down as the game ends with a deposit of {amount} that makes the high-score table', ({ game }, key, deposit) => game.holdingKeyAsTheGameEnds(key, deposit));
Given('I pressed {string} just as I {leaving}', ({ game }, letter, leaving) => game.pressAsTheGameIsLeft(letter, leaving));
Given('I have come back to the game', ({ game }) => game.comeBack());
Given('I have held the {keyName} key down for a second', ({ game }, key) => game.holdKeyForASecond(key));
Given('I am on the game-over screen {gameOverWithoutEntry}', ({ game }, situation) => game.gameOverWithoutEntry(situation));

// ---- acting ----
When('I type {string}', ({ game }, text) => game.typeKeys(text));
When('I type {string} {pressSpacing}', ({ game }, text, spacing) => game.typeKeys(text, spacing));
When('I type {string} and press Enter, all within one frame', ({ game }, text) => game.typeThenEnterWithinOneFrame(text));
When('I type {string} with {heldModifier} held', ({ game }, letter, modifier) => game.typeWithModifier(modifier, letter));
When('I type {string} with Shift held, {string} with Caps Lock on and a plain {string}', ({ game }, shifted, capsLocked, plain) => game.typeCapitals(shifted, capsLocked, plain));
When('I press Backspace', ({ game }) => game.pressBackspace());
When('I press Esc', ({ game }) => game.pressEsc());
When('I press the {keyName} key', ({ game }, key) => game.pressKey(key));
When('I press {keyNames}, one after another', ({ game }, keys) => game.pressKeysInTurn(keys));
When('the held key is still repeating {duration} after the game ended', ({ game }, ms) => game.keyStillRepeatingAfterGameOver(ms));
When('I press the key that types {string}', ({ game }, character) => game.pressKeyTyping(character));

// ---- observing ----
Then('the initials field still shows {string}', ({ game }, text) => game.expectInitialsField(text));
Then('at once the initials field shows {string}', ({ game }, text) => game.expectInitialsFieldAtOnce(text));
Then('after each of them the initials field still shows {string}', ({ game }, text) => game.expectFieldAfterEachKey(text));
Then('nothing about the initials is announced', ({ game }) => game.expectNothingAboutTheInitialsSaid());
Then('nothing is sent to the high-score table', ({ game }) => game.expectNothingSent());
Then('the letters I typed were announced {int} time(s)', ({ game }, count) => game.expectLettersAnnouncedTimes(count));
Then('the game has told me {string} twice', ({ game }, text) => game.expectToldTimes(text, 2));
Then('the game doesn\'t repeat the refusal', ({ game }) => game.expectRefusalNotRepeated());
Then('the game makes no sound for it', ({ game }) => game.expectNoSound());
Then('my best deposit of {string} is kept for my next visit', ({ game }, amount) => game.expectBestKeptForNextVisit(amount));
Then('the HUD shows Sound {hudState} and Music {hudState}', ({ game }, sound, music) => game.expectHud(sound, music));
Then('the HUD shows Sound {hudState}', ({ game }, sound) => game.expectSound(sound));
// What the game decided about each key's browser default, read as defaultPrevented on the keydown once the game's own
// listener has run (DDD-T8): "keeps from the browser" is prevented, "leaves to the browser" is not. The browser's own
// features (Firefox's quick find on / or ', Backspace leaving the page, a focused link opened with Enter) never run for
// synthetic or headless key presses, so they are DoD 5's manual check.
Then('the game keeps the {keyName} key from the browser', ({ game }, key) => game.expectKeptFromBrowser(key));
Then('the game keeps the {keyNames} keys from the browser', ({ game }, keys) => game.expectEachKeptFromBrowser(keys));
Then('the game leaves Enter to the browser', ({ game }) => game.expectEnterLeftToBrowser());
Then('the game leaves the shortcut to the browser', ({ game }) => game.expectShortcutLeftToBrowser());
Then('nothing is announced as skipped', ({ game }) => game.expectNotSkipped());
