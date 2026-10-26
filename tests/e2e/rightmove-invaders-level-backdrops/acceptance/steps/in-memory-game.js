import { isDeepStrictEqual } from 'node:util';
import { expect } from '@playwright/test';
import { loadFreshGame, arrange } from '../../../../unit/support/fresh-game.js';
import { createFakeStatusRoot } from '../../../../unit/support/fake-status-root.js';
import { assertStateDelta, appendedWith, setTo, satisfying } from '../../../../common/state-delta.js';
import { createStatus } from '../../../../../src/view/status.js';
import { backdropPlan } from '../../../../../src/view/backdrop.js';
import { STEP } from '../../../../../src/game/config.js';
import { LADDER, NEIGHBOURHOODS, PreparedMoment, ladderName, neighbourhood, waveCalled } from './domain-types.js';

// The in-memory composition root for the level backdrops (layer 2): the game's rules on their own (a fresh copy of
// src/game/game.js), the real status mirror (src/view/status.js) over the stand-in for the page's status section
// (tests/unit/support/fake-status-root.js), and the backdrop each frame would show (backdropPlan, src/view/backdrop.js).
// It plays a frame in the order main.js does, a fixed step per frame: the frame's key presses, one update unless
// paused, the events taken, the backdrop drawn, the mirror synced. It stands in for main.js's loop and render.js and is
// neither: one step per frame (main.js may run several), and only the backdrop is drawn. When the window shows the game
// (screen.isShowing), each frame makes the call DESIGN gives render.js, showBackdrop(context, backdropPlan(frame),
// store.canvasFor), through the screen (screen-backdrops.js), on a recording of the screen's context. That render.js makes that
// call is DELIVER's, and is checked by hand (waiver D10).
//
// The frame the plan is handed is { level, state, banner, paused }, frozen: what the renderer reads of g, the pause
// included, which the plan must ignore (DESIGN's plan table: "Paused, in any state: as the state underneath"). A fade is
// matched to within 0.0005 of its mix (the features' "nearest twentieth of a percent"). A wave is cleared by leaving one
// hurdle with the shot on it (arrange.lastHurdleShot), and a new wave plays SETTLE (half a second) after its arrival.
// Each frame a backdrop is prepared on is named afterwards, from what the live region was written on that frame and
// the ladder field (the ports), never from g: "Press Enter to start" is the title, "Wave cleared!" a wave cleared,
// "Game started" a new game; a frame just after a resize is named for the resize.
//
// Universe, read only at the ports: `heard` (every write to the live region), `ladder` and `neighbourhood` (the
// data-hud fields), `backdrop` (the plan for the last frame: { here, next, mix }, by name). How it reads the rules: the
// frame above, and each move's own checks that the game is where the move needs it, read g directly (level, state,
// banner, paused), as the views do under the DDD-T14 waiver; game over and the start of a game are read through
// snapshot(). The rules are written to only to ARRANGE a wave cleared, a home lost or a game lost, through
// tests/unit/support/fresh-game.js's checked `arrange.lastHurdleShot`, `arrange.boltOnPin` and `arrange.formationOnPin`,
// as the other in-memory features do.

const NO_KEYS = Object.freeze({ isDown: () => false });
const framesIn = seconds => Math.round(seconds / STEP);
const SETTLE = framesIn(0.5);      // a new wave plays this long after its arrival: its first bolt comes after 1 s
const GUARD = framesIn(0.7);       // Enter plays again only 0.6 s after game over
const PLENTY = framesIn(5);        // more frames than any banner or respawn takes
const byName = place => place?.name ?? place ?? null;

export class InMemoryGame {
  static async fresh(screen) { return new InMemoryGame(await loadFreshGame(), screen); }

  constructor(rules, screen) {
    this.rules = rules;
    this.screen = screen;
    this.page = createFakeStatusRoot();
    this.sync = createStatus(this.page.root);
    this.fields = Object.fromEntries(this.page.root.querySelectorAll('[data-hud]').map(field => [field.dataset.hud, field]));
    this.frames = 0;
    this.resized = false;
    this.arranged = null;      // a frame shown without the rules, for the plan's own limits
    this.before = null;
    this.after = null;
  }

  get g() { return this.rules.g; }

  // The frame the renderer reads, frozen, or the one arranged without the rules.
  frameView() {
    return this.arranged ?? Object.freeze({ level: this.g.level, state: this.g.state, banner: this.g.banner, paused: this.g.paused });
  }

  observe() {
    return { heard: this.page.heard(), ladder: this.fields.ladder.textContent, neighbourhood: this.fields.neighbourhood.textContent, frame: this.frameView() };
  }

  // What the screen shows behind the game on a frame, by name.
  backdropOf(frame) {
    const { here, next, mix } = backdropPlan(frame);
    return { here: byName(here), next: byName(next), mix };
  }

  // One action, observed before and after (the screen's store too); the Thens compare the two.
  act(action) {
    this.before = this.observe();
    this.screen.act(action);
    this.after = this.observe();
  }

