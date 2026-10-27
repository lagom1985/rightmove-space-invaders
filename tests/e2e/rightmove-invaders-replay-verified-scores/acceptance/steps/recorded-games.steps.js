import { createBdd } from 'playwright-bdd';
import { test } from './fixtures.js';
import './parameter-types.js';

// The recorded-games check (K21): the corpus signed through the table (the Score API harness, project in-memory, @server)
// and played back in the browser that runs the scenario. Every body is one call to a driver: RecordedGamesCheck
// (steps/recorded-games-check.js) or the Score API harness (steps/score-api.js).
const { Given, When, Then } = createBdd(test);

Given('the recorded games, from about a minute to at least 15 minutes long', ({ recordedGames }) => recordedGames.load());
Given('the recorded games, one of them changed to end {corpusChange}', ({ recordedGames }, what) => recordedGames.loadWithOneChanged(what));

When('each of them signs the high-score table, as long after its session was issued as it lasted', ({ recordedGames, tableService }) => tableService.signRecordedGames(recordedGames.games));
When('this browser replays every one of them', ({ recordedGames, page }) => recordedGames.replayInBrowser(page));

Then('the table saves every one, at its recorded deposit, having played back every step it recorded', ({ tableService }) => tableService.expectRecordedGamesSaved());
Then('the table refuses that game, and only that one, as not the game it claims', ({ recordedGames, tableService }) => tableService.expectOnlyRecordedGameRefused(recordedGames.changed));
Then('each one ends at game over at its recorded step, with its recorded deposit', ({ recordedGames }) => recordedGames.expectAllAsRecorded());
