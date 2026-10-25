import { createBdd } from 'playwright-bdd';
import { test } from './fixtures.js';
import './parameter-types.js';
import { SigningOutcome } from './domain-types.js';

// The game's rules on their own, with the table's answers handed over in any order (project in-memory, Tier B).
// Every body is one call to SigningRules (tier-b/signing-rules.js).
const { Given, When, Then } = createBdd(test);

// ---- arranging ----
Given('the game\'s rules are running on their own', ({ rules }) => rules.start());
Given('the high-score table has not answered yet', ({ rules }) => rules.expectTableUnknown());
Given('{initials}\'s signing is on its way', ({ rules }, initials) => rules.signingOnItsWay(initials));
Given('a newer signing by {initials} has been confirmed at #{int}', ({ rules }, initials, rank) => rules.newerSigningConfirmed(initials, rank));

// ---- acting ----
When('a game ends with a deposit of {amount}', ({ rules }, deposit) => rules.gameEndsWith(deposit));
When('the table answers {initials}\'s signing at #{int}', ({ rules }, initials, rank) => rules.answer(initials, rank));
When('the player plays any sequence of games, signings and table answers, in any order', ({ rules }) => rules.forAnyJourney());

// ---- observing ----
Then('no initials are asked for', ({ rules }) => rules.expectNoEntry());
Then('the game-over screen shows no table', ({ rules }) => rules.expectNoTableAtGameOver());
Then('{initials}\'s signing is announced once, as confirmed at #{int}', ({ rules }, initials, rank) => rules.expectSettledOnce(initials, SigningOutcome.CONFIRMED, rank));
Then('{initials}\'s signing is still the current one, confirmed at #{int} and marked as mine', ({ rules }, initials, rank) => rules.expectCurrentConfirmed(initials, rank));
Then('the table, the signing and what is announced always follow the rules', ({ rules }) => rules.checkFollowsTheRules());