  // ---- one frame, in main.js's order ----
  frame(pressed = []) {
    const saidBefore = this.page.heard().length, preparedBefore = this.screen.preparedCount(), resized = this.resized;
    this.rules.handlePresses(new Set(pressed));
    if (!this.g.paused) this.rules.update(STEP, NO_KEYS);
    this.rules.takeEvents();
    if (this.screen.isShowing) this.draw();
    this.sync(this.g);
    this.screen.nameMomentsSince(preparedBefore, this.momentOf(this.page.heard().slice(saidBefore), resized));
    this.frames++;
  }

  run(frames, until = () => false) {
    for (let i = 0; i < frames && !until(); i++) this.frame();
  }

  // The backdrop's part of the frame: the real plan, drawn by the real shell through the screen.
  draw() {
    this.screen.draw(backdropPlan(this.frameView()));
    this.resized = false;
  }

  // Which moment a frame was, in the words of the moments a backdrop may be prepared on (DDD-B3), from what the page
  // said on it and its ladder field: never from the rules' state.
  momentOf(said, resized) {
    const rung = this.fields.ladder.textContent;
    if (resized) return PreparedMoment.AFTER_RESIZE;
    if (said.some(sentence => sentence.includes('Press Enter to start'))) return PreparedMoment.TITLE;
    if (said.some(sentence => sentence.includes('Wave cleared!'))) return PreparedMoment.waveCleared(waveCalled(LADDER.indexOf(rung)));
    if (said.some(sentence => sentence.includes('Game started'))) return PreparedMoment.NEW_GAME;
    return `during a moment at ${rung}${said.length ? `, when the page said "${said.join(' ')}"` : ''}`;
  }

  // ---- the moves, each checking as it goes that the game is where the move needs it ----
  load() {
    expect(this.frames, 'arranging: the game loads once').toBe(0);
    this.frame();
  }

  startClimbing() {
    if (this.frames === 0) this.load();
    expect(this.g.state, 'arranging: a climb starts from the title').toBe('title');
    this.frame(['Enter']);
    this.frame();
    expect({ screen: this.rules.snapshot().screen, level: this.g.level }, 'arranging: a game should have started').toEqual({ screen: 'play', level: 0 });
  }

  clearWave(level) {
    expect({ state: this.g.state, level: this.g.level }, `arranging: the ${waveCalled(level)} wave should be in play`).toEqual({ state: 'play', level });
    arrange.lastHurdleShot(this.rules);
    this.frame();
    expect(this.g.state, `arranging: the ${waveCalled(level)} wave should be cleared`).toBe('clear');
  }

  passBanner(seconds) {
    this.run(framesIn(seconds));
    expect(this.g.state, `arranging: "Wave cleared!" should still show after ${seconds} s`).toBe('clear');
  }

  endBanner() {
    this.run(PLENTY, () => this.g.state !== 'clear');
    expect(this.g.state, 'arranging: the next wave should have started').toBe('play');
  }

  moveUp(level) {
    this.clearWave(level - 1);
    this.endBanner();
    this.run(SETTLE);
    expect(this.g.level, `arranging: should be playing the ${waveCalled(level)} wave`).toBe(level);
  }

  climbTo(level) {
    if (this.g.state === 'title') this.startClimbing();
    while (this.g.level < level) this.moveUp(this.g.level + 1);
    expect({ state: this.g.state, level: this.g.level }, `arranging: should be playing the ${waveCalled(level)} wave`).toEqual({ state: 'play', level });
  }

  loseAHome() {
    arrange.boltOnPin(this.rules);
    this.frame();
    expect(this.g.state, 'arranging: a home should have been lost').toBe('dead');
  }

  loseAHomeAndComeBack() {
    this.loseAHome();
    this.run(PLENTY, () => this.g.state !== 'dead');
    this.run(SETTLE);
    expect(this.g.state, 'arranging: the pin should be back').toBe('play');
  }

  loseTheGame() {
    arrange.formationOnPin(this.rules);
    this.frame();
    expect(this.rules.snapshot().screen, 'arranging: the game should be over').toBe('over');
  }

  playAgain() {
    this.run(GUARD);
    this.frame(['Enter']);
    this.frame();
    expect({ screen: this.rules.snapshot().screen, level: this.g.level }, 'arranging: a new game should have started').toEqual({ screen: 'play', level: 0 });
  }

  pauseFor(seconds) {
    this.frame(['KeyP']);
    this.run(framesIn(seconds) - 1);
    expect(this.g.paused, 'arranging: the game should be paused').toBe(true);
  }

  pauseAndResume() {
    this.frame(['KeyP']);
    this.frame();
    this.frame(['KeyP']);
    this.run(SETTLE);
    expect(this.g.paused, 'arranging: the game should be running again').toBe(false);
  }

