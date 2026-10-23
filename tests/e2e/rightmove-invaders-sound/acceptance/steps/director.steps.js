import { createBdd } from 'playwright-bdd';
import { test } from './fixtures.js';
import './parameter-types.js';
import { Sound, GameEvent } from './domain-types.js';

// In-memory: the sound director and its cue plans. Every body is one call to the DirectorHarness.
const { Given, When, Then } = createBdd(test);

// ---- arranging ----
Given('a game is running with sound {onOff} and music {onOff}', ({ director }, sound, music) => director.start({ sound, music }));
Given('the Dream Home is on screen', ({ director }) => director.arrange(GameEvent.DREAM_APPEARED));
Given('the game is paused', ({ director }) => director.arrange(GameEvent.PAUSED));

// ---- acting: concrete events ----
When('the game reports {gameEvent}', ({ director }, event) => director.report(event));
When('the game reports a hurdle worth {pounds} being hit', ({ director }, value) => director.report(GameEvent.HURDLE_HIT, { value }));
When('the game reports a bolt hitting a house', ({ director }) => director.report(GameEvent.SHIELD_HIT, { source: 'bolt' }));
When('the game reports {int} house hits {int} ms apart', ({ director }, count, gap) => director.reportHouseHits(count, gap));
When('the player switches the sound {onOff}', ({ director }, on) => director.switchSound(on));

// ---- acting: any events (properties) ----
When('the game reports any sequence of events', ({ director }) => director.forAnyEvents());
When('the formation takes any number of steps at any pace', ({ director }) => director.forAnyFormationSteps());
When('the game ends and any events follow, including new games', ({ director }) => director.forAnyLifecycle());
When('houses are hit in any burst', ({ director }) => director.forAnyHouseHitBursts());

// ---- observing ----
Then('{sound} is played', ({ director }, sound) => director.expectPlayed(sound));
Then('a hit on a hurdle worth {pounds} is played', ({ director }, value) => director.expectPlayed(Sound.HURDLE_HIT, { value }));
Then('{int} thuds are played', ({ director }, count) => director.expectPlayedCount(Sound.SHIELD_HIT, count));
Then('the thuds play {string} ms after the first hit', ({ director }, offsets) => director.expectThudOffsets(offsets));
Then('nothing that makes a sound is played', ({ director }) => director.expectNothingAudible());
Then('the same events with the sound on make the sounds a player expects', ({ director }) => director.checkSameEventsWithSoundOn());
Then('one beat note plays per step, cycling through four notes', ({ director }) => director.checkOneBeatPerStep());
Then('beat notes play only while a game is in progress', ({ director }) => director.checkBeatOnlyWhilePlaying());
Then('the thuds are at least {int} ms apart and none is dropped needlessly', ({ director }, ms) => director.checkHouseHitSpacing(ms));
Then('the Dream Home siren is {loopState}', ({ director }, looping) => director.expectLoop(Sound.SIREN, looping));
Then('the music is {musicState}', ({ director }, playing) => director.expectMusic(playing));
