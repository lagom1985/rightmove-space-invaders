import { expect } from '@playwright/test';
import {
  Message, SigningStatus, SigningTrouble, START, OTHER_HOUSE_HUNTERS,
} from './domain-types.js';

// Drives the real game page with real key presses, against the real high-score table: scripts/serve.mjs answers
// /api/scores with the real Netlify Function and the real Blobs client on the local emulator, one table per
// `test-board` cookie (docs/architecture/atdd-infrastructure-policy.md).
// - Game time is Playwright's fake clock and Math.random is seeded, so every run plays the same game. The client's
//   5000 ms timeout runs on the same clock (DDD-13), so the clock is never moved on while an answer is being held.
// - Faults between the page and the table come from one page.route dispatcher on /api/scores (DDD-16): a load or a
//   signing can fail, be held with no answer, or (a load) be looked up at once and handed over late. Other
//   house-hunters sign through the context's own request client, which page.route doesn't intercept. The dispatcher
//   also counts the loads and the signings the page sends, so "it tried to refresh" and "it sent the signing once"
//   are observable.
// - What the game says is read from the live region (role=status), and every change to it is recorded by a
//   MutationObserver installed before the page loads, so "the game tells me" also sees a message that a later one
//   replaced, and the announcement cadence can be counted. "Since" is always since the driver's last action.
// - Givens arrange; they never assert the outcome text under test. A Given that must wait for an answer waits for the
//   network (the dispatcher's counters), then lets a few frames run so the page has taken the answer in.
// The player can only play a deposit of £0 or £50: one shot at the Damp straight above the pin, then standing still.

const FRAME_MS = 17;              // one display frame at 60 Hz
const SHOT_FLIGHT_MS = 1000;      // the shot reaches the Damp above the pin within this
const SETTLE_MS = 700;            // Enter restarts a game only 0.6 s after game over
const SETTLE_FRAMES = 10;         // frames the page needs to take an answer in
const MAX_GAME_MS = 600_000;
const WAIT_FRAMES = 200;          // up to 3.4 s of game time for an answer to arrive and show
const REAL_PAUSE_MS = 15;         // real time between those frames
const PAUSE_AT_MS = 5000;         // the page's clock is paused this long after START, once the page has asked for the table
const PAUSE_LEAD_MS = 1000;       // or this far ahead of the page's clock, if that is later
const SEED = 20261023;
const BOARD_COOKIE = 'test-board';
const SCORES = '/api/scores';

const Load = Object.freeze({ PASS: 'pass', FAIL: 'fail', LATE: 'late', HOLD: 'hold' });
const Signing = Object.freeze({ PASS: 'pass', FAIL: 'fail', HOLD: 'hold' });
const matches = (text, wanted) => (typeof wanted === 'string' ? text.includes(wanted) : wanted.test(text));
const realPause = ms => new Promise(resolve => setTimeout(resolve, ms));   // Node time, not the page's

export class LeaderboardGame {
  constructor(page, table, baseURL) {
    this.page = page;
    this.table = table;      // the scenario's own board (fixtures.js), shared with the walking skeleton's steps
    this.baseURL = baseURL;
    this.loads = Load.PASS;
    this.signings = Signing.PASS;
    this.held = [];          // signings waiting for an answer
    this.late = null;        // a load already looked up, waiting to be handed over
    this.expectingLate = false;
    this.loadsSent = 0;      // GETs the page has sent
    this.loadsSentWhenFaulted = 0;
    this.postsSent = 0;      // POSTs the page has sent
    this.postsHandled = 0;   // POSTs the dispatcher has finished with (answered, failed or turned away)
    this.othersSigned = 0;
    this.prepared = false;
    this.opened = false;
    this.playing = false;
    this.markAt = 0;
    this.lastTold = null;
  }

  // ---- arranging ----
  async prepare() {
    if (this.prepared) return;
    this.prepared = true;
    await this.page.context().addCookies([{ name: BOARD_COOKIE, value: this.table.board, url: this.baseURL }]);
    await this.page.route(`**${SCORES}*`, route => this.dispatch(route));
  }

  async open() {
    if (this.opened) return;
    await this.prepare();
    await this.page.addInitScript(seed => {
      let a = seed;   // mulberry32
      Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }, SEED);
    await this.page.addInitScript(() => {
      window.__announced = [];
      document.addEventListener('DOMContentLoaded', () => {
        const live = document.querySelector('[role="status"]');
        new MutationObserver(() => window.__announced.push(live.textContent)).observe(live, { childList: true, characterData: true, subtree: true });
      });
    });
    await this.page.clock.install({ time: START });
    await this.page.goto('/');
    // The page-load request must have been seen before any later fault takes its count, or expectRefreshAttempted could
    // mistake the page load for a refresh.
    await expect.poll(() => this.loadsSent, { message: 'the page never asked for the table on load' }).toBeGreaterThanOrEqual(1);
    await this.pauseTheClock();
    await this.frame();
    this.table.viewer = this.page;   // the walking skeleton's "topped by" step reads the table here
    this.opened = true;
  }

