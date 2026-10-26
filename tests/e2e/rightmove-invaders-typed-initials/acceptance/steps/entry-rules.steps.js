import { createBdd } from 'playwright-bdd';
import { test } from './fixtures.js';
import './parameter-types.js';

// The typed entry's rules on their own, typed into the way main.js hands them each frame (project in-memory, Tier B).
// Every body is one call to EntryRules (tier-b/entry-rules.js).
const { Given, When, Then } = createBdd(test);

// ---- arranging (the examples) ----
Given('my game has ended with a deposit that makes the table, on the game\'s rules alone', ({ entryRules }) => entryRules.openEntry());
Given('the game ended exactly {duration} ago', ({ entryRules }, ms) => entryRules.gameEndedAgo(ms));
Given('the rules have refused initials on the word filter', ({ entryRules }) => entryRules.refuseBlockedInitials());

// ---- acting ----
When('I press {string} in one go', ({ entryRules }, keys) => entryRules.pressInOneGo(keys));
When('I type any keys at all, as fast or as slowly as I like, once the first 0.6 seconds are over', ({ entryRules }) => entryRules.forAnyTyping());
When('I press any key that isn\'t a letter A to Z, after typing up to three letters', ({ entryRules }) => entryRules.forAnyNonLetter());
When('I type anything and press Enter, over any number of games', ({ entryRules }) => entryRules.forAnySigning());
When('I type, press keys and wait in any order whenever a game ends, over any number of games', ({ entryRules }) => entryRules.forAnyJourney());

// ---- observing ----
Then('my initials are {string}, with {entryNotice}', ({ entryRules }, letters, notice) => entryRules.expectEntry(letters, notice));
Then('only {initials} has left for the high-score table', ({ entryRules }, initials) => entryRules.expectSentOnly(initials));
Then('no game key took effect', ({ entryRules }) => entryRules.expectNoGameKey());
Then('nothing else in the game changed', ({ entryRules }) => entryRules.expectNothingElseChanged());
Then('my initials are always the first three letters typed, in capitals, less those taken back with Backspace', ({ entryRules }) => entryRules.checkTyping());
Then('my initials never change, and nothing is announced or sent', ({ entryRules }) => entryRules.checkNonLetters());
Then('only three letters A to Z, never on the word filter, ever leave for the high-score table', ({ entryRules }) => entryRules.checkOnlyValidInitialsLeave());
Then('my initials, my signing, the skip and the game keys always follow the rules', ({ entryRules }) => entryRules.checkJourney());
