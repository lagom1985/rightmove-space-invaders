import { createBdd } from 'playwright-bdd';
import { test } from './fixtures.js';
import './parameter-types.js';
import { SessionRefusal } from './domain-types.js';

// The Score API's side, with sessions and records: the production handlers called from Node over a real Blobs emulator,
// no browser (project in-memory, tag @server). Every body is one call to the ScoreApi harness (steps/score-api.js).
// The high-score table's own server steps (rightmove-invaders-leaderboard/acceptance/steps/table-service.steps.js) are
// reused where they say the same thing: the rows held, a store that fails, a row saved, the answer's rank, its cache
// headers and listing time, "refused" for the leaderboard's reasons, the log's reason, and the table left as it was.
const { Given, When, Then } = createBdd(test);

// ---- arranging ----
Given('the high-score table has no secret', ({ tableService }) => tableService.noSecret());
Given('{word}\'s game has been given a session', ({ tableService }, name) => tableService.gameGivenASession(name));
Given('{word}\'s game has been given a session, and the table has since lost its secret', ({ tableService }, name) => tableService.sessionThenSecretLost(name));
Given('{word}\'s game has signed {initials} with {amount}', ({ tableService }, name, initials, deposit) => tableService.gameHasSigned(name, initials, deposit));
Given('{word}\'s game has signed {initials} with {amount}, and the owner has since deleted its row', ({ tableService }, name, initials, deposit) => tableService.gameSignedThenOwnerDeleted(name, initials, deposit));
Given('{word}\'s game has signed {initials} with {amount} behind 20 better scores, was pruned, and the owner has since deleted one of them', ({ tableService }, name, initials, deposit) => tableService.gameSignedPrunedThenOneBetterDeleted(name, initials, deposit));
Given('{word}\'s game tried to sign {initials} with {amount}, but saving to the high-score table failed', ({ tableService }, name, initials, deposit) => tableService.gameTriedToSignButSavingFailed(name, initials, deposit));
Given('{word}\'s game has signed {initials} with {amount}, saved just before the table couldn\'t be looked at', ({ tableService }, name, initials, deposit) => tableService.gameSavedButLookFailed(name, initials, deposit));

// ---- acting: session requests ----
When('a game asks the high-score table for a session for its seed', ({ tableService }) => tableService.askForSession());
When('a game asks the high-score table for a session with {seedRequest}', ({ tableService }, kind) => tableService.askForSession(kind));
When('someone reads the sessions instead of asking for one', ({ tableService }) => tableService.readSessions());

