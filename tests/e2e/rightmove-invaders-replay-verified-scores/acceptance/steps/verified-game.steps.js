import { createBdd } from 'playwright-bdd';
import { test } from './fixtures.js';
import './parameter-types.js';

// The player's side, with sessions: the real page, the real keyboard, the real table behind scripts/serve.mjs. Every body
// is one call to the VerifiedGame driver (steps/verified-game.js). The high-score table's own browser steps
// (rightmove-invaders-leaderboard/acceptance/steps/high-score-table.steps.js) are reused where they say the same thing:
// the rows held, opening the game, "my deposit makes the high-score table", signing, "the game tells me", the marked row.
const { Given, When, Then } = createBdd(test);

// ---- arranging ----
Given('the table will answer my next game\'s session request {sessionAnswer}', ({ game }, how) => game.answerNextSession(how));
Given('the table {sessionTrouble} when my next game asks for its session', ({ game }, how) => game.answerNextSession(how));
Given('another house-hunter has signed a game of their own as {initials} on their own computer', ({ game }, initials) => game.anotherHouseHunterSignsAGame(initials));
Given('a forger changes the deposit my game sends to {amount}', ({ game }, amount) => game.forgeDepositSent(amount));
Given('my computer\'s clock is {clockError}', ({ game }, offMs) => game.clockIsOff(offMs));

// ---- acting ----
When('I start a game and fire my first shot straight away', ({ game }) => game.startAndFire());
When('a forger runs the console line that set the deposit on 2026-10-26', ({ game }) => game.runConsoleLine());
When('I play a game in real time to a deposit of {amount}, and sign it as {initials}', ({ game }, deposit, initials) => game.playInRealTimeAndSign(deposit, initials));

// ---- observing ----
Then('my first shot scores £50 within a second', ({ game }) => game.expectFirstShotScored());
Then('the console loaded the game\'s code, but found no game in play in it', ({ game }) => game.expectConsoleFoundNoGame());
Then('my signing carried the session the table gave this game', ({ game }) => game.expectSigningCarriedThisGamesSession());
Then('the game asked the table\'s server once for that game, for its session', ({ game }) => game.expectOneRequestForTheGame());
Then('the game never sent my signing', ({ game }) => game.expectSigningNeverSent());
Then('the high-score table everyone reads has {initials} with {amount}', ({ game }, initials, score) => game.expectEveryoneReads(initials, score));
Then('the high-score table everyone reads has no row for {initials}', ({ game }, initials) => game.expectEveryoneReadsNo(initials));
Then('the game still shows a deposit of £0', ({ game }) => game.expectDepositShown('£0'));
