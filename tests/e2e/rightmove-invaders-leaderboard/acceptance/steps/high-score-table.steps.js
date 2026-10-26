import { createBdd } from 'playwright-bdd';
import { test } from './fixtures.js';
import './parameter-types.js';

// The player's side of the shared high-score table: the real page, the real keyboard, the real table behind
// scripts/serve.mjs. Every body is one call to the LeaderboardGame driver (steps/leaderboard-game.js).
// The walking skeleton's own steps (leaderboard.steps.js) are reused where they say the same thing.
const { Given, When, Then } = createBdd(test);

// ---- arranging ----
Given('the high-score table holds {int} signatures of {amount}', ({ game }, count, score) => game.seedSignatures(count, score));
Given('another house-hunter has since signed with {amount}', ({ game }, score) => game.anotherHouseHunterSigns(score));
Given('I have opened the game', ({ game }) => game.open());
Given('my deposit of {amount} makes the high-score table', ({ game }, deposit) => game.depositMakesTheTable(deposit));
Given('the high-score table is slow to answer signings', ({ game }) => game.holdSignings());
Given('the high-score table {signingTrouble} when I sign', ({ game }, trouble) => game.troubleWhenSigning(trouble));
Given('the high-score table can\'t be reached', ({ game }) => game.tableCannotBeReached());
Given('the high-score table doesn\'t answer when asked for its rows', ({ game }) => game.tableStopsAnsweringLoads());
Given('my signing of {initials} is {signingStatus}', ({ game }, initials, status) => game.signingIs(initials, status));
Given('my signing of {initials} was confirmed during my next game', ({ game }, initials) => game.signingConfirmedDuringNextGame(initials));
Given('I have started a new game', ({ game }) => game.startNewGame());
Given('the table looked up for my next game is slow to arrive', ({ game }) => game.nextTableArrivesLate());
Given('the table has answered my signing', ({ game }) => game.signingAnswered());

// ---- acting ----
When('I open the game', ({ game }) => game.open());
When('I finish a game with a deposit of {amount}', ({ game }, deposit) => game.finishGameWith(deposit));
When('I finish a game without a deposit', ({ game }) => game.finishGameWith(0));
When('I sign the table as {initials}', ({ game }, initials) => game.signAs(initials));
When('I sign the table with initials on the word filter', ({ game }) => game.signWithBlockedInitials());
When('I press Enter', ({ game }) => game.pressEnter());
When('I start a new game', ({ game }) => game.startNewGame());
When('{duration} pass without an answer', ({ game }, ms) => game.waitWithoutAnswer(ms));
When('the table answers my signing', ({ game }) => game.answerSigning());
When('the older copy of the table arrives', ({ game }) => game.lateTableArrives());

// ---- observing ----
Then('I am asked for my initials', ({ game }) => game.expectAskedForInitials());
Then('I am not asked for my initials', ({ game }) => game.expectNotAskedForInitials());
Then('the initials field shows {string}', ({ game }, text) => game.expectInitialsField(text));
Then('the initials field still shows those initials, with letter {int} of 3 to change', ({ game }, letter) => game.expectBlockedInitialsKept(letter));
Then('the game tells me {string}', ({ game }, text) => game.expectTold(text));
Then('a new game starts', ({ game }) => game.expectNewGame());
Then('{initials}\'s row on the high-score table is marked as mine', ({ game }, initials) => game.expectMarkedAsMine(initials));
Then('no row on the high-score table is marked as mine', ({ game }) => game.expectNothingMarked());
Then('the high-score table is shown with {int} rows', ({ game }, count) => game.expectRowCount(count));
Then('no high-score table is shown', ({ game }) => game.expectNoTableShown());
Then('{initials} is no longer on the high-score table', ({ game }, initials) => game.expectNotOnTable(initials));
Then('the high-score table is still empty', ({ game }) => game.expectTableEmptyAtTheSource());
Then('the game-over message doesn\'t mention {initials}', ({ game }, initials) => game.expectGameOverWithout(initials));
Then('the game doesn\'t say the high-score table is unavailable', ({ game }) => game.expectNeverToldUnavailable());
Then('the game tried to refresh the table when the game started', ({ game }) => game.expectRefreshAttempted());
Then('my signing was sent only once', ({ game }) => game.expectSigningSentOnce());
Then('the game announced that outcome only once', ({ game }) => game.expectAnnouncedOnce());
