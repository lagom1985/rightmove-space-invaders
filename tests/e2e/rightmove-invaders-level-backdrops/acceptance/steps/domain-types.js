// The level backdrops' test vocabulary: domain nouns only, each one used by a driver (Mandate 12). The neighbourhoods, the
// ladder and the colours come from the game's own theme (src/theme/theme.js), so the scenarios read the same data the
// game draws from. The player-facing wording lives in the .feature files, which are the scenario SSOT; the technical
// values behind a business phrase (a contrast ratio, a luminance, a scale) live here.
import { COLORS, HURDLES, LADDER, NEIGHBOURHOODS, ladderName, neighbourhood } from '../../../../../src/theme/theme.js';

export { COLORS, HURDLES, LADDER, NEIGHBOURHOODS, ladderName, neighbourhood };

// The six neighbourhoods by name, as the feature files and the page name them: the theme's own entries.
export const Neighbourhood = Object.freeze(Object.fromEntries(NEIGHBOURHOODS.map(place => [place.name, place])));

// Waves as a player counts them: the first wave is level 0. From the sixth wave on, the ladder stays at Forever home.
export const Wave = Object.freeze({
  first: 0, second: 1, third: 2, fourth: 3, fifth: 4, sixth: 5, seventh: 6, eighth: 7, ninth: 8, tenth: 9,
});
// Pure lookup over the table above, accepted here as a derivation of a domain value.
export const waveCalled = level => Object.keys(Wave).find(name => Wave[name] === level) ?? `${level + 1}th`;

// How large the window shows the game: screen pixels per game unit (k). A backdrop is prepared (built) for one size.
export const BackdropSize = Object.freeze({ 'single size': 1, 'double size': 2, 'triple size': 3 });

// The trouble a screen can be in when a backdrop asks it for a surface to draw on (the stand-in canvas factory's
// troubles). "But the first" and "one more only" count the backdrops prepared from then on, in the order they are asked
// for: on a frame, the neighbourhood underneath first, then the one fading in (DESIGN's composition table).
export const ScreenTrouble = Object.freeze({
  NONE: 'has room for every backdrop',
  NO_ROOM: 'has no room for another backdrop',
  ALL_BUT_THE_FIRST: 'has room for every backdrop but the first',
  ROOM_FOR_ONE: 'has room for one more backdrop only',
  LOSES_DRAWING: 'loses its drawing part-way through a backdrop',
  ROOM_AGAIN: 'has room again',
});

// How a neighbourhood is shown on the screen: its own backdrop drawn whole, or its plain background colour (its
// palette's bg) filled over the whole screen.
export const Shown = Object.freeze({ BACKDROP: 'backdrop', PLAIN: 'plain background' });
// One layer of what I see: a neighbourhood shown one way or the other, over the whole screen, at a strength
// (globalAlpha): the neighbourhood underneath at full strength, the one fading in at the fade's.
export const FULL_STRENGTH = 1;
export const WHOLE_SCREEN = 'the whole screen';
export const layerOf = (place, kind, strength = FULL_STRENGTH) => Object.freeze({ shows: `${place.name}'s ${kind}`, strength, covers: WHOLE_SCREEN });

// The moments a backdrop may be prepared on (DDD-B3's four triggers), as the in-memory game names each frame it draws.
export const PreparedMoment = Object.freeze({
  TITLE: 'as the title appears',
  NEW_GAME: 'as the new game starts',
  AFTER_RESIZE: "just after the game's size changed",
  waveCleared: wave => `as "Wave cleared!" appears on the ${wave} wave`,
});

// ---- legibility (ADR-011; DESIGN's Legibility needs table) ----
// The brightest any backdrop colour may be: WCAG relative luminance 0.05 (the spike's rule, ADR-011 clause i).
export const BACKDROP_BRIGHTNESS_LIMIT = 0.05;
// A shade brighter: how much brighter than its palette colour a softened (anti-aliased) edge came out in the spike.
export const SOFTENED_EDGE = 0.001;
// What a use needs to stand out by, as the scenarios say it: the WCAG minimum contrast ratio.
export const ContrastNeed = Object.freeze({ TEXT: 'text', OBJECT: 'something I play against' });
export const CONTRAST_RATIO = Object.freeze({ [ContrastNeed.TEXT]: 4.5, [ContrastNeed.OBJECT]: 3 });

// What the game draws straight on a backdrop, by use, with the colours it is drawn in and what it needs.
const use = (phrase, need, colours) => Object.freeze({ phrase, need, colours: Object.freeze(colours) });
export const ForegroundUse = Object.freeze({
  SMALL_GREY_TEXT: use("the HUD's labels and the small grey text", ContrastNeed.TEXT, { dim: COLORS.dim }),
  WHITE_TEXT: use("the HUD's values and the white text", ContrastNeed.TEXT, { text: COLORS.text }),
  GREEN: use('the green text, the pin and the shot', ContrastNeed.TEXT, { green: COLORS.green }),
  DREAM: use('the Dream home text and the Dream Home', ContrastNeed.TEXT, { dream: COLORS.dream }),
  HURDLES: use('the hurdles, their bolts and their sparks', ContrastNeed.OBJECT, Object.fromEntries(HURDLES.map(({ name, color }) => [name, color]))),
  HOUSES: use("the houses' brick and windows", ContrastNeed.OBJECT, { brick: COLORS.brick, window: COLORS.window }),
});

// The game's colours that are not checked against the neighbourhoods, each excused by name, with its reason (DDD-B7).
export const ExcusedColour = Object.freeze({
  door: "the houses' door: 3 to 1 against a backdrop would need a luminance of 0.25 or more, which leaves it at 1.1 to 1 "
    + 'against its own brick (0.285); no colour satisfies both, and the brick carries the outline of the house',
  danger: 'the game-over red (the reason, the refusal, "Couldn\'t confirm..."): drawn only on the game-over overlay, '
    + 'never straight on a backdrop',
  veils: 'the paused and game-over veils, a translucent near-black (render.js: rgba(20,20,32,0.6) and 0.78) laid over '
    + 'the whole screen: they only darken, so anything lighter than the backdrop drawn over them only gains contrast',
});
// What render.js draws over a backdrop besides the theme's and the hurdles' colours: named here so that the closed set of
// drawn colours is closed (they are not theme colours, so they have no value to measure).
export const VEILS = 'veils';

// The title's hurdle legend: each hurdle's name, 16 px text in its own colour, on the title's one backdrop (DDD-B9).
// Gazumper's name is held to what the hurdle itself needs, for now: 3.84 to 1 on the old backdrop and 3.48 to 1 here, so
// this feature deepens a shortfall it didn't start. A separate fix outlines the legend names and merges right after
// DISTILL; the exemption is dropped then (DDD-B7, H-2).
export const TITLE_NEIGHBOURHOOD = NEIGHBOURHOODS[0];
export const HeldLegendName = Object.freeze({ Gazumper: ContrastNeed.OBJECT });
