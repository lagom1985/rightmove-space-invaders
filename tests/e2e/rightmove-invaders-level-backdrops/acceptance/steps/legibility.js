import { expect } from '@playwright/test';
import { relativeLuminance, contrastRatio } from '../../../../unit/support/contrast.js';
import {
  COLORS, HURDLES, NEIGHBOURHOODS, ForegroundUse, ExcusedColour, TITLE_NEIGHBOURHOOD, HeldLegendName, SOFTENED_EDGE,
  BACKDROP_BRIGHTNESS_LIMIT, CONTRAST_RATIO, VEILS,
} from './domain-types.js';

// The backdrop legibility rule (ADR-011) on the theme's data alone (src/theme/theme.js): every pair in plain loops, no
// sampling and no pixels (waiver D10). Brightness is WCAG 2.x relative luminance, and "a backdrop may be" no brighter
// than BACKDROP_BRIGHTNESS_LIMIT (0.05); "stands out" is the WCAG contrast ratio (tests/unit/support/contrast.js), "as
// much as text needs to" 4.5 to 1 and "as much as something I play against needs to" 3 to 1 (CONTRAST_RATIO). Each
// palette colour is taken a shade brighter (SOFTENED_EDGE, +0.001 relative luminance, the largest overshoot the spike
// measured on an anti-aliased edge) before its contrast is measured; it also covers a crossfaded pixel. A pure read of
// data: there is no state to change, so each check lists every pair that falls short, by name, and expects that list
// to be empty.

const ratio = (colour, backdropColour) => contrastRatio(relativeLuminance(colour), relativeLuminance(backdropColour) + SOFTENED_EDGE);
const round = n => Math.round(n * 1000) / 1000;
const PALETTE_SIZE = 9;

// Every colour of every neighbourhood: [{ where: 'Seaside at night road', colour }].
const everyNeighbourhoodColour = () => NEIGHBOURHOODS.flatMap(({ name, palette }) =>
  Object.entries(palette).map(([part, colour]) => ({ where: `${name} ${part}`, colour })));

// One colour against every colour of every neighbourhood, a shade brighter: [{ what, against, ratio }].
const measuredAgainstEvery = (what, colour) => everyNeighbourhoodColour()
  .map(({ where, colour: against }) => ({ what, against: where, ratio: ratio(colour, against) }));

const shortOf = (measured, needOf) => measured.filter(({ what, ratio: r }) => r < needOf(what))
  .map(({ what, against, ratio: r }) => `${what} on ${against}: ${round(r)} to 1, needs ${needOf(what)}`);

export class LegibilityCheck {
  constructor() {
    this.measured = null;
  }

  // ---- acting ----
  measureNeighbourhoods() {
    this.measured = everyNeighbourhoodColour().map(({ where, colour }) => ({ where, colour, luminance: relativeLuminance(colour) }));
  }

  // Every colour of the use against every colour of every neighbourhood, a shade brighter.
  measureUse(use) {
    this.measured = Object.entries(use.colours).flatMap(([what, colour]) => measuredAgainstEvery(what, colour));
  }

  // The hurdles' names in the title's legend against every colour of the title's one backdrop, a shade brighter.
  measureLegend() {
    this.measured = HURDLES.flatMap(({ name, color }) => Object.entries(TITLE_NEIGHBOURHOOD.palette)
      .map(([part, against]) => ({ what: name, against: `${TITLE_NEIGHBOURHOOD.name} ${part}`, ratio: ratio(color, against) })));
  }

  // Every colour the game draws over a backdrop, the theme's own, the hurdles' and the two veils, each measured against
  // every colour of every neighbourhood with the strictest need of the uses it has (ForegroundUse), unless it is excused
  // by name (ExcusedColour). A colour with neither is listed, unmeasured, and so is one with both.
  measureEveryDrawnColour() {
    const needs = new Map();
    for (const { need, colours } of Object.values(ForegroundUse)) {
      for (const what of Object.keys(colours)) needs.set(what, Math.max(needs.get(what) ?? 0, CONTRAST_RATIO[need]));
    }
    const drawn = [...Object.entries(COLORS), ...HURDLES.map(({ name, color }) => [name, color]), [VEILS, null]];
    this.measured = {
      drawn: drawn.map(([what]) => what),
      needs,
      pairs: drawn.filter(([what]) => needs.has(what) && !(what in ExcusedColour)).flatMap(([what, colour]) => measuredAgainstEvery(what, colour)),
    };
  }

  // ---- observing ----
  expectNoneBrighterThanABackdropMayBe() {
    expect(this.measured.length, 'nine colours in each of the six neighbourhoods').toBe(NEIGHBOURHOODS.length * PALETTE_SIZE);
    const brighter = this.measured.filter(({ luminance }) => luminance > BACKDROP_BRIGHTNESS_LIMIT)
      .map(({ where, colour, luminance }) => `${where} ${colour}: ${round(luminance)}`);
    expect(brighter, `colours brighter than a relative luminance of ${BACKDROP_BRIGHTNESS_LIMIT}`).toEqual([]);
  }

  expectStandsOutAsMuchAs(need) {
    expect(this.measured.length, 'measured against every neighbourhood colour').toBeGreaterThanOrEqual(NEIGHBOURHOODS.length * PALETTE_SIZE);
    expect(shortOf(this.measured, () => CONTRAST_RATIO[need]), `pairs below ${CONTRAST_RATIO[need]} to 1`).toEqual([]);
  }

  // Gazumper's name is held to what its hurdle needs (HeldLegendName, with its reason); every other name needs `need`.
  expectLegendStandsOutAsMuchAs(need) {
    expect(this.measured.length, 'every hurdle name against every colour of the title backdrop').toBe(HURDLES.length * PALETTE_SIZE);
    const needOf = what => CONTRAST_RATIO[HeldLegendName[what] ?? need];
    expect(shortOf(this.measured, needOf), 'legend names below their need').toEqual([]);
  }

  // Over the colours actually measured: each drawn colour was measured against all 54 neighbourhood colours and meets
  // its need, or is excused by name, never both and never neither; and the excused are exactly the door, the game-over
  // red and the veils.
  expectEachMeetsItsNeedOrIsExcused() {
    const { drawn, needs, pairs } = this.measured;
    const excused = Object.keys(ExcusedColour);
    const measuredColours = [...new Set(pairs.map(({ what }) => what))];
    expect({
      neitherMeasuredNorExcused: drawn.filter(what => !measuredColours.includes(what) && !excused.includes(what)),
      bothNeededAndExcused: drawn.filter(what => needs.has(what) && excused.includes(what)),
      excusedButNotDrawn: excused.filter(what => !drawn.includes(what)),
      pairsPerColour: Object.fromEntries(measuredColours.map(what => [what, pairs.filter(pair => pair.what === what).length])),
      short: shortOf(pairs, what => needs.get(what)),
      excused: [...excused].sort(),
    }).toEqual({
      neitherMeasuredNorExcused: [],
      bothNeededAndExcused: [],
      excusedButNotDrawn: [],
      pairsPerColour: Object.fromEntries(measuredColours.map(what => [what, NEIGHBOURHOODS.length * PALETTE_SIZE])),
      short: [],
      excused: ['danger', 'door', VEILS],
    });
  }
}
