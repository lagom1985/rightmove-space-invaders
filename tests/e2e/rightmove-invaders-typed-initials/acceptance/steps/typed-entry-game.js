import { expect } from '@playwright/test';
import { LeaderboardGame } from '../../../rightmove-invaders-leaderboard/acceptance/steps/leaderboard-game.js';
import {
  BLOCKED_INITIALS, Message, ABOUT_THE_INITIALS, INITIALS_FIELD, KeyboardLayout, NamedKey, Leaving, GameOverWithoutEntry,
  printedKey, keyTyping, PressSpacing,
} from './domain-types.js';

// Drives the real game page for the typed initials: the leaderboard's driver (the real page and keyboard, the fake clock,
// the seeded game, the real table behind scripts/serve.mjs, the live-region recorder, the page.route dispatcher), plus:
// - typing as a player types: Playwright's real key presses, one frame each unless "within one frame";
// - other keyboard layouts: Playwright presses keys as a US keyboard does, so a key whose printed letter differs from
//   its position (AZERTY's A on KeyQ) is a synthetic keydown and keyup dispatched on the window (DDD-T11). The DISTILL
//   probe showed that the page's own keyboard listener receives them, with key, code, repeat and the modifiers as given,
//   in Chromium, Firefox and WebKit. Caps Lock is synthetic too: Playwright's CapsLock doesn't change the key it reports;
// - what the browser was left to do with each key: a keydown recorder installed after the page has loaded, so it runs
//   after the game's own listener and reads defaultPrevented as the game left it (DDD-T8). Synthetic events run no browser
//   default, so this checks the game's decision, not the browser's behaviour (Firefox's quick find is a manual check);
// - the moment of game over, to the frame: the player stands still until the last home is lost, which is said 1.4 s (the
//   respawn time) before the game ends, then the clock runs a frame at a time until "Game over" is said;
// - leaving mid-entry: a blur on the window, or the tab hidden (document.visibilityState overridden), as the sound
//   feature's driver does. A key pressed in the same instant is still in the keyboard's queue when the game is left;
// - sound: the synth's read-only journal (window.makeTheRightMove.audio, ADR-003), by its sequence numbers.
// Givens arrange; they never assert the outcome text under test. "Since" is always since the driver's last action.

const FRAME_MS = 17;
const MAX_GAME_MS = 600_000;
const LAST_HOME_STEP_MS = 1000;   // less than the 1.4 s respawn, so the last home lost is seen before the game ends
const MAX_FRAMES_TO_GAME_OVER = 200;
const QUIET_FRAMES = 10;          // frames, each with a short real pause, for a signing that shouldn't leave to show up
const REAL_PAUSE_MS = 15;
const HELD_MS = 1000;             // "for a second"
const REPEAT_EVERY_MS = 100;
const realPause = ms => new Promise(resolve => setTimeout(resolve, ms));

export class TypedEntryGame extends LeaderboardGame {
  constructor(page, table, baseURL) {
    super(page, table, baseURL);
    this.layout = KeyboardLayout.UK_QWERTY;
    this.postsAtMark = 0;
  }

  async open() {
    if (this.opened) return;
    await super.open();
    await this.page.evaluate(() => {
      window.__keydowns = [];
      addEventListener('keydown', e => window.__keydowns.push({ key: e.key, code: e.code, prevented: e.defaultPrevented }));
    });
  }

  async mark() {
    await super.mark();
    this.postsAtMark = this.postsSent;
    this.soundsAtMark = await this.lastSoundSeq();
  }

  // ---- arranging ----
  useKeyboardLayout(layout) { this.layout = layout; }

  async expectSoundAndMusicOn() { await this.expectHud('On', 'On'); }

