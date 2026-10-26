import { createBdd } from 'playwright-bdd';
import { test } from './fixtures.js';
import './parameter-types.js';
import { PreparedMoment, Shown } from './domain-types.js';

// The level backdrops in memory (project in-memory). Every body is one call to a driver: InMemoryGame
// (in-memory-game.js), ScreenBackdrops (screen-backdrops.js), BackdropPainter (backdrop-painter.js) or LegibilityCheck
// (legibility.js). Step texts differ from the other features' (steps are global to the suite): the browser features
// already have "I start a game", "I have started a game" and "I lose a home". They say "prepared" where the code says
// built, and give time in seconds, never frames.
const { Given, When, Then } = createBdd(test);

// ---- the climb: arranging ----
Given('the game has just loaded', ({ game }) => game.load());
Given('I have started climbing the property ladder', ({ game }) => game.startClimbing());
Given('I am playing the {wave} wave', ({ game }, level) => game.climbTo(level));
Given('I have cleared the {wave} wave', ({ game }, level) => game.clearWave(level));
Given('{float} seconds of the banner have passed', ({ game }, seconds) => game.passBanner(seconds));
Given('I have lost the game', ({ game }) => game.loseTheGame());

// ---- the climb: acting ----
When('the game loads', ({ game }) => game.whenLoads());
When('I start climbing the property ladder', ({ game }) => game.whenStartsClimbing());
When('I climb to the {wave} wave', ({ game }, level) => game.whenClimbsTo(level));
When('I move up to the {wave} wave', ({ game }, level) => game.whenMovesUpTo(level));
When('I clear the {wave} wave', ({ game }, level) => game.whenClearsWave(level));
When('{float} seconds of the banner pass', ({ game }, seconds) => game.whenBannerPasses(seconds));
When('the banner ends', ({ game }) => game.whenBannerEnds());
When('I pause the game for {int} seconds', ({ game }, seconds) => game.whenPausesFor(seconds));
When('I pause and resume the game', ({ game }) => game.whenPausesAndResumes());
When('I lose a home to a bolt', ({ game }) => game.whenLosesAHome());
When('I lose a home to a bolt, and my pin comes back', ({ game }) => game.whenLosesAHomeAndComesBack());
When('I lose the game', ({ game }) => game.whenLosesTheGame());
When('I play again', ({ game }) => game.whenPlaysAgain());
When('"Wave cleared!" shows on the {wave} wave with {float} seconds of the banner left', ({ game }, level, left) => game.whenWaveClearedShows(level, left));
When('the rungs of the property ladder are set beside the neighbourhoods', ({ game }) => game.whenLadderBesideNeighbourhoods());
When('the window is resized to {backdropSize} half way through the banner', ({ game }, k) => game.whenResizedHalfWayThroughBanner(k));

// ---- the climb: observing ----
Then('I am at {string}, in {string}', ({ game }, rung, place) => game.expectAt(rung, place));
Then('I hear only {string}', ({ game }, sentence) => game.expectHeardOnly(sentence));
Then('I hear {string}, then {string}', ({ game }, first, then) => game.expectHeard(first, then));
Then('the backdrop shows {neighbourhood}, with {fade}', ({ game }, place, fade) => game.expectBackdrop(place, fade));
Then('the backdrop still shows {neighbourhood}, with {fade}', ({ game }, place, fade) => game.expectBackdropHeld(place, fade));
Then('every rung has a neighbourhood of its own, and every neighbourhood a rung of its own', ({ game }) => game.expectOneNeighbourhoodPerRung());

// ---- the screen's backdrops: arranging ----
Given('the game is shown at {backdropSize}', ({ screen }, k) => screen.showAt(k));
Given('the screen {screenTrouble}', ({ screen }, trouble) => screen.troubleIs(trouble));
Given('{neighbourhoods} have been shown in turn', ({ screen }, places) => screen.showInTurn(places));
Given('{neighbourhood} has been shown with its plain background', ({ screen }, place) => screen.showPlain(place));