  // The page's clock runs in real time from install until it is paused, and a pause can't go back in time. It pauses at
  // START + PAUSE_AT_MS, as it always has, unless a busy machine took so long to load the page and ask for the table
  // that the page's clock is within PAUSE_LEAD_MS of that or past it: then PAUSE_LEAD_MS ahead of the page's clock,
  // which covers the time the pause takes to reach the page.
  async pauseTheClock() {
    const pageNow = await this.page.evaluate(() => Date.now());
    await this.page.clock.pauseAt(Math.max(START.getTime() + PAUSE_AT_MS, pageNow + PAUSE_LEAD_MS));
  }

  async signTheTable(initials, score) {
    await this.prepare();
    const answer = await this.page.context().request.post(SCORES, { data: { initials, score } });
    expect(answer.ok(), `arranging: ${initials} could not sign the table (${answer.status()})`).toBe(true);
  }

  async seedSignatures(count, score) {
    for (let i = 0; i < count; i++) await this.signTheTable(OTHER_HOUSE_HUNTERS[this.othersSigned++ % OTHER_HOUSE_HUNTERS.length], score);
  }

  async anotherHouseHunterSigns(score) { await this.seedSignatures(1, score); }

  // Both faults remember how many loads the page had sent when they began (open() has waited for the page load's).
  async tableCannotBeReached() {
    await this.prepare();
    this.loads = Load.FAIL;
    this.signings = Signing.FAIL;
    this.loadsSentWhenFaulted = this.loadsSent;
  }

  // From now on a load is sent and never answered (the page's own 5000 ms timeout has to give up on it).
  async tableStopsAnsweringLoads() {
    await this.prepare();
    this.loads = Load.HOLD;
    this.loadsSentWhenFaulted = this.loadsSent;
  }

  async holdSignings() {
    await this.prepare();
    this.signings = Signing.HOLD;
  }

  async troubleWhenSigning(trouble) {
    await this.prepare();
    this.signings = trouble;
  }

  async nextTableArrivesLate() {
    await this.prepare();
    this.loads = Load.LATE;
    this.expectingLate = true;
  }

  async depositMakesTheTable(deposit) {
    await this.finishGameWith(deposit);
    await this.expectAskedForInitials();
  }

  // Arranges a signing of `initials` that ended in `status`. Nothing is asserted about what the game says.
  // OFF_THE_TABLE needs a full table: the scenario says so in its own Given ("the high-score table holds 9 signatures").
  async signingIs(initials, status) {
    await this.depositMakesTheTable(50);
    if (status === SigningStatus.ON_ITS_WAY) await this.holdSignings();
    if (status === SigningStatus.UNCONFIRMED) await this.troubleWhenSigning(SigningTrouble.DROPPED);
    if (status === SigningStatus.OFF_THE_TABLE) await this.anotherHouseHunterSigns(1000);
    await this.signAndLetItSettle(initials);
  }

  async signingConfirmedDuringNextGame(initials) {
    await this.signingIs(initials, SigningStatus.ON_ITS_WAY);
    await this.startNewGame();
    await this.answerSigning();
  }

  async signingAnswered() { await this.answerSigning(); }

  // ---- acting ----
  async finishGameWith(deposit) {
    expect([0, 50], 'this driver plays a deposit of £0 or £50 (one shot at the Damp above the pin)').toContain(deposit);
    await this.open();
    await this.mark();
    if (!this.playing) await this.startPlaying();
    if (deposit) await this.fire();
    await this.standStillUntilGameOver();
  }

  async startPlaying() {
    await this.press('Enter');
    await this.expectTold(Message.GAME_STARTED);
    this.playing = true;
  }

  async startNewGame() {
    await this.mark();
    await this.startPlaying();
  }

  async fire() {
    await this.press('Space');
    await this.wait(SHOT_FLIGHT_MS);
    await expect(this.page.locator('[data-hud="deposit"]'), 'arranging: the shot missed the Damp').toHaveText('£50');
  }

  async standStillUntilGameOver() {
    for (let t = 0; t < MAX_GAME_MS && !(await this.announcement()).includes(Message.GAME_OVER); t += 10_000) await this.wait(10_000);
    await expect(this.status()).toContainText(Message.GAME_OVER);
    this.playing = false;
    await this.wait(SETTLE_MS);
  }

