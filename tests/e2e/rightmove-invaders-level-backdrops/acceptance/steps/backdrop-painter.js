import { createHash } from 'node:crypto';
import { expect } from '@playwright/test';
import { assertStateDelta, setTo } from '../../../../common/state-delta.js';
import { createRecordingContext, PAINT_CALLS } from '../../../../unit/support/fake-canvas.js';
import { paintBackdrop } from '../../../../../src/view/backdrop.js';
import { COLORS, NEIGHBOURHOODS } from './domain-types.js';

// Every neighbourhood painted on its own recording context (paintBackdrop, src/view/backdrop.js; ADR-010), which keeps the
// calls and the fill and stroke colours, never pixels (tests/unit/support/fake-canvas.js). It offers the recipes' calls
// only (PAINT_CALLS), so a recipe that sets its own scale (setTransform) is refused: scaling is the store's.
// "The game's luck" is Math.random. Locked, it is swapped, for each painting call only, for a stub that counts every
// call and throws: the test runner itself uses Math.random between steps, so the stub must never outlive the call. The
// fixture also puts the real one back after the scenario, whatever happened. luckAsked and refused are milestone 3's
// guards that every Then holds without naming them.
//
// Universe, per neighbourhood, all read off the recording (the port the recipes paint on):
//   drawn               'in full', 'nothing drawn', or what it failed with
//   drawing             a digest of every call and colour, in order: equal digests, the same drawing
//   outsideItsColours   the fill and stroke colours set that are neither its palette's nor the ground line's green
//   streetsAndSkyline   whether anything was drawn in its road colour (its streets) and filled in its sky colour (its
//                       skyline: the recipes draw skylines, and only skylines, in the palette's sky colour)
// and, over all of them: luckAsked (calls to Math.random) and refused (anything a 2D context isn't offered for).

const IN_FULL = 'in full';
const digest = calls => createHash('sha256').update(JSON.stringify(calls)).digest('hex');
const everyPlace = value => Object.fromEntries(NEIGHBOURHOODS.map(({ name }) => [name, value]));

// The colours a drawing set or drew with, and the ones it drew with: a fill or fillRect in the fill colour, a stroke in
// the stroke colour. Both start at a new context's black, so a draw made before any colour is set counts as black.
function coloursOf(calls) {
  const set = new Set(), used = new Set();
  let fill = '#000000', stroke = '#000000';
  for (const [name, value] of calls) {
    if (name === 'fillStyle') { fill = String(value).toLowerCase(); set.add(fill); }
    if (name === 'strokeStyle') { stroke = String(value).toLowerCase(); set.add(stroke); }
    if (name === 'fill' || name === 'fillRect') { set.add(fill); used.add(`fill ${fill}`); }
    if (name === 'stroke') { set.add(stroke); used.add(`stroke ${stroke}`); }
  }
  return { set, used };
}

export class BackdropPainter {
  constructor() {
    this.recordings = {};
    this.failed = {};
    this.refused = [];
    this.luckAsked = 0;
    this.luckLocked = false;
    this.realLuck = null;
    this.before = null;
    this.after = null;
  }

  observe() {
    const drawn = {}, drawing = {}, outsideItsColours = {}, streetsAndSkyline = {};
    for (const { name, palette } of NEIGHBOURHOODS) {
      const calls = this.recordings[name];
      if (!calls) continue;
      const { set, used } = coloursOf(calls);
      const allowed = new Set([...Object.values(palette), COLORS.green].map(colour => colour.toLowerCase()));
      drawn[name] = this.failed[name] ?? (calls.length ? IN_FULL : 'nothing drawn');
      drawing[name] = digest(calls);
      outsideItsColours[name] = [...set].filter(colour => !allowed.has(colour));
      const road = palette.road.toLowerCase(), sky = palette.sky.toLowerCase();
      streetsAndSkyline[name] = { streets: used.has(`fill ${road}`) || used.has(`stroke ${road}`), skyline: used.has(`fill ${sky}`) };
    }
    return { drawn, drawing, outsideItsColours, streetsAndSkyline, luckAsked: this.luckAsked, refused: [...this.refused] };
  }

  act(action) {
    this.before = this.observe();
    action();
    this.after = this.observe();
  }

  // ---- arranging ----
  lockTheLuck() { this.luckLocked = true; }

  unlockTheLuck() {
    if (this.realLuck) Math.random = this.realLuck;
    this.realLuck = null;
  }

  // One painting, with the game's luck locked if it is.
  paint(context, place) {
    if (!this.luckLocked) return paintBackdrop(context, place);
    this.realLuck = Math.random;
    Math.random = () => {
      this.luckAsked++;
      throw new Error("a backdrop asked for the game's luck (Math.random)");
    };
    try {
      return paintBackdrop(context, place);
    } finally {
      this.unlockTheLuck();
    }
  }

  // Each neighbourhood on a fresh recording context. What a painting throws is kept, not thrown on: the Then says it.
  drawEvery() {
    for (const place of NEIGHBOURHOODS) {
      const { context, calls } = createRecordingContext({ offers: PAINT_CALLS, refused: this.refused });
      delete this.failed[place.name];
      try {
        this.paint(context, place);
      } catch (error) {
        this.failed[place.name] = `failed: ${error.message}`;
      }
      this.recordings[place.name] = calls();
    }
  }

  drawnOnce() {
    this.drawEvery();
    expect(this.observe().drawn, 'arranging: every neighbourhood should have been drawn in full').toEqual(everyPlace(IN_FULL));
  }

  // ---- acting ----
  whenDrawsEvery() { this.act(() => this.drawEvery()); }

  // ---- observing ----
  delta(universe, expected) { assertStateDelta(this.before, this.after, { universe, expected }); }

  expectInFullWithoutLuck() {
    this.delta(['drawn', 'luckAsked', 'refused'], { drawn: setTo(everyPlace(IN_FULL)) });
  }

  expectSameAsFirstTime() {
    this.delta(['drawn', 'drawing', 'luckAsked', 'refused'], {});
  }

  expectOwnColoursOnly() {
    this.delta(['drawn', 'outsideItsColours', 'luckAsked', 'refused'], { drawn: setTo(everyPlace(IN_FULL)), outsideItsColours: setTo(everyPlace([])) });
  }

  expectStreetsAndSkyline() {
    this.delta(['drawn', 'streetsAndSkyline', 'luckAsked', 'refused'], {
      drawn: setTo(everyPlace(IN_FULL)),
      streetsAndSkyline: setTo(everyPlace({ streets: true, skyline: true })),
    });
  }
}