// ---- the screen's backdrops: acting ----
When('{neighbourhood} is shown', ({ screen }, place) => screen.showOnce(place));
When('{neighbourhood} is shown for {int} seconds', ({ screen }, place, seconds) => screen.showFor(place, seconds));
When('{neighbourhoods} are shown in turn', ({ screen }, places) => screen.showInTurn(places));
When('the screen draws {neighbourhood}, with {fade}', ({ screen }, place, fade) => screen.whenDraws(place, fade));
When('the window is resized to {backdropSize} with {neighbourhoods} on screen', ({ screen }, k, places) => screen.resizeWith(k, places));
When('the window is resized but keeps the game at {backdropSize}, with {neighbourhoods} on screen', ({ screen }, k, places) => screen.resizeWith(k, places));

// ---- the screen's backdrops: observing ----
Then('{neighbourhood} was prepared once, at {backdropSize}', ({ screen }, place, k) => screen.expectBuilt([place], k));
Then('the neighbourhoods prepared were {neighbourhoods}', ({ screen }, places) => screen.expectBuilt(places));
Then('{neighbourhoods} were each prepared once more, at {backdropSize}', ({ screen }, places, k) => screen.expectBuilt(places, k));
Then('{neighbourhood} was prepared once more, at {backdropSize}, and shows its backdrop', ({ screen }, place, k) => screen.expectBuiltAndShown(place, k));
Then('{neighbourhood} was prepared once more, at {backdropSize}, as the new game starts', ({ screen }, place, k) => screen.expectBuiltOnceMoreAt(place, k, PreparedMoment.NEW_GAME));
Then('{neighbourhood} shows its plain background, and the game plays on with nothing reported', ({ screen }, place) => screen.expectPlainAndPlaysOn(place));
Then('{neighbourhood} was not prepared again, and still shows its plain background', ({ screen }, place) => screen.expectNotBuiltAgain([place], Shown.PLAIN));
Then('{neighbourhoods} were not prepared again, and still show their backdrops', ({ screen }, places) => screen.expectNotBuiltAgain(places, Shown.BACKDROP));
Then('{neighbourhood} shows its plain background, and {neighbourhood} shows its backdrop', ({ screen }, plain, shown) => screen.expectShown(plain, shown));
Then('I see {layer}, with {overlay}', ({ screen }, underneath, over) => screen.expectOnScreen(underneath, over));
Then('neighbourhoods were prepared only at these moments, at {backdropSize}:', ({ screen }, k, moments) => screen.expectBuiltOnlyAt(k, moments.hashes()));

// ---- painting ----
Given("the game's luck can't be used", ({ painter }) => painter.lockTheLuck());
Given('every neighbourhood has been drawn once', ({ painter }) => painter.drawnOnce());
When('every neighbourhood is drawn', ({ painter }) => painter.whenDrawsEvery());
When('every neighbourhood is drawn again', ({ painter }) => painter.whenDrawsEvery());
Then("every neighbourhood is drawn in full, and the game's luck is never asked for", ({ painter }) => painter.expectInFullWithoutLuck());
Then('each neighbourhood is drawn exactly as it was the first time', ({ painter }) => painter.expectSameAsFirstTime());
Then('each neighbourhood is drawn only in its own colours, and green for the ground line', ({ painter }) => painter.expectOwnColoursOnly());
Then('each neighbourhood has its streets, in its road colour, and its skyline, in its sky colour', ({ painter }) => painter.expectStreetsAndSkyline());

// ---- legibility ----
When('every colour of every neighbourhood is measured', ({ legibility }) => legibility.measureNeighbourhoods());
When('{foregroundUse} is measured against every colour of every neighbourhood, a shade brighter', ({ legibility }, use) => legibility.measureUse(use));
When("the names in the title's legend are measured against the outline they are drawn on", ({ legibility }) => legibility.measureLegend());
When('every colour the game draws over a backdrop is measured against every colour of every neighbourhood, a shade brighter', ({ legibility }) => legibility.measureEveryDrawnColour());
Then('no colour is brighter than a backdrop may be', ({ legibility }) => legibility.expectNoneBrighterThanABackdropMayBe());
Then('each stands out as much as {contrastNeed} needs to, against every one', ({ legibility }, need) => legibility.expectStandsOutAsMuchAs(need));
Then('every name stands out as much as {contrastNeed} needs to', ({ legibility }, need) => legibility.expectLegendStandsOutAsMuchAs(need));
Then("each stands out as much as its use needs, except the houses' door, which no colour can fix, the game-over red, which is drawn only on the game-over screen, the outline round the title's names, which is there to set them off, and the veils of the paused and game-over screens, which only darken", ({ legibility }) => legibility.expectEachMeetsItsNeedOrIsExcused());
