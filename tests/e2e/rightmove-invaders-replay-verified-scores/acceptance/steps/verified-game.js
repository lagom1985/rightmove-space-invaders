import { expect } from '@playwright/test';
import { LeaderboardGame } from '../../../rightmove-invaders-leaderboard/acceptance/steps/leaderboard-game.js';
import { SessionAnswer } from './domain-types.js';

// The leaderboard's page driver (the real page and keyboard, the real function and Blobs client behind
// scripts/serve.mjs, the fake clock, the seeded luck, the page.route dispatcher, the live-region recorder), extended
// for sessions and records (rightmove-invaders-replay-verified-scores):
// - the game's session request (POST /api/sessions) is answered at once, 3 seconds of game time later, with a failure
//   or never, one request at a time; each one sent and answered is noted, with the seed the page sent;
// - each signing the page sends is noted, and a forger can change the deposit in it on its way to the table, as the
//   browser's own tools can (the 2026-10-26 console forgery, once the console can't reach the game);
// - "the table everyone reads" is a GET through the context's own request client, which page.route doesn't intercept;
// - a game can be played in real time, with the page's clock off by an hour and no lenient clock: the only browser
//   scenario that meets the clock check (US-05). Waits are then real, and the fake clock is never moved on.
// Requests to the table's server are counted from the moment Enter starts a game.

const LENIENT_CLOCK = 'test-clock';   // the local server's cookie (leaderboard-game.js sets it on every page)
const LATE_BY_MS = 3000;
const SHOT_SCORES = 50;
const SHOT_FLIGHT_MS = 1000;   // the shot reaches the Damp above the pin within this (leaderboard-game.js)
// The 2026-10-26 forgery from the console (docs/analysis/root-cause-analysis-forged-high-scores.md, Vector B), with the
// deposit of the forgery that PR #4's ceiling would still let through.
const CONSOLE_LINE = "(await import('/src/game/game.js')).g.score = 249950";
const realPause = ms => new Promise(resolve => setTimeout(resolve, ms));
const Kind = Object.freeze({ LOAD: 'load', SESSION: 'session', SIGNING: 'signing' });

export class VerifiedGame extends LeaderboardGame {
  constructor(page, table, baseURL) {
    super(page, table, baseURL);
    this.nextSession = SessionAnswer.AT_ONCE;
    this.sessions = [];      // { seed: what the page sent, session: what the table answered, or null }
    this.bodiesSent = [];    // the bodies of the signings the page sent (the base class's `signings` is its fault mode)
    this.requests = [];      // the kind of every request the page sent to the table's server, in order
    this.requestsAtStart = 0;
    this.lateSession = null; // { route, response, dueInMs }
    this.forgedDeposit = null;
    this.clockOffMs = null;  // set: the page plays in real time, its clock off by this much
  }

  // ---- arranging ----
  async answerNextSession(how) {
    await this.prepare();
    this.nextSession = how;
  }

  async forgeDepositSent(amount) {
    await this.prepare();
    this.forgedDeposit = amount;
  }

  async clockIsOff(offMs) { this.clockOffMs = offMs; }

  async installClock() {
    if (this.clockOffMs === null) return super.installClock();
    await this.page.clock.install({ time: Date.now() + this.clockOffMs });
  }

  async pauseTheClock() {
    if (this.clockOffMs === null) await super.pauseTheClock();
  }

  async wait(ms) {
    if (this.clockOffMs !== null) return realPause(ms);
    if (!this.lateSession) return super.wait(ms);
    const first = Math.min(ms, this.lateSession.dueInMs);
    await super.wait(first);
    this.lateSession.dueInMs -= first;
    if (this.lateSession.dueInMs <= 0) await this.answerLateSession();
    if (ms > first) await this.wait(ms - first);
  }

  async answerLateSession() {
    const { route, response } = this.lateSession;
    this.lateSession = null;
    await route.fulfill({ response }).catch(() => {});   // the page may have given up on it
  }

  // Another computer on the same board: its own context, its own luck (leaderboard-game.js counts the pages), a game of
  // its own to £50, signed.
  async anotherHouseHunterSignsAGame(initials) {
    await this.prepare();
    const context = await this.page.context().browser().newContext({ baseURL: this.baseURL });
    this.table.others.push(context);
    const other = new LeaderboardGame(await context.newPage(), this.table, this.baseURL);
    await other.depositMakesTheTable(SHOT_SCORES);
    await other.signAs(initials);
    await other.expectTold(new RegExp(`Signed ${initials}, #\\d+\\.`));
  }

  // ---- acting ----
  async startPlaying() {
    this.requestsAtStart = this.requests.length;
    await super.startPlaying();
  }

  async pressEnter() {
    this.requestsAtStart = this.requests.length;
    await super.pressEnter();
  }

  // Enter, then Space at once: the shot is fired whatever the session request is doing.
  async startAndFire() {
    this.requestsAtStart = this.requests.length;
    await this.mark();
    await this.press('Enter');
    await this.press('Space');
  }