// ---- acting: signings ----
When('the high-score table receives {initials}\'s signature of {amount} with no session', ({ tableService }, initials, score) => tableService.signWithoutSession(initials, score));
When('{word}\'s game signs {initials} with {amount}, carrying {carriedSession}', ({ tableService }, name, initials, deposit, how) => tableService.signCarrying(name, initials, deposit, how));
When('{word}\'s game signs {initials} with {amount}, its session issued {sessionAge}', ({ tableService }, name, initials, deposit, age) => tableService.signAged(name, initials, deposit, age));
When('{word}\'s game, played to {amount}, signs {initials} with {amount}', ({ tableService }, name, played, initials, claimed) => tableService.signPlayedTo(name, played, initials, claimed));
When('{word}\'s game signs {initials} with {amount}, carrying its session and a record that {recordTwist}', ({ tableService }, name, initials, deposit, twist) => tableService.signTwisted(name, initials, deposit, twist));
When('{word}\'s game signs {initials} with {amount}, carrying its session and a record whose {recordFault}', ({ tableService }, name, initials, deposit, fault) => tableService.signFaulty(name, initials, deposit, fault));
When('{word}\'s game signs {initials} with {amount}, carrying its session, the signing padded to {bodySize}', ({ tableService }, name, initials, deposit, bytes) => tableService.signPadded(name, initials, deposit, bytes));
When('{word}\'s game signs {initials} with {amount}, as long after its session was issued as the game lasted, less {duration}', ({ tableService }, name, initials, deposit, margin) => tableService.signLessThanItLasted(name, initials, deposit, margin));
When('{word}\'s game, {honestPace}, signs {initials} with {amount}', ({ tableService }, name, pace, initials, deposit) => tableService.signAtPace(name, initials, deposit, pace));
When('{initials} signs with {amount}, carrying a session issued over {lengthOfPlay} before, and a made-up record of {lengthOfPlay} standing still', ({ tableService }, initials, claimed, before, length) => tableService.signMadeUpStandingStill(initials, claimed, before, length));
When('{word}\'s game signs {initials} with {amount} a second after its session was issued, asking for the lenient clock', ({ tableService }, name, initials, deposit) => tableService.signAskingForTheLenientClock(name, initials, deposit));
When('{initials} signs with {amount} and a made-up record of {lengthOfPlay}, a minute after its session was issued', ({ tableService }, initials, claimed, length) => tableService.signMadeUpAMinuteAfter(initials, claimed, length));
When('the longest recorded game signs {initials}, as long after its session was issued as it lasted', ({ tableService }, initials) => tableService.signLongestRecorded(initials));
When('a signing of {amount} arrives with a record of {recordLength} of standing still, its session issued over an hour before', ({ tableService }, claimed, steps) => tableService.signStandingStillFor(steps, claimed));
When('a signing of {amount} arrives with an hour\'s record of {int} changes of keys a second, spaced to take the most room, its session issued over an hour before', ({ tableService }, claimed, pace) => tableService.signLargestHumanRecord(claimed, pace));
When('a signing of {bulk} arrives', ({ tableService }, bytes) => tableService.signEndless(bytes));
When('any burst of {int} to {int} signings of one game arrives, all at once or just after a first one, while the table is being read', ({ tableService }, least, most) => tableService.runBursts(least, most));

// ---- observing ----
Then('the signature is refused {verdict}', ({ tableService }, verdict) => tableService.expectRefused(verdict));
Then('the session request is refused {sessionRefusal}', ({ tableService }, refusal) => tableService.expectRefused(refusal));
Then('the request is refused, because a session can only be asked for', ({ tableService }) => tableService.expectRefused(SessionRefusal.ASK_ONLY));
Then('the answer carries a session for that seed, issued now', ({ tableService }) => tableService.expectSessionIssued());
Then('no session is issued', ({ tableService }) => tableService.expectNoSessionIssued());
Then('the owner can see a session was issued, and how long it took', ({ tableService }) => tableService.expectSessionIssuedLogged());
Then('the owner can see the table has no secret', ({ tableService }) => tableService.expectNoSecretLogged());
Then('the owner can see the game was replayed, and how long the replay took', ({ tableService }) => tableService.expectReplayed());
Then('the owner can see the game was never replayed', ({ tableService }) => tableService.expectNeverReplayed());
Then('a reading of the table taken while it was being refused shows {initials} with {amount} once, and no row for {initials}', ({ tableService }, initials, deposit, absent) => tableService.expectMidReadShowsOnce(initials, deposit, absent));
Then('the high-score table now shows {initials} with {amount} once', ({ tableService }, initials, deposit) => tableService.expectNowShowsOnce(initials, deposit));
Then('the high-score table now shows {initials} with {amount} once, and no row for {initials}', ({ tableService }, initials, deposit, absent) => tableService.expectNowShowsOnce(initials, deposit, absent));
Then('no answer and no reading ever shows more than one row for that game', ({ tableService }) => tableService.expectNeverTwoRowsForOneGame());
Then('a signing that arrived just ahead of the others kept its row', ({ tableService }) => tableService.expectFirstAheadKeptItsRow());
Then('the table stopped reading it soon after its limit', ({ tableService }) => tableService.expectReadStoppedNearTheLimit());