  async signAs(initials) {
    await this.mark();
    this.signedAs = initials;
    await this.enterLetters(initials);
  }

  // Signs, then waits for the network to finish with the signing (unless it is held), and for the page to take it in.
  async signAndLetItSettle(initials) {
    const sentBefore = this.postsSent;
    await this.signAs(initials);
    await expect.poll(() => this.postsSent, { message: 'the signing never left the page' }).toBeGreaterThan(sentBefore);
    if (this.signings === Signing.HOLD) return;   // nothing to settle, and the 5000 ms clock is running: let no time pass
    await expect.poll(() => this.postsHandled, { message: 'the signing was never dealt with' }).toBeGreaterThanOrEqual(this.postsSent);
    await this.wait(SETTLE_FRAMES * FRAME_MS);
  }

  // Typed (rightmove-invaders-typed-initials). Every caller has let SETTLE_MS of game over pass first, so the typed
  // entry's 0.6 s stray-key guard is over.
  async enterLetters(letters) {
    await this.typeLettersAndSign(letters);
  }

  // Typed initials (rightmove-invaders-typed-initials): each letter as a player types it, lowercase, then Enter.
  async typeLettersAndSign(letters) {
    for (const letter of letters.toLowerCase()) await this.press(letter);
    await this.press('Enter');
  }

  async pressEnter() {
    await this.mark();
    await this.press('Enter');
  }

  async waitWithoutAnswer(ms) {
    await this.mark();
    await this.wait(ms);
  }

  // The held signing reaches the real table now. When a load was looked up late, the signing is listed after it.
  async answerSigning() {
    await this.mark();
    if (this.expectingLate) await expect.poll(() => this.late !== null, { message: 'the refresh for the new game never reached the table' }).toBe(true);
    await realPause(5);   // listedAt has millisecond resolution: the signing's listing must come strictly later
    const route = this.held.shift();
    expect(route, 'no signing is waiting for an answer').toBeDefined();
    this.signings = Signing.PASS;
    await this.passOn(route);
    await this.wait(SETTLE_FRAMES * FRAME_MS);
  }

  async lateTableArrives() {
    await this.mark();
    expect(this.late, 'no table is waiting to be handed over').not.toBeNull();
    const { route, response } = this.late;
    await route.fulfill({ response });
  }

  async press(key) {
    await this.page.keyboard.press(key);
    await this.frame();
  }

  async frame() { await this.wait(FRAME_MS); }

  async wait(ms) { await this.page.clock.runFor(Math.round(ms)); }

  async mark() { this.markAt = (await this.heard()).length; }

  // ---- the network boundary ----
  async dispatch(route) {
    try {
      const method = route.request().method();
      if (method === 'GET') return await this.dispatchLoad(route);
      if (method === 'POST') return await this.dispatchSigning(route);
      return await route.continue();
    } catch {
      // the page gave up on the request (the 5000 ms timeout) or the scenario ended while it was held
    }
  }

  async dispatchLoad(route) {
    this.loadsSent++;
    if (this.loads === Load.FAIL) return route.abort('failed');
    if (this.loads === Load.HOLD) return undefined;   // never answered
    if (this.loads !== Load.LATE) return route.continue();
    this.loads = Load.PASS;
    this.late = { route, response: await route.fetch() };
  }