  // The module is imported first, as the line does, so a module that fails to load can't pass for "no game in play".
  async runConsoleLine() {
    this.console = await this.page.evaluate(async line => {
      let module;
      try { module = await import('/src/game/game.js'); } catch (error) { return { loaded: false, said: `import threw ${error.name}` }; }
      const exportsAGame = typeof module.g === 'object' && module.g !== null;
      try { await (0, eval)(`(async () => { ${line}; })()`); return { loaded: true, exportsAGame, said: 'ran' }; } catch (error) {
        return { loaded: true, exportsAGame, said: `threw ${error.name}` };
      }
    }, CONSOLE_LINE);
    await this.wait(10 * 17);
  }

  // A whole game in real time: Enter, one shot at the Damp, then standing still until the hurdles win, then signed.
  async playInRealTimeAndSign(deposit, initials) {
    expect(this.clockOffMs, 'arranging: the page plays in real time only once its clock is set').not.toBeNull();
    await this.prepare();
    await this.page.context().clearCookies({ name: LENIENT_CLOCK });
    await this.finishGameWith(deposit);
    await this.signAs(initials);
  }

  // ---- the network boundary ----
  async dispatch(route) {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    this.requests.push(request.method() === 'POST' ? (path.endsWith('/sessions') ? Kind.SESSION : Kind.SIGNING) : Kind.LOAD);
    return super.dispatch(route);
  }

  async dispatchSession(route) {
    const how = this.nextSession;
    this.nextSession = SessionAnswer.AT_ONCE;
    if (how === SessionAnswer.AT_ONCE && this.loads !== 'pass') return super.dispatchSession(route);   // the leaderboard's faults
    this.loadsSent++;
    const sent = { seed: route.request().postDataJSON()?.seed, session: null };
    this.sessions.push(sent);
    if (how === SessionAnswer.FAILS) return route.abort('failed');
    if (how === SessionAnswer.NEVER) return undefined;
    const response = await route.fetch();
    sent.session = await response.json().then(body => body?.session ?? null, () => null);
    if (how === SessionAnswer.LATE) { this.lateSession = { route, response, dueInMs: LATE_BY_MS }; return undefined; }
    return route.fulfill({ response });
  }

  async dispatchSigning(route) {
    const body = route.request().postDataJSON();
    this.bodiesSent.push(body);
    if (this.forgedDeposit === null) return super.dispatchSigning(route);
    this.postsSent++;
    const response = await route.fetch({ postData: JSON.stringify({ ...body, score: this.forgedDeposit }) });
    await route.fulfill({ response });
    this.postsHandled++;
    return undefined;
  }

  // ---- asserting ----
  async expectFirstShotScored() {
    await this.wait(SHOT_FLIGHT_MS);
    await expect(this.page.locator('[data-hud="deposit"]'), 'the first shot, fired as the game started').toHaveText(`£${SHOT_SCORES}`);
  }

  expectConsoleFoundNoGame() {
    expect(this.console.loaded, `the console couldn't load the game's code: ${this.console.said}`).toBe(true);
    expect(this.console.exportsAGame, 'the game\'s module exports the game in play').toBe(false);
    expect(this.console.said, 'what the console line did').toBe('threw TypeError');
  }

  async expectSigningCarriedThisGamesSession() {
    const signing = this.bodiesSent.at(-1);
    const { seed, session } = this.sessions.at(-1) ?? {};
    expect(signing, 'the page never sent a signing').toBeDefined();
    expect(session, 'the table never answered this game\'s session request').toBeTruthy();
    expect(session.seed, 'the session is for the seed the game sent').toBe(seed);
    expect(signing.session, 'the signing carried this game\'s session').toEqual(session);
  }

  expectOneRequestForTheGame() {
    expect(this.requests.slice(this.requestsAtStart), 'requests to the table\'s server from Enter to game over').toEqual([Kind.SESSION]);
  }

  expectSigningNeverSent() {
    expect(this.bodiesSent, 'signings the page sent').toEqual([]);
  }

  async rowsEveryoneReads() {
    const answer = await this.page.context().request.get('/api/scores');
    expect(answer.ok(), `the table everyone reads answered ${answer.status()}`).toBe(true);
    return (await answer.json()).scores.map(({ initials, score }) => ({ initials, score }));
  }

  async expectEveryoneReads(initials, score) {
    await expect.poll(() => this.rowsEveryoneReads(), { message: `${initials} with £${score} on the table everyone reads` }).toContainEqual({ initials, score });
  }

  async expectEveryoneReadsNo(initials) {
    const rows = await this.rowsEveryoneReads();
    expect(rows.length, 'the table everyone reads has no rows, so a negative about it proves nothing').toBeGreaterThan(0);
    expect(rows.filter(row => row.initials === initials), `rows for ${initials}`).toEqual([]);
  }

  async expectDepositShown(text) {
    await this.wait(10 * 17);
    await expect(this.page.locator('[data-hud="deposit"]'), `the console said: ${this.console?.said}`).toHaveText(text);
  }
}
