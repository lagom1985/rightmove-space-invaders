import { createBdd } from 'playwright-bdd';
import { test } from './fixtures.js';
import './parameter-types.js';
import { Sound, Key, AudioState } from './domain-types.js';

// Real browser, real keyboard: every body is one call to the GameDriver.
// Phrases are distinct from the game suite's steps (tests/e2e/rightmove-invaders/), so every
// sound scenario goes through the driver.
const { Given, When, Then } = createBdd(test);

// ---- arranging ----
Given('I have just opened the game', ({ game }) => game.open());
Given('I have just opened the game in a browser without sound', ({ game }) => game.open({ audio: false }));
Given('I have just opened the game in a browser that blocks saved settings', ({ game }) => game.open({ storage: false }));
Given('I have just opened the game in a browser where sound fails to start', ({ game }) => game.open({ audio: 'broken' }));
Given('I have started a game', ({ game }) => game.press(Key.ENTER));
Given('I am playing with sound on', ({ game }) => game.startPlaying());
Given('I am playing with sound off', ({ game }) => game.startPlaying({ sound: false }));
Given('I am on the {screen} screen', ({ game }, screen) => game.goTo(screen));
Given('I turned the {setting} off on an earlier visit', ({ game }, setting) => game.turnOffOnEarlierVisit(setting));
Given('I have heard a shot', ({ game }) => game.fireAndHearIt());
Given('I have paused the game', ({ game }) => game.press(Key.P));
Given('the formation has marched {int} steps', ({ game }, steps) => game.expectMarched(steps));
Given("the game's sound is ready on its own", ({ game }) => game.openSoundSystemOnly());

// ---- acting ----
When('I start a game', ({ game }) => game.press(Key.ENTER));
When('I press {key}', ({ game }, key) => game.press(key));
When('I fire at the hurdle above me', ({ game }) => game.fire());
When('{seconds} seconds pass on the title screen', ({ game }, ms) => game.wait(ms));
When('I fire {int} shots a second apart', ({ game }, shots) => game.fireShotsApart(shots));
When('I fire into the {house} house', ({ game }, house) => game.fireIntoHouse(house));
When('I pause with {key} for {seconds} seconds', ({ game }, key, ms) => game.pauseFor(key, ms));
When('I lose a home', ({ game }) => game.loseAHome());
When('I stand still until the game is over', ({ game }) => game.waitForGameOver());
When('I switch to another window', ({ game }) => game.switchWindow());
When("I hide the game's tab", ({ game }) => game.hideTab());
When('the formation marches {int} steps', ({ game }, steps) => game.expectMarched(steps));
When('{int} shots start at the same moment', ({ game }, shots) => game.burst(Sound.SHOT, shots));

// ---- observing ----
Then('the game has made no sound', ({ game }) => game.expectNoSoundYet());
Then('the game stays silent', ({ game }) => game.expectSilentSinceLastPress());
Then('all sound stops at once', ({ game }) => game.expectAllSoundStopped());
Then('I hear {sound}', ({ game }, sound) => game.expectHeard(sound));
Then('I hear {sound} within one frame', ({ game }, sound) => game.expectHeardWithinOneFrame(sound));
Then('I hear a hit on a hurdle worth {pounds}', ({ game }, value) => game.expectHeard(Sound.HURDLE_HIT, { value }));
Then('I hear {int} shots', ({ game }, shots) => game.expectHeardCount(Sound.SHOT, shots));
Then('the beat notes go {string}', ({ game }, notes) => game.expectMarchNotes(notes));
Then('the beat notes are about {seconds} seconds apart', ({ game }, ms) => game.expectBeatInterval(ms));
Then('the beat stays silent while the pin respawns', ({ game }) => game.expectNoBeatWhileRespawning());
Then('the beat plays again once the pin is back', ({ game }) => game.expectBeatAfterRespawn());
Then('I hear the music', ({ game }) => game.expectMusic(true));
Then("I don't hear the music", ({ game }) => game.expectMusic(false));
Then('the {setting} setting shows {string}', ({ game }, setting, text) => game.expectSetting(setting, text));
Then('the game announces {string}', ({ game }, text) => game.expectAnnounced(text));
Then('the deposit saved shows {pounds}', ({ game }, amount) => game.expectDeposit(amount));
Then("the game's sound is waiting for a key press", ({ game }) => game.expectAudioState(AudioState.LOCKED));
Then("the game's sound is unavailable", ({ game }) => game.expectAudioState(AudioState.UNAVAILABLE));
Then('no errors or audio warnings are reported', ({ game }) => game.expectNoProblems());
Then('all {int} shots were started', ({ game }, shots) => game.expectStartedCount(Sound.SHOT, shots));
Then('no more than {int} sounds ever played at once', ({ game }, voices) => game.expectPeakVoicesAtMost(voices));
