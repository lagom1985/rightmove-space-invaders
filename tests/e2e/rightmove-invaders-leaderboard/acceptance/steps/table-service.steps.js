import { createBdd } from 'playwright-bdd';
import { test } from './fixtures.js';
import './parameter-types.js';
import { Refusal, TableFailure } from './domain-types.js';

// The high-score table service's side: handleScores called from Node over a real Blobs emulator, no browser
// (project in-memory, tag @server). Every body is one call to the TableService harness (steps/table-service.js).
const { Given, When, Then } = createBdd(test);

// ---- arranging ----
Given('nobody has signed the high-score table yet', ({ tableService }) => tableService.expectEmpty());
Given('the high-score table holds these signatures:', ({ tableService }, dataTable) => tableService.holdSignatures(dataTable));
Given('the high-score table holds {initials} with {amount}', ({ tableService }, initials, score) => tableService.holdSignature(initials, score));
Given('the high-score table holds {int} scores', ({ tableService }, count) => tableService.holdScores(count));
Given('the high-score table also holds stray entries that aren\'t signatures', ({ tableService }) => tableService.holdStrayEntries());
Given('{tableAction} fails', ({ tableService }, action) => tableService.failWhen(action));
Given('the high-score table puts every new signature in the same row', ({ tableService }) => tableService.repeatTheSameRow());
Given('the high-score table has saved {signature}', ({ tableService }, signature) => tableService.saved(signature));

// ---- acting ----
When('someone reads the high-score table', ({ tableService }) => tableService.read());
When('the high-score table receives {signature}', ({ tableService }, signature) => tableService.receive(signature));
When('someone asks the high-score table to {tableRequest}', ({ tableService }, request) => tableService.ask(request));
When('any batch of up to {int} valid signatures arrives at the same moment', ({ tableService }, atMost) => tableService.forAnyBatch(atMost));

// ---- observing ----
Then('the high-score table answers with no rows', ({ tableService }) => tableService.expectNoRows());
Then('the high-score table answers with these rows, in order:', ({ tableService }, dataTable) => tableService.expectRows(dataTable));
Then('the answer is accepted', ({ tableService }) => tableService.expectAccepted());
Then('the answer says when the table was looked at', ({ tableService }) => tableService.expectListedAt());
Then('everyone who reads the table sees it at most 15 seconds old', ({ tableService }) => tableService.expectSharedForAtMost15Seconds());
Then('the answer is never kept for reuse', ({ tableService }) => tableService.expectNeverKept());
Then('the table is left as it was', ({ tableService }) => tableService.expectUnchanged());
Then('the signature is saved as one new row', ({ tableService }) => tableService.expectOneNewRow());
Then('the table gains at most one row', ({ tableService }) => tableService.expectAtMostOneNewRow());
Then('the answer shows {initials}\'s new row at #{int}', ({ tableService }, initials, rank) => tableService.expectNewRowRanked(initials, rank));
Then('the answer shows {initials} at #{int} and at #{int}', ({ tableService }, initials, first, second) => tableService.expectRankedTwice(initials, first, second));
Then('the signature is refused {refusal}', ({ tableService }, refusal) => tableService.expectRefused(refusal));
Then('the signature is turned away as not saved', ({ tableService }) => tableService.expectRefused(Refusal.NOT_SAVED));
Then('the answer is that the table failed unexpectedly', ({ tableService }) => tableService.expectRefused(Refusal.UNEXPECTED));
Then('they are told the table can only be read or signed', ({ tableService }) => tableService.expectRefused(Refusal.READ_OR_SIGN_ONLY));
Then('the owner can see it was {tableFailure}', ({ tableService }, failure) => tableService.expectLogged(failure));
Then('the owner can see why it was refused', ({ tableService }) => tableService.expectRefusalLogged());
Then('the owner can see where the table is kept and how long the read took', ({ tableService }) => tableService.expectReadLogged());
Then('the owner can see where the table is kept and how long the signing took', ({ tableService }) => tableService.expectSigningLogged());
Then('what the owner sees says nothing about the player', ({ tableService }) => tableService.expectLogSaysNothingAboutThePlayer());
Then('the table gains {initials}\'s row and loses {removals}', ({ tableService }, initials, removals) => tableService.expectGainedAndLost(initials, removals));
Then('the stray entries that aren\'t signatures are all still there', ({ tableService }) => tableService.expectStrayEntriesKept());
Then('every signer is answered, and the table shows exactly the best 10 of them', ({ tableService }) => tableService.checkNoSignatureLost());
