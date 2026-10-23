import { expect } from '@playwright/test';
import { W } from '../../../../../src/config.js';
import { PLAYER_SPEED, RESPAWN_TIME, houseCentreX } from '../../../../../src/game.js';
import { pounds } from '../../../../../src/theme.js';
import { Sound, Key, Screen, Setting, AudioState, Announcement } from './domain-types.js';

// Drives the real game page with real key presses (see docs/architecture/atdd-infrastructure-policy.md):
// - game time is Playwright's fake clock; Math.random is seeded, so every run plays the same game;
// - sound is observed through the read-only handle window.makeTheRightMove.audio (ADR-003):
//   "I hear X" means "the synth started X", not that it reached the speakers.
// The cursor is a journal sequence number (seq), never an array index: the journal keeps only the
// last 100 entries, so its length stops growing.

const START = new Date('2026-01-01T09:00:00Z');
const FRAME_MS = 17;                      // one display frame at 60 Hz
const SHOT_FLIGHT_MS = 1000;              // a shot reaches the formation and resolves within this
const SEED = 20261023;
const SYNTH_HOST = '/tests/e2e/rightmove-invaders-sound/acceptance/fixtures/synth-host.html';
const AUDIO_WARNING = /audio|AudioContext/i;

export class GameDriver {
  constructor(page) {
    this.page = page;
    this.cursor = 0;        // journal seq at the last marked moment (usually a key press)
    this.pressedAt = 0;     // page time of the last key press
    this.problems = [];
    page.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && AUDIO_WARNING.test(m.text()))) this.problems.push(`console: ${m.text()}`); });
    page.on('pageerror', e => this.problems.push(`page error: ${e.message}`));
  }

  // ---- arranging ----
  // audio: true | false (browser without sound) | 'broken' (sound fails to start)
  async open({ audio = true, storage = true } = {}) {
    await this.page.addInitScript(seed => {
      let a = seed;   // mulberry32
      Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }, SEED);
    if (audio === false) await this.page.addInitScript(() => { delete window.AudioContext; delete window.webkitAudioContext; });
    if (audio === 'broken') await this.page.addInitScript(() => { window.AudioContext = window.webkitAudioContext = function () { throw new Error('The audio device could not be opened'); }; });
    if (!storage) await this.page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } }));
    await this.page.clock.install({ time: START });
    await this.page.goto('/');
    await this.page.clock.pauseAt(new Date(START.getTime() + 5000));
    await this.wait(FRAME_MS);
  }

  async startPlaying({ sound = true, music = true } = {}) {
    await this.open();
    await this.press(Key.ENTER);
    await this.expectAnnounced(Announcement.GAME_STARTED);
    if (!sound) await this.switchOff(Key.M, Setting.SOUND);
    if (!music) await this.switchOff(Key.N, Setting.MUSIC);
  }

  async switchOff(key, setting) {
    await this.press(key);
    await this.expectSetting(setting, 'Off');
  }

  async goTo(screen) {
    await this.open();
    if (screen === Screen.TITLE) return;
    await this.press(Key.ENTER);
    if (screen === Screen.PAUSE) return this.press(Key.P);
    await this.waitUntilAnnounced(Announcement.GAME_OVER);
  }

  async turnOffOnEarlierVisit(setting) {
    await this.open();
    await this.switchOff(setting === Setting.SOUND ? Key.M : Key.N, setting);
    await this.page.reload();
    await this.wait(FRAME_MS);
    this.cursor = 0;
  }

  async fireAndHearIt() {
    await this.fire();
    await this.expectHeard(Sound.SHOT);
  }

  // A page that hosts only the synth (src/synth.js), for adapter-level checks. Real time, no fake clock.
  // window.synth there is a test-only hook (see the infrastructure policy).
  async openSoundSystemOnly() {
    await this.page.goto(SYNTH_HOST);
    await this.page.keyboard.press('Shift');   // the user gesture that unlocks audio
    await expect.poll(async () => (await this.diagnostics()).state).toBe(AudioState.RUNNING);
  }

  // ---- acting ----
  async press(key) {
    await this.markNow();
    await this.page.keyboard.press(key);
    await this.wait(FRAME_MS);
  }

  async fire() {
    await this.press(Key.SPACE);
    await this.wait(SHOT_FLIGHT_MS);
  }

  async fireShotsApart(count) {
    await this.markNow();   // one mark for the whole burst
    for (let i = 0; i < count; i++) {
      await this.page.keyboard.press(Key.SPACE);
      await this.wait(SHOT_FLIGHT_MS);
    }
  }

  async fireIntoHouse(index) {
    const offset = houseCentreX(index) - W / 2;
    await this.page.keyboard.down(offset < 0 ? Key.LEFT : Key.RIGHT);
    await this.wait(Math.abs(offset) / PLAYER_SPEED * 1000);
    await this.page.keyboard.up(offset < 0 ? Key.LEFT : Key.RIGHT);
    await this.fire();
  }

  async pauseFor(key, ms) {
    await this.press(key);
    await this.wait(ms);
  }

  // Leaves the cursor where it was (before the loss), so the loss's own sounds stay visible.
  async loseAHome() { await this.waitUntilAnnounced(Announcement.HOME_LOST, { stepMs: 200 }); }

  async waitForGameOver() { await this.waitUntilAnnounced(Announcement.GAME_OVER); }

  // No frame is allowed to run after these: silence must not wait for the next frame.
  async switchWindow() {
    await this.markNow();
    await this.page.evaluate(() => window.dispatchEvent(new Event('blur')));
  }

  async hideTab() {
    await this.markNow();
    await this.page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }

  async burst(sound, count) {
    await this.page.evaluate(([s, n]) => { for (let i = 0; i < n; i++) window.synth.perform({ op: 'play', sound: s, t: 0 }); }, [sound, count]);
  }

  async wait(ms) { await this.page.clock.runFor(Math.round(ms)); }

  async waitUntilAnnounced(text, { stepMs = 1000, maxMs = 600_000 } = {}) {
    for (let t = 0; t < maxMs && !(await this.status().textContent()).includes(text); t += stepMs) await this.wait(stepMs);
    await this.expectAnnounced(text);
  }

  async waitUntilHeard(sound, count = 1, maxMs = 60_000, after = () => true) {
    for (let t = 0; t < maxMs && (await this.heard(sound)).filter(after).length < count; t += 250) await this.wait(250);
  }

  async markNow() {
    this.cursor = await this.lastSeq();
    this.pressedAt = await this.page.evaluate(() => performance.now());
  }

  // ---- observing ----
  status() { return this.page.getByRole('status'); }

  async journal() {
    return this.page.evaluate(() => (window.makeTheRightMove?.audio?.journal ?? []).map(({ seq, sound, detail, t, at }) => ({ seq, sound, detail: detail ?? {}, t, at })));
  }

  async lastSeq() { return (await this.journal()).reduce((max, e) => Math.max(max, e.seq), 0); }

  async diagnostics() {
    return this.page.evaluate(() => {
      const a = window.makeTheRightMove?.audio;
      return a ? { state: a.state, music: a.music, voices: a.voices, peakVoices: a.peakVoices } : { state: 'absent' };
    });
  }

  async since() { return (await this.journal()).filter(e => e.seq > this.cursor); }

  async heard(sound) { return (await this.since()).filter(e => e.sound === sound); }

  // ---- asserting ----
  async expectSoundSystemPresent() {
    expect((await this.diagnostics()).state, 'the game has no sound system to check').not.toBe(AudioState.ABSENT);
  }

  async expectHeard(sound, detail) {
    await this.waitUntilHeard(sound);
    const match = detail ? expect.objectContaining({ sound, detail: expect.objectContaining(detail) }) : expect.objectContaining({ sound });
    expect(await this.heard(sound), `expected to hear ${sound}`).toContainEqual(match);
  }

  async expectHeardWithinOneFrame(sound) {
    const [first] = await this.heard(sound);
    expect(first, `expected to hear ${sound}`).toBeDefined();
    expect(first.at - this.pressedAt, `${sound} started too late`).toBeLessThanOrEqual(FRAME_MS);
  }

  async expectHeardCount(sound, count) {
    await this.waitUntilHeard(sound, count);
    expect(await this.heard(sound), `expected to hear ${count} × ${sound}`).toHaveLength(count);
  }

  async expectMarched(steps) {
    await this.waitUntilHeard(Sound.MARCH, steps);
    expect((await this.heard(Sound.MARCH)).length, `expected the formation to march ${steps} steps`).toBeGreaterThanOrEqual(steps);
  }

  async expectMarchNotes(sequence) {
    const expected = sequence.split(/\s+/).map(Number);
    const notes = (await this.heard(Sound.MARCH)).map(e => e.detail.note + 1);
    expect(notes.slice(0, expected.length)).toEqual(expected);
  }

  async expectBeatInterval(ms) {
    const times = (await this.heard(Sound.MARCH)).map(e => e.t);
    const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
    expect(gaps.length, 'need at least two beat notes').toBeGreaterThan(0);
    const median = gaps[Math.floor(gaps.length / 2)] * 1000;
    expect(median).toBeGreaterThanOrEqual(ms * 0.9);
    expect(median).toBeLessThanOrEqual(ms * 1.1);
  }

  // Uses simulation time from the journal: the loss is the home-lost sound's t.
  async lossTime() {
    const [loss] = await this.heard(Sound.HOME_LOST);
    expect(loss, 'expected to hear the home being lost').toBeDefined();
    return loss.t;
  }

  async expectNoBeatWhileRespawning() {
    const lost = await this.lossTime();
    await this.wait(RESPAWN_TIME * 1000);
    const during = (await this.heard(Sound.MARCH)).filter(e => e.t > lost && e.t < lost + RESPAWN_TIME);
    expect(during, 'beat notes while the pin respawns').toEqual([]);
  }

  async expectBeatAfterRespawn() {
    const lost = await this.lossTime();
    const afterRespawn = e => e.t >= lost + RESPAWN_TIME;
    await this.waitUntilHeard(Sound.MARCH, 1, 10_000, afterRespawn);
    expect((await this.heard(Sound.MARCH)).filter(afterRespawn).length, 'the beat did not come back after the respawn').toBeGreaterThan(0);
  }

  async expectNoSoundYet() {
    await this.expectSoundSystemPresent();
    expect(await this.journal()).toEqual([]);
  }

  async expectSilentSinceLastPress() {
    await this.expectSoundSystemPresent();
    expect(await this.since()).toEqual([]);
  }

  // Polls on real time only: no game frame runs between the action and this check.
  async expectAllSoundStopped() {
    await this.expectSoundSystemPresent();
    await expect.poll(async () => { const { voices, music } = await this.diagnostics(); return { voices, music }; })
      .toEqual({ voices: 0, music: 'stopped' });
  }

  async expectAudioState(state) { await expect.poll(async () => (await this.diagnostics()).state).toBe(state); }

  async expectMusic(playing) {
    await this.expectSoundSystemPresent();
    await expect.poll(async () => (await this.diagnostics()).music).toBe(playing ? 'playing' : 'stopped');
  }

  async expectPeakVoicesAtMost(n) {
    const { peakVoices } = await this.diagnostics();
    expect(peakVoices).toBeGreaterThan(0);
    expect(peakVoices).toBeLessThanOrEqual(n);
  }

  async expectStartedCount(sound, count) {
    expect((await this.journal()).filter(e => e.sound === sound)).toHaveLength(count);
  }

  async expectSetting(setting, text) { await expect(this.page.locator(`[data-hud="${setting}"]`)).toHaveText(text); }

  async expectDeposit(amount) { await expect(this.page.locator('[data-hud="deposit"]')).toHaveText(pounds(amount)); }

  async expectAnnounced(text) { await expect(this.status()).toContainText(text); }

  // Console and page errors arrive asynchronously: let one more frame run before reading them.
  async expectNoProblems() {
    await this.wait(FRAME_MS);
    expect(this.problems).toEqual([]);
  }
}