  // Plays to game over and returns within a frame of it; `beforeTheEnd` runs once the last home is lost.
  async finishGameCaughtAtTheEnd(deposit, beforeTheEnd = async () => {}) {
    expect([0, 50], 'this driver plays a deposit of £0 or £50 (one shot at the Damp above the pin)').toContain(deposit);
    await this.open();
    await this.mark();
    if (!this.playing) await this.startPlaying();
    if (deposit) await this.fire();
    for (let t = 0; t < MAX_GAME_MS && !(await this.saidSinceMark(Message.LAST_HOME_LOST)); t += LAST_HOME_STEP_MS) {
      expect(await this.announcement(), 'arranging: the game ended before its last home was lost').not.toContain(Message.GAME_OVER);
      await this.wait(LAST_HOME_STEP_MS);
    }
    await beforeTheEnd();
    for (let i = 0; i < MAX_FRAMES_TO_GAME_OVER && !(await this.announcement()).includes(Message.GAME_OVER); i++) await this.frame();
    await expect(this.status()).toContainText(Message.GAME_OVER);
    this.playing = false;
    await this.expectAskedForInitials();   // the prompt comes with game over: no frame runs for it
  }

  async gameEndedAgo(ms, deposit) {
    await this.finishGameCaughtAtTheEnd(deposit);
    await this.wait(ms);
  }

  // The key goes down once the last home is lost (the pin is gone, so it moves nothing) and stays down past game over.
  async holdingKeyAsTheGameEnds({ key }, deposit) {
    this.heldKey = key;
    await this.finishGameCaughtAtTheEnd(deposit, () => this.page.keyboard.down(key));
  }

  async signByTyping(letters) {
    const sentBefore = this.postsSent;
    await this.typeThenEnter(letters);
    await expect.poll(() => this.postsSent, { message: `arranging: typing "${letters}" and Enter sent no signing` }).toBeGreaterThan(sentBefore);
    await expect.poll(() => this.postsHandled, { message: 'the signing was never dealt with' }).toBeGreaterThanOrEqual(this.postsSent);
    await this.wait(QUIET_FRAMES * FRAME_MS);
  }

  async refuseBlockedInitials() {
    await this.typeBlockedThenEnter();
    await this.expectTold(Message.REFUSED);   // arranging: the refusal took
  }

  async typeBlocked() {
    const [blocked] = BLOCKED_INITIALS;
    expect(blocked, 'DATA GAP: the word list is empty (BLOCKED_INITIALS in src/game/high-scores.js)').toBeTruthy();
    this.blocked = blocked;
    await this.typeKeys(blocked.toLowerCase());
  }

  async skipSigning() {
    await this.pressEsc();
    await this.expectTold(Message.SKIPPED);   // arranging: the skip took
  }

  // The letter goes down and up, and in the same instant the game is left: the press is still in the keyboard's queue.
  async pressAsTheGameIsLeft(letter, leaving) {
    await this.mark();
    await this.page.keyboard.press(letter);
    if (leaving === Leaving.SWITCH_WINDOW) await this.page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else await this.setTabHidden(true);
    this.left = leaving;
    await this.frame();
  }

  async comeBack() {
    if (this.left === Leaving.HIDE_TAB) await this.setTabHidden(false);
    else await this.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await this.frame();
  }

