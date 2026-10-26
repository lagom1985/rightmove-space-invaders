import { isDeepStrictEqual } from 'node:util';
import { expect } from '@playwright/test';
import { assertStateDelta, appendedWith, setTo } from '../../../../common/state-delta.js';
import { createFakeCanvasFactory, createRecordingContext, CanvasTrouble, SCREEN_CALLS } from '../../../../unit/support/fake-canvas.js';
import { createBackdropCache, showBackdrop } from '../../../../../src/view/backdrop.js';
import { STEP, W, H } from '../../../../../src/game/config.js';
import { NEIGHBOURHOODS, ScreenTrouble, Shown, FULL_STRENGTH, WHOLE_SCREEN, layerOf } from './domain-types.js';

// The screen's backdrops (ADR-010), through the real units of src/view/backdrop.js: each frame calls the real shell,
// showBackdrop(context, plan, canvasFor), on a recording 2D context that stands for the screen's (SCREEN_CALLS of
// tests/unit/support/fake-canvas.js), with the real store, createBackdropCache(createCanvas), over the stand-in canvas
// factory of the same file. These are internal view units, called directly by the user's choice (2026-10-26; the
// policy's deviation from Mandate 1): render.js makes this call only once DELIVER has moved it onto them, and that it
// does is checked by hand (waiver D10). The in-memory game (in-memory-game.js) draws through this same object, frame by
// frame, with backdropPlan's plan; on its own, a frame's plan is written here ({ here, next, mix }).
//
// The shell is handed the store's canvasFor alone, through a watch, so every backdrop prepared is seen with the
// neighbourhood it was asked for. The screen's troubles are the stand-in factory's (CanvasTrouble): no
// room is a getContext('2d') that returns null, as when the browser can't allocate the canvas; losing its drawing is a
// draw that throws part-way, as on a lost GPU. A size is k screen pixels per game unit: double size is k = 2, a backdrop
// of 1920 by 1440; triple size k = 3, 2880 by 2160. A resize that keeps the game's size rescales with the same k.
// Universe, every slot read at a port (the screen's recording, the factory and its canvases' recordings, what the shell
// let out to its caller or the console), never the store's insides:
//   built       every backdrop prepared (a canvas asked of the factory), in order: { neighbourhood, size: [width, height],
//               scaledTo }, scaledTo being the k its first call set (setTransform(k, 0, 0, k, 0, 0)) before anything
//               was drawn on it
//   builtOn     the moment each was prepared on, when the in-memory game draws: { neighbourhood, moment }
//   shown       per neighbourhood, how a frame last showed it: Shown.BACKDROP (a drawImage of its own canvas) or
//               Shown.PLAIN (a fillRect in its palette's bg)
//   onScreen    the last frame's drawing, layer by layer: { shows, strength (globalAlpha), covers }
//   failures    anything thrown out of the shell to its caller (render.js's draw(), so the frame loop)
//   reported    anything written to the console while the shell worked
//   refused     anything asked of a stand-in (a canvas or a 2D context) that it doesn't offer
//   notPutBack  the frames that left the screen's strength (globalAlpha) other than where the shell found it (1)

const TROUBLE = {
  [ScreenTrouble.NONE]: CanvasTrouble.NONE,
  [ScreenTrouble.NO_ROOM]: CanvasTrouble.NO_ROOM,
  [ScreenTrouble.ALL_BUT_THE_FIRST]: CanvasTrouble.ALL_BUT_THE_FIRST,
  [ScreenTrouble.ROOM_FOR_ONE]: CanvasTrouble.ROOM_FOR_ONE,
  [ScreenTrouble.LOSES_DRAWING]: CanvasTrouble.LOSES_DRAWING,
  [ScreenTrouble.ROOM_AGAIN]: CanvasTrouble.NONE,
};
const CONSOLE = ['log', 'info', 'warn', 'error', 'debug'];
const DRAWS = new Set(['drawImage', 'fillRect']);
const sizeAt = k => [Math.round(W * k), Math.round(H * k)];
const preparedAt = (place, k) => ({ neighbourhood: place.name, size: sizeAt(k), scaledTo: k });
const framesIn = seconds => Math.round(seconds / STEP);
const plan = (here, next = null, mix = 0) => Object.freeze({ here, next, mix });
const byBackground = new Map(NEIGHBOURHOODS.map(place => [place.palette.bg.toLowerCase(), place]));

// The scale a backdrop's canvas was set to before anything was drawn on it: its first call must be
// setTransform(k, 0, 0, k, 0, 0).
function scaledTo(calls) {
  const [first] = calls;
  if (!first) return 'nothing drawn';
  const [name, a, b, c, d, e, f] = first;
  return name === 'setTransform' && a === d && b === 0 && c === 0 && e === 0 && f === 0 ? a : `not scaled first (${name})`;
}