  async dispatchSigning(route) {
    this.postsSent++;
    switch (this.signings) {
      case Signing.FAIL: await route.abort('failed'); break;
      case Signing.HOLD: this.held.push(route); return;
      case SigningTrouble.DROPPED: await route.abort('connectionreset'); break;
      case SigningTrouble.TURNED_AWAY: await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'not-saved' }) }); break;
      default: await this.passOn(route); return;
    }
    this.postsHandled++;
  }

  // The real table answers, and the answer is handed to the page (so the driver knows when it is done).
  async passOn(route) {
    const response = await route.fetch();
    await route.fulfill({ response });
    this.postsHandled++;
  }

  // ---- observing ----
  status() { return this.page.getByRole('status'); }

  list() { return this.page.getByRole('list', { name: 'High scores' }); }

  rows() { return this.list().getByRole('listitem'); }

  markedRows() { return this.list().locator('li[aria-current="true"]'); }

  initialsField() { return this.page.locator('[data-hud="initials"]'); }

  async announcement() { return (await this.status().textContent()) ?? ''; }

  async heard() { return this.page.evaluate(() => window.__announced ?? []); }

  async heardSinceMark() { return (await this.heard()).slice(this.markAt); }

  async said() { return [...(await this.heardSinceMark()), await this.announcement()]; }

  // Lets frames run until `holds()` is true or WAIT_FRAMES have passed; the caller then asserts. The page only takes
  // an answer in on a frame, and the network answers in real time, so each frame is followed by a short real pause
  // (at most about 3 s of real time, and 3.4 s of game time: less than the client's 5000 ms timeout).
  async until(holds) {
    for (let i = 0; i < WAIT_FRAMES && !(await holds()); i++) {
      await this.frame();
      await realPause(REAL_PAUSE_MS);
    }
  }

  // A negative ("nothing is marked", "X is gone") only means something while the list is showing other rows.
  async expectListShowsRows() {
    await this.until(async () => (await this.rows().count()) >= 1);
    expect(await this.rows().count(), 'the list shows no rows, so a negative about it proves nothing').toBeGreaterThanOrEqual(1);
  }

  // ---- asserting ----
  async expectTold(wanted) {
    this.lastTold = wanted;
    await this.until(async () => (await this.said()).some(text => matches(text, wanted)));
    const said = await this.said();
    expect(said.some(text => matches(text, wanted)), `the game never said ${wanted}; it said ${JSON.stringify(said)}`).toBe(true);
  }

  async expectAskedForInitials() { await this.expectTold(Message.INITIALS_PROMPT); }

  async expectNotAskedForInitials() {
    await this.expectTold(Message.GAME_OVER);
    expect((await this.said()).filter(text => text.includes('Enter your initials')), 'asked for initials').toEqual([]);
  }

  async expectNewGame() { await this.expectTold(Message.GAME_STARTED); }

  async expectAnnouncedOnce() {
    const times = (await this.heard()).filter(text => matches(text, this.lastTold));
    expect(times, `${this.lastTold} announced`).toHaveLength(1);
  }

  async expectInitialsField(text) {
    await this.until(async () => (await this.initialsField().count()) > 0 && (await this.initialsField().textContent()) === text);
    await expect(this.initialsField()).toHaveText(text, { timeout: 1000 });
  }

  async expectMarkedAsMine(initials) {
    await this.until(async () => (await this.markedRows().count()) === 1 && (await this.markedRows().textContent()).includes(initials));
    await expect(this.markedRows(), 'rows marked as mine').toHaveCount(1, { timeout: 1000 });
    await expect(this.markedRows()).toContainText(initials, { timeout: 1000 });
  }

  async expectNothingMarked() {
    await this.expectListShowsRows();
    await this.until(async () => (await this.markedRows().count()) === 0);
    await expect(this.markedRows(), 'rows marked as mine').toHaveCount(0, { timeout: 1000 });
  }

  async expectRowCount(count) {
    await this.until(async () => (await this.rows().count()) === count);
    await expect(this.rows()).toHaveCount(count, { timeout: 1000 });
  }

  // "No table is shown": the list is on the page, and has no rows.
  async expectNoTableShown() {
    await expect(this.page.locator('[data-leaderboard]'), 'the High scores list is missing from the page').toBeAttached();
    await this.expectRowCount(0);
  }

  async expectNotOnTable(initials) {
    await this.expectListShowsRows();
    await this.until(async () => !(await this.rows().allTextContents()).some(text => text.includes(initials)));
    expect(await this.rows().allTextContents(), `${initials} is still on the table`).not.toContainEqual(expect.stringContaining(initials));
  }

  async expectGameOverWithout(initials) {
    await this.expectTold(Message.GAME_OVER);
    const gameOver = (await this.said()).filter(text => text.includes(Message.GAME_OVER));
    expect(gameOver.filter(text => text.includes(initials)), `the game-over message mentions ${initials}`).toEqual([]);
  }

  async expectNeverToldUnavailable() {
    const heard = await this.heard();
    expect(heard.length, 'the game said nothing at all, so a negative about what it said proves nothing').toBeGreaterThan(0);
    expect(heard.filter(text => text.includes(Message.TABLE_UNAVAILABLE)), 'said the table was unavailable').toEqual([]);
  }

  // The page asked for the table again after the table was made to fail or hang (the refresh when a game starts, DDD-7).
  async expectRefreshAttempted() {
    await this.until(async () => this.loadsSent > this.loadsSentWhenFaulted);
    expect(this.loadsSent, 'the game never asked the table for a refresh').toBeGreaterThan(this.loadsSentWhenFaulted);
  }

  // No POST retry (ADR-008): one signing, one request.
  async expectSigningSentOnce() {
    expect(this.postsSent, 'signing requests the page sent').toBe(1);
  }
}