  resizeHalfWayThroughBanner(k) {
    this.run(PLENTY, () => this.g.banner <= this.rules.BANNER_TIME / 2);
    this.screen.resize(k);
    this.resized = true;
    this.endBanner();
    this.run(SETTLE);
  }

  // ---- the steps' acts ----
  whenLoads() { this.act(() => this.load()); }
  whenStartsClimbing() { this.act(() => this.startClimbing()); }
  whenClimbsTo(level) { this.act(() => this.climbTo(level)); }
  whenMovesUpTo(level) { this.act(() => this.moveUp(level)); }
  whenClearsWave(level) { this.act(() => this.clearWave(level)); }
  whenBannerPasses(seconds) { this.act(() => this.passBanner(seconds)); }
  whenBannerEnds() { this.act(() => this.endBanner()); }
  whenPausesFor(seconds) { this.act(() => this.pauseFor(seconds)); }
  whenPausesAndResumes() { this.act(() => this.pauseAndResume()); }
  whenLosesAHome() { this.act(() => this.loseAHome()); }
  whenLosesAHomeAndComesBack() { this.act(() => this.loseAHomeAndComeBack()); }
  whenLosesTheGame() { this.act(() => this.loseTheGame()); }
  whenPlaysAgain() { this.act(() => this.playAgain()); }
  whenResizedHalfWayThroughBanner(k) { this.act(() => this.resizeHalfWayThroughBanner(k)); }

  // A "Wave cleared!" frame the rules never produce (the banner past its ends), for the plan's own limits.
  whenWaveClearedShows(level, bannerLeft) {
    this.act(() => { this.arranged = Object.freeze({ level, state: 'clear', banner: bannerLeft, paused: false }); });
  }

  // The ladder and the neighbourhoods, side by side, level by level, up to two levels past the longer table (both are
  // read by level and stop at their last entry, DDD-B12): a pure read of the theme's two tables.
  whenLadderBesideNeighbourhoods() {
    this.act(() => {
      const levels = Math.max(LADDER.length, NEIGHBOURHOODS.length) + 2;
      this.sideBySide = Array.from({ length: levels }, (_, level) => ({ rung: ladderName(level), neighbourhood: neighbourhood(level).name }));
    });
  }

  // ---- observing ----
  delta(universe, expected) { assertStateDelta(this.before, this.after, { universe, expected }); }

  expectAt(rung, place) {
    this.delta(['ladder', 'neighbourhood'], { ladder: setTo(rung), neighbourhood: setTo(place) });
  }

  expectHeardOnly(sentence) { this.delta(['heard'], { heard: appendedWith(sentence) }); }

  expectHeard(first, then) { this.delta(['heard'], { heard: appendedWith(first, then) }); }

  // The backdrop on the last frame of the When.
  expectBackdrop(place, fade) {
    const shows = { backdrop: this.backdropOf(this.after.frame) };
    assertStateDelta({ backdrop: null }, shows, { universe: ['backdrop'], expected: { backdrop: this.showing(place, fade) } });
  }

  // The backdrop on the last frame of the When is the one on the first: it has held.
  expectBackdropHeld(place, fade) {
    const held = this.showing(place, fade);
    assertStateDelta({ backdrop: this.backdropOf(this.before.frame) }, { backdrop: this.backdropOf(this.after.frame) }, {
      universe: ['backdrop'],
      expected: { backdrop: satisfying(`held at ${held.description}`, (was, now) => isDeepStrictEqual(was, now) && held.holds(was, now)) },
    });
  }

  showing(place, { next, mix, text }) {
    return satisfying(`${place.name}, with ${text}`, (_, shown) => shown.here === place.name && shown.next === byName(next)
      && Math.abs(shown.mix - mix) <= 0.0005);
  }

  // Each rung is paired with exactly one neighbourhood and each neighbourhood with exactly one rung, the names in each
  // table are all different, and every neighbourhood is reached: so six rungs, six places, one to one.
  expectOneNeighbourhoodPerRung() {
    const partners = (from, to) => {
      const found = new Map();
      for (const pair of this.sideBySide) found.set(pair[from], new Set([...(found.get(pair[from]) ?? []), pair[to]]));
      return [...found].filter(([, others]) => others.size !== 1).map(([name, others]) => `${name}: ${[...others].join(', ')}`);
    };
    const places = NEIGHBOURHOODS.map(({ name }) => name);
    expect({
      rungsWithoutOneNeighbourhood: partners('rung', 'neighbourhood'),
      neighbourhoodsWithoutOneRung: partners('neighbourhood', 'rung'),
      differentRungNames: new Set(LADDER).size,
      differentNeighbourhoodNames: new Set(places).size,
      neighbourhoodsNeverReached: places.filter(name => !this.sideBySide.some(pair => pair.neighbourhood === name)),
    }).toEqual({
      rungsWithoutOneNeighbourhood: [],
      neighbourhoodsWithoutOneRung: [],
      differentRungNames: LADDER.length,
      differentNeighbourhoodNames: LADDER.length,
      neighbourhoodsNeverReached: [],
    });
  }
}