export class ScreenBackdrops {
  constructor() {
    this.canvases = createFakeCanvasFactory();
    this.store = null;
    this.scale = null;           // set once the window shows the game: until then nothing is drawn
    this.builds = [];            // { neighbourhood, size, scaledTo, moment }
    this.builtFor = new Map();   // canvas -> the neighbourhood it was prepared for
    this.shownAs = {};
    this.onScreen = [];
    this.failures = [];
    this.reported = [];
    this.screenRefused = [];
    this.notPutBack = [];
    this.moment = null;
    this.before = null;
    this.after = null;
  }

  get isShowing() { return this.scale !== null; }

  observe() {
    return {
      built: this.builds.map(({ neighbourhood, size, scaledTo: k }) => ({ neighbourhood, size, scaledTo: k })),
      builtOn: this.builds.map(({ neighbourhood, moment }) => ({ neighbourhood, moment })),
      shown: { ...this.shownAs },
      onScreen: [...this.onScreen],
      failures: [...this.failures],
      reported: [...this.reported],
      refused: [...this.canvases.refused(), ...this.screenRefused],
      notPutBack: [...this.notPutBack],
    };
  }

  // One action, observed before and after: the Thens compare the two.
  act(action) {
    this.before = this.observe();
    action();
    this.after = this.observe();
  }

  // ---- arranging ----
  showAt(k) { this.scale = k; }

  troubleIs(trouble) { this.canvases.setTrouble(TROUBLE[trouble]); }

  // The store is made, then sized, the first time anything is drawn, as the renderer makes it and its resize() at load
  // sizes it.
  storeOfBackdrops() {
    if (!this.store) {
      expect(this.isShowing, 'arranging: the window must show the game at some size first').toBe(true);
      this.store = createBackdropCache(this.canvases.createCanvas);
      this.store.rescale(this.scale);
    }
    return this.store;
  }

  // The store's canvasFor as the shell is handed it, each canvas the factory makes meanwhile noted as prepared for that
  // neighbourhood.
  watched(store) {
    const canvasFor = place => {
      const madeBefore = this.canvases.made().length;
      try {
        return store.canvasFor(place);
      } finally {
        for (const { canvas, size, recording } of this.canvases.made().slice(madeBefore)) {
          this.builds.push({ neighbourhood: place.name, size: [size.width, size.height], scaledTo: scaledTo(recording.calls()), moment: this.moment });
          this.builtFor.set(canvas, place.name);
        }
      }
    };
    return canvasFor;
  }

  // One draw on the screen's recording, in the words of the scenarios.
  layerOf([name, ...args]) {
    const { alpha, fillStyle } = args.pop();
    const [what, ...at] = name === 'drawImage' ? args : [fillStyle, ...args];
    let shows;
    if (name === 'drawImage') {
      shows = this.builtFor.has(what) ? `${this.builtFor.get(what)}'s ${Shown.BACKDROP}` : `something that isn't a backdrop (${String(what)})`;
    } else {
      const place = byBackground.get(String(what).toLowerCase());
      shows = place ? `${place.name}'s ${Shown.PLAIN}` : `a fill in ${what}`;
    }
    return { shows, strength: alpha, covers: isDeepStrictEqual(at, [0, 0, W, H]) ? WHOLE_SCREEN : `${at.join(', ')}` };
  }

  // One frame: the shell draws the plan on a fresh recording of the screen, at full strength to start with, as at the
  // start of render.js's draw(). Whatever the shell throws is kept as a failure (it would reach the frame loop and stop
  // the game), and whatever it writes to the console is kept as reported.
  draw(thePlan, moment = 'a frame') {
    const canvasFor = this.watched(this.storeOfBackdrops());
    const screen = createRecordingContext({ offers: SCREEN_CALLS, refused: this.screenRefused });
    const console = globalThis.console;
    const saved = CONSOLE.map(method => console[method]);
    CONSOLE.forEach(method => { console[method] = (...args) => this.reported.push(`${method}: ${args.join(' ')}`); });
    this.moment = moment;
    try {
      showBackdrop(screen.context, thePlan, canvasFor);
    } catch (error) {
      this.failures.push(`${moment}: ${error.message}`);
    } finally {
      CONSOLE.forEach((method, i) => { console[method] = saved[i]; });
    }
    this.onScreen = screen.calls().filter(([name]) => DRAWS.has(name)).map(call => this.layerOf(call));
    for (const { shows } of this.onScreen) {
      const [, place, kind] = /^(.+)'s (backdrop|plain background)$/.exec(shows) ?? [];
      if (place) this.shownAs[place] = kind;
    }
    const left = screen.styles().globalAlpha;
    if (left !== FULL_STRENGTH) this.notPutBack.push(`${moment}: left at ${left}`);
  }