  async setTabHidden(hidden) {
    await this.page.evaluate(isHidden => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (isHidden ? 'hidden' : 'visible') });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => isHidden });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  }

  // ---- acting ----
  async typeKeys(text, spacing = PressSpacing.A_FRAME_APART) {
    await this.mark();
    for (const character of text) {
      await this.page.keyboard.press(character);
      if (spacing === PressSpacing.A_FRAME_APART) await this.frame();
    }
    if (spacing === PressSpacing.WITHIN_ONE_FRAME) await this.frame();
  }

  async typeThenEnter(text) {
    await this.typeKeys(text);
    await this.press('Enter');
  }

  async typeThenEnterWithinOneFrame(text) {
    await this.mark();
    for (const character of text) await this.page.keyboard.press(character);
    await this.page.keyboard.press('Enter');
    await this.frame();
  }

  async typeBlockedThenEnter() {
    const [blocked] = BLOCKED_INITIALS;
    expect(blocked, 'DATA GAP: the word list is empty (BLOCKED_INITIALS in src/game/high-scores.js)').toBeTruthy();
    this.blocked = blocked;
    await this.typeThenEnter(blocked.toLowerCase());
  }

  async pressKey({ key }) {
    await this.mark();
    await this.press(key);
  }

  // Each key a frame of its own, the field read after each.
  async pressKeysInTurn(keys) {
    await this.mark();
    this.fieldsAfterEachKey = [];
    for (const { name, key } of keys) {
      await this.press(key);
      this.fieldsAfterEachKey.push({ name, field: await this.initialsField().textContent() });
    }
  }

  async pressBackspace() { await this.pressKey({ key: NamedKey.Backspace }); }

  async pressEsc() { await this.pressKey({ key: NamedKey.Esc }); }

  // Held down for a second: the first keydown, then a repeat every 100 ms, as a keyboard's auto-repeat sends them
  // (Playwright marks a keydown of a key already down as a repeat).
  async holdKeyForASecond({ key }) {
    await this.mark();
    await this.page.keyboard.down(key);
    for (let ms = 0; ms < HELD_MS; ms += REPEAT_EVERY_MS) {
      await this.wait(REPEAT_EVERY_MS);
      await this.page.keyboard.down(key);
    }
    await this.page.keyboard.up(key);
    await this.frame();
  }

  // The game-over screen with no entry open (D19), past the 0.6 s after game over. Not asked: the table holds 10
  // signatures of £100, which £50 doesn't beat (as the leaderboard's milestone 4 arranges it).
  async gameOverWithoutEntry(situation) {
    if (situation === GameOverWithoutEntry.NOT_ASKED) {
      await this.seedSignatures(10, 100);
      await this.finishGameWith(50);
      return this.expectNotAskedForInitials();   // arranging: no entry opened
    }
    await this.depositMakesTheTable(50);
    if (situation === GameOverWithoutEntry.SIGNED) return this.signByTyping('mnp');
    return this.skipSigning();
  }

  async keyStillRepeatingAfterGameOver(ms) {
    await this.mark();
    await this.wait(ms);
    await this.page.keyboard.down(this.heldKey);   // a repeat: the key has been down since before game over
    await this.frame();
    await this.page.keyboard.up(this.heldKey);
    await this.frame();
  }

  // Each printed character as this keyboard's layout reports it, a frame each.
  async pressKeyTyping(character) {
    const press = keyTyping(this.layout, character);
    expect(press, `no key of the ${this.layout.name} keyboard types ${character}`).toBeDefined();
    await this.mark();
    await this.dispatchKey(press);
    await this.frame();
  }

  async pressPrinted(printed) {
    await this.mark();
    for (const character of printed) {
      await this.dispatchKey(printedKey(this.layout, character));
      await this.frame();
    }
  }

  async typeWithModifier(modifier, letter) {
    await this.mark();
    if (modifier.chord) await this.page.keyboard.press(`${modifier.chord}+Key${letter.toUpperCase()}`);
    else await this.dispatchKey({ key: modifier.typesOn[letter], code: `Key${letter.toUpperCase()}`, altKey: true });
    this.shortcutCode = `Key${letter.toUpperCase()}`;
    await this.frame();
  }

  async typeCapitals(shifted, capsLocked, plain) {
    await this.mark();
    await this.press(`Shift+Key${shifted.toUpperCase()}`);
    await this.dispatchKey({ key: capsLocked.toUpperCase(), code: `Key${capsLocked.toUpperCase()}` });
    await this.frame();
    await this.press(plain);
  }

  async dispatchKey(init) {
    await this.page.evaluate(event => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...event }));
      window.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: event.key, code: event.code }));
    }, init);
  }

  // ---- observing ----
  async saidSinceMark(text) { return (await this.heardSinceMark()).some(said => said.includes(text)); }

  async keydowns() { return this.page.evaluate(() => window.__keydowns ?? []); }

  async lastSoundSeq() {
    return this.page.evaluate(() => (window.makeTheRightMove?.audio?.journal ?? []).reduce((max, entry) => Math.max(max, entry.seq), 0));
  }

  async lastKeydown(code) {
    const pressed = (await this.keydowns()).filter(keydown => keydown.code === code);
    expect(pressed.length, `no keydown of ${code} reached the page`).toBeGreaterThan(0);
    return pressed.at(-1);
  }

  // ---- asserting ----
  // At once: in the frame the last key was pressed in. No further frame runs before the field is read.
  async expectInitialsFieldAtOnce(text) {
    await expect(this.initialsField(), 'the initials field, one frame after the key').toHaveText(text, { timeout: 1000 });
  }

  async expectFieldAfterEachKey(text) {
    expect(this.fieldsAfterEachKey?.length, 'no keys were pressed').toBeGreaterThan(0);
    expect(this.fieldsAfterEachKey.filter(({ field }) => field !== text), `keys after which the field didn't read ${text}`).toEqual([]);
  }

  async expectNoSound() {
    await this.wait(QUIET_FRAMES * FRAME_MS);
    expect(await this.lastSoundSeq(), 'sounds started since the key').toBe(this.soundsAtMark);
  }

  // Another tab of the same browser (the same saved settings and best), opened now: what the next visit shows. The fake
  // clock belongs to the browser context, so the new tab shares the paused clock and needs a few frames to draw its HUD.
  async expectBestKeptForNextVisit(amount) {
    const visit = await this.page.context().newPage();
    try {
      await visit.goto('/');
      await visit.clock.runFor(100);
      await expect(visit.locator('[data-hud="best"]'), 'the best deposit on the next visit').toHaveText(amount);
    } finally {
      await visit.close();
    }
  }

  async expectRefusalNotRepeated() {
    const said = await this.heardSinceMark();
    expect(said.length, 'the game said nothing since the key, so a negative about it proves nothing').toBeGreaterThan(0);
    expect(said.filter(text => text.includes(Message.REFUSED)), 'the refusal, said again since the key').toEqual([]);
  }

  async expectNothingAboutTheInitialsSaid() {
    const said = (await this.heardSinceMark()).filter(text => ABOUT_THE_INITIALS.test(text));
    expect(said, 'said about the initials since the key').toEqual([]);
  }

  async expectNothingSent() {
    for (let i = 0; i < QUIET_FRAMES; i++) {
      await this.frame();
      await realPause(REAL_PAUSE_MS);
    }
    expect(this.postsSent - this.postsAtMark, 'signings sent to the table since').toBe(0);
  }

  async expectLettersAnnouncedTimes(count) {
    const updates = (await this.heardSinceMark()).filter(text => INITIALS_FIELD.test(text));
    expect(updates, 'live-region updates about the letters since the typing').toHaveLength(count);
  }

  async expectToldTimes(text, count) {
    await this.until(async () => (await this.heard()).filter(said => said.includes(text)).length >= count);
    expect((await this.heard()).filter(said => said.includes(text)), `times the game said ${text}`).toHaveLength(count);
  }

  async expectHud(sound, music) {
    await expect(this.page.locator('[data-hud="sound"]'), 'the sound setting').toHaveText(sound, { timeout: 1000 });
    await expect(this.page.locator('[data-hud="music"]'), 'the music setting').toHaveText(music, { timeout: 1000 });
  }

  async expectSound(state) {
    await this.until(async () => (await this.page.locator('[data-hud="sound"]').textContent()) === state);
    await expect(this.page.locator('[data-hud="sound"]'), 'the sound setting').toHaveText(state, { timeout: 1000 });
  }

  async expectKeptFromBrowser({ key }) {
    expect((await this.lastKeydown(key)).prevented, `the browser was left to act on ${key}`).toBe(true);
  }

  async expectLeftToBrowser({ key }) {
    expect((await this.lastKeydown(key)).prevented, `the browser was kept from acting on ${key}`).toBe(false);
  }

  async expectEnterLeftToBrowser() { await this.expectLeftToBrowser({ key: NamedKey.Enter }); }

  async expectEachKeptFromBrowser(keys) {
    for (const key of keys) await this.expectKeptFromBrowser(key);
  }

  async expectShortcutLeftToBrowser() {
    expect((await this.lastKeydown(this.shortcutCode)).prevented, 'the browser was kept from acting on the shortcut').toBe(false);
  }

  async expectNotSkipped() {
    const heard = await this.heard();
    expect(heard.length, 'the game said nothing at all, so a negative about what it said proves nothing').toBeGreaterThan(0);
    expect(heard.filter(text => text.includes(Message.SKIPPED)), 'said the signing was skipped').toEqual([]);
  }
}