  // The window is resized: the screen is sized again (render.js's resize() rescales the store, whether or not k changed).
  resize(k) {
    this.scale = k;
    this.storeOfBackdrops().rescale(k);
  }

  // How many backdrops have been prepared so far, and a name for the moment the ones since were prepared on: the
  // in-memory game names a frame's moment once the frame is over, from what the page said on it.
  preparedCount() { return this.builds.length; }

  nameMomentsSince(count, moment) {
    for (const build of this.builds.slice(count)) build.moment = moment;
  }

  // ---- acting ----
  showFor(place, seconds) { this.act(() => { for (let i = 0; i < framesIn(seconds); i++) this.draw(plan(place)); }); }

  showOnce(place) { this.act(() => this.draw(plan(place))); }

  showInTurn(places) { this.act(() => places.forEach(place => this.draw(plan(place)))); }

  whenDraws(place, { next, mix }) { this.act(() => this.draw(plan(place, next, mix))); }

  // Resized, then a second of frames with the neighbourhoods on screen: one alone, or the first with the second fading
  // in, half way.
  resizeWith(k, [here, next = null]) {
    this.act(() => {
      this.resize(k);
      for (let i = 0; i < framesIn(1); i++) this.draw(plan(here, next, next ? 0.5 : 0));
    });
  }

  // Shows it, and checks it came out plain, as the arrangement needs.
  showPlain(place) {
    this.showInTurn([place]);
    expect(this.shownAs[place.name], `arranging: ${place.name} should have shown its plain background`).toBe(Shown.PLAIN);
  }

  // ---- observing ----
  // Every Then also holds the guards it doesn't name: nothing thrown, reported or refused, and the strength put back.
  delta(universe, expected) {
    assertStateDelta(this.before, this.after, { universe: [...universe, 'failures', 'reported', 'refused', 'notPutBack'], expected });
  }

  shownAfter(changes) { return setTo({ ...this.before.shown, ...changes }); }

  expectBuilt(places, k = this.scale) {
    this.delta(['built'], { built: appendedWith(...places.map(place => preparedAt(place, k))) });
  }

  expectBuiltAndShown(place, k) {
    this.delta(['built', 'shown'], {
      built: appendedWith(preparedAt(place, k)),
      shown: this.shownAfter({ [place.name]: Shown.BACKDROP }),
    });
  }

  expectBuiltOnceMoreAt(place, k, moment) {
    this.delta(['built', 'builtOn'], {
      built: appendedWith(preparedAt(place, k)),
      builtOn: appendedWith({ neighbourhood: place.name, moment }),
    });
  }

  // Shown plain, and nothing gone wrong since the screen first drew: no failure, report, refusal or strength left out of
  // place in the When, nor before it (a failure in a Given, such as the title's, is seen too).
  expectPlainAndPlaysOn(place) {
    this.delta(['shown', 'onScreen'], {
      shown: this.shownAfter({ [place.name]: Shown.PLAIN }),
      onScreen: setTo([layerOf(place, Shown.PLAIN)]),
    });
    const { failures, reported, refused, notPutBack } = this.after;
    expect({ failures, reported, refused, notPutBack }, 'nothing gone wrong since the screen first drew')
      .toEqual({ failures: [], reported: [], refused: [], notPutBack: [] });
  }

  // Nothing prepared, and each still shown as it was: no change at all.
  expectNotBuiltAgain(places, kind) {
    this.delta(['built', 'shown'], { shown: this.shownAfter(Object.fromEntries(places.map(place => [place.name, kind]))) });
  }

  expectShown(plain, backdrop) {
    this.delta(['shown'], { shown: this.shownAfter({ [plain.name]: Shown.PLAIN, [backdrop.name]: Shown.BACKDROP }) });
  }

  // The last frame, layer by layer: the neighbourhood underneath at full strength, then what is over it, if anything.
  expectOnScreen(underneath, over) {
    this.delta(['onScreen'], { onScreen: setTo(over ? [underneath, over] : [underneath]) });
  }

  // Over everything drawn since the window first showed the game: prepared at exactly these moments, each at size k,
  // each shown as its own backdrop.
  expectBuiltOnlyAt(k, rows) {
    this.delta(['built', 'builtOn', 'shown'], {
      built: setTo(rows.map(({ neighbourhood }) => ({ neighbourhood, size: sizeAt(k), scaledTo: k }))),
      builtOn: setTo(rows.map(({ neighbourhood, moment }) => ({ neighbourhood, moment }))),
      shown: setTo(Object.fromEntries(rows.map(({ neighbourhood }) => [neighbourhood, Shown.BACKDROP]))),
    });
  }
}
