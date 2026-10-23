import fc from 'fast-check';
import { expect } from '@playwright/test';
import { createSoundDirector } from '../../../../../src/sound.js';
import { GameEvent, CueOp, Sound } from './domain-types.js';

// In-memory composition for layer-2 acceptance: the real sound director (src/sound.js), whose output
// is a list of cues (DDD-4). The CueModel applies those cues the way the synth would and is the only
// thing the example Then steps query. The properties compare the director's whole cue plan, cue by
// cue (op, sound, value, note, t), against referencePlan(): the DESIGN policy table written as code.
// That exact comparison is the documented Mandate 8 waiver and stands in for a Tier B state machine.
// What this cannot model: real audio timing, voice limits, Web Audio failures (@real-io scenarios).

fc.configureGlobal({ seed: Number(process.env.FC_SEED ?? 20261023) });

const AUDIBLE = new Set([CueOp.PLAY, CueOp.START_LOOP, CueOp.START_MUSIC]);
const THUD_GAP = 0.05, TOLERANCE = 1e-6;   // seconds of game time (DDD-7)
const HURDLE_VALUES = [50, 100, 150, 200, 300];

class CueModel {
  constructor() { this.cues = []; this.loops = new Set(); this.music = false; }
  apply(cues) {
    for (const cue of cues) {
      this.cues.push(cue);
      if (cue.op === CueOp.START_LOOP) this.loops.add(cue.sound);
      if (cue.op === CueOp.STOP_LOOP) this.loops.delete(cue.sound);
      if (cue.op === CueOp.START_MUSIC) this.music = true;
      if (cue.op === CueOp.STOP_MUSIC) this.music = false;
      if (cue.op === CueOp.SILENCE) { this.loops.clear(); this.music = false; }
    }
  }
  playedSince(n) { return this.cues.slice(n).filter(c => c.op === CueOp.PLAY); }
  audibleSince(n) { return this.cues.slice(n).filter(c => AUDIBLE.has(c.op)); }
  isLooping(sound) { return this.loops.has(sound); }
  isMusicPlaying() { return this.music; }
}

const canonical = c => ({ op: c.op, sound: c.sound ?? null, value: c.detail?.value ?? null, note: c.detail?.note ?? null, t: c.t });

// The DESIGN director policy table as executable reference (feature-delta, "Director policy table").
function referencePlan(events, settings) {
  const s = { ...settings, inGame: false, paused: false, dream: false, index: 0, lastThud: null };
  const plan = [];
  const cue = (op, t, sound = null, extra = {}) => plan.push({ op, sound, value: extra.value ?? null, note: extra.note ?? null, t });
  const audible = () => s.sound && s.inGame && !s.paused;
  const restore = t => { if (s.music) cue(CueOp.START_MUSIC, t); if (s.dream) cue(CueOp.START_LOOP, t, Sound.SIREN); };
  const ONE_SHOT = { [GameEvent.SHOT_FIRED]: Sound.SHOT, [GameEvent.BOLT_STOPPED]: Sound.BOLT_STOPPED, [GameEvent.HOME_LOST]: Sound.HOME_LOST };
  for (const e of events) {
    const t = e.t;
    switch (e.type) {
      case GameEvent.GAME_STARTED:
        Object.assign(s, { inGame: true, paused: false, dream: false, index: 0, lastThud: null });
        if (s.sound) { cue(CueOp.PLAY, t, Sound.DOORBELL); if (s.music) cue(CueOp.START_MUSIC, t); }
        break;
      case GameEvent.HURDLE_HIT: if (audible()) cue(CueOp.PLAY, t, Sound.HURDLE_HIT, { value: e.value }); break;
      case GameEvent.SHIELD_HIT:
        if (audible() && (s.lastThud === null || t - s.lastThud >= THUD_GAP - TOLERANCE)) { cue(CueOp.PLAY, t, Sound.SHIELD_HIT); s.lastThud = t; }
        break;
      case GameEvent.FORMATION_STEPPED:
        if (s.inGame && !s.paused) { const note = s.index++ % 4; if (audible()) cue(CueOp.PLAY, t, Sound.MARCH, { note }); }
        break;
      case GameEvent.DREAM_APPEARED: s.dream = true; if (audible()) cue(CueOp.START_LOOP, t, Sound.SIREN); break;
      case GameEvent.DREAM_GONE: s.dream = false; cue(CueOp.STOP_LOOP, t, Sound.SIREN); break;
      case GameEvent.DREAM_SAVED: s.dream = false; cue(CueOp.STOP_LOOP, t, Sound.SIREN); if (audible()) cue(CueOp.PLAY, t, Sound.KA_CHING); break;
      case GameEvent.WAVE_CLEARED: s.dream = false; cue(CueOp.STOP_LOOP, t, Sound.SIREN); if (audible()) cue(CueOp.PLAY, t, Sound.FANFARE); break;
      case GameEvent.GAME_OVER: {
        const wasAudible = audible();
        Object.assign(s, { inGame: false, dream: false });
        cue(CueOp.SILENCE, t);
        if (wasAudible) cue(CueOp.PLAY, t, Sound.GAME_OVER);
        break;
      }
      case GameEvent.PAUSED: s.paused = true; cue(CueOp.SILENCE, t); break;
      case GameEvent.RESUMED: s.paused = false; if (s.sound && s.inGame) restore(t); break;
      case GameEvent.SOUND_TOGGLED: s.sound = e.on; if (!e.on) cue(CueOp.SILENCE, t); else if (s.inGame && !s.paused) restore(t); break;
      case GameEvent.MUSIC_TOGGLED: s.music = e.on; if (!e.on) cue(CueOp.STOP_MUSIC, t); else if (audible()) cue(CueOp.START_MUSIC, t); break;
      default: if (ONE_SHOT[e.type] && audible()) cue(CueOp.PLAY, t, ONE_SHOT[e.type]);
    }
  }
  return plan;
}

function directorPlan(events, settings) {
  const director = createSoundDirector(settings);
  return events.flatMap(e => director.handle(e)).map(canonical);
}

const START = { type: GameEvent.GAME_STARTED, t: 0 };
const eventsOf = types => fc.array(fc.tuple(fc.constantFrom(...types), fc.boolean(), fc.constantFrom(...HURDLE_VALUES)), { maxLength: 60 })
  .map(list => list.map(([type, on, value], i) => ({ type, t: 0.1 * (i + 1), on, value, alive: 30, bonus: 1500, source: 'bolt', reason: 'Gazumped!' })));
const allExcept = (...excluded) => Object.values(GameEvent).filter(t => !excluded.includes(t));
const LIFECYCLE = [GameEvent.GAME_STARTED, GameEvent.GAME_OVER, GameEvent.PAUSED, GameEvent.RESUMED, GameEvent.FORMATION_STEPPED, GameEvent.WAVE_CLEARED];

export class DirectorHarness {
  // ---- examples ----
  start(settings) {
    this.settings = settings;
    this.director = createSoundDirector(settings);
    this.model = new CueModel();
    this.t = 0;
    this.report(GameEvent.GAME_STARTED);
    this.cursor = this.model.cues.length;
  }

  report(type, detail = {}) {
    this.t += 0.1;
    this.cursor = this.model.cues.length;
    this.model.apply(this.director.handle({ type, t: this.t, ...detail }));
  }

  arrange(type, detail) { this.report(type, detail); this.cursor = this.model.cues.length; }

  reportHouseHits(count, gapMs) {
    const from = this.model.cues.length;
    this.firstHit = this.t + 1;
    for (let i = 0; i < count; i++) this.model.apply(this.director.handle({ type: GameEvent.SHIELD_HIT, t: this.firstHit + i * gapMs / 1000, source: 'bolt' }));
    this.cursor = from;
  }

  switchSound(on) { this.report(GameEvent.SOUND_TOGGLED, { on }); }

  expectPlayed(sound, detail) {
    const match = detail ? expect.objectContaining({ sound, detail: expect.objectContaining(detail) }) : expect.objectContaining({ sound });
    expect(this.model.playedSince(this.cursor)).toContainEqual(match);
  }

  expectPlayedCount(sound, count) { expect(this.model.playedSince(this.cursor).filter(c => c.sound === sound)).toHaveLength(count); }

  expectThudOffsets(offsetsText) {
    const expected = offsetsText.split(/,\s*/).map(Number);
    const offsets = this.model.playedSince(this.cursor).filter(c => c.sound === Sound.SHIELD_HIT).map(c => Math.round((c.t - this.firstHit) * 1000));
    expect(offsets).toEqual(expected);
  }

  expectLoop(sound, looping) { expect(this.model.isLooping(sound)).toBe(looping); }

  expectMusic(playing) { expect(this.model.isMusicPlaying()).toBe(playing); }

  // ---- properties: When steps choose the generator, Then steps state the invariant ----
  forAnyEvents() { this.arbitrary = eventsOf(allExcept(GameEvent.SOUND_TOGGLED)); }
  forAnyFormationSteps() { this.arbitrary = fc.array(fc.double({ min: 0.03, max: 0.7, noNaN: true }), { minLength: 1, maxLength: 60 }); }
  forAnyLifecycle() { this.arbitrary = eventsOf(LIFECYCLE); }
  forAnyHouseHitBursts() { this.arbitrary = fc.array(fc.double({ min: 0, max: 0.2, noNaN: true }), { minLength: 1, maxLength: 40 }); }

  // Example (after report) or property (after forAny...): nothing audible, and the whole plan
  // matches the reference.
  expectNothingAudible() {
    if (!this.arbitrary) return expect(this.model.audibleSince(this.cursor)).toEqual([]);
    fc.assert(fc.property(this.arbitrary, events => {
      const all = [START, ...events];
      const plan = directorPlan(all, this.settings);
      expect(plan.filter(c => AUDIBLE.has(c.op))).toEqual([]);
      expect(plan).toEqual(referencePlan(all, this.settings));
    }));
  }

  checkSameEventsWithSoundOn() {
    fc.assert(fc.property(this.arbitrary, events => {
      const all = [START, ...events], settings = { ...this.settings, sound: true };
      expect(directorPlan(all, settings)).toEqual(referencePlan(all, settings));
    }));
  }

  checkOneBeatPerStep() {
    fc.assert(fc.property(this.arbitrary, gaps => {
      let t = 0;
      const steps = gaps.map(gap => ({ type: GameEvent.FORMATION_STEPPED, t: (t += gap), alive: 55 }));
      const notes = directorPlan([START, ...steps], this.settings).filter(c => c.sound === Sound.MARCH).map(c => c.note);
      expect(notes).toEqual(gaps.map((_, i) => i % 4));
    }));
  }

  checkBeatOnlyWhilePlaying() {
    fc.assert(fc.property(this.arbitrary, events => {
      const all = [START, { type: GameEvent.GAME_OVER, t: 0.05, reason: 'Gazumped!' }, ...events];
      expect(directorPlan(all, this.settings)).toEqual(referencePlan(all, this.settings));
    }));
  }

  checkHouseHitSpacing(minGapMs) {
    fc.assert(fc.property(this.arbitrary, gaps => {
      let t = 1;
      const hits = gaps.map(gap => ({ type: GameEvent.SHIELD_HIT, t: (t += gap), source: 'bolt' }));
      const thuds = directorPlan([START, ...hits], this.settings).filter(c => c.sound === Sound.SHIELD_HIT);
      expect(thuds.slice(1).every((c, i) => c.t - thuds[i].t >= minGapMs / 1000 - TOLERANCE)).toBe(true);
      expect(thuds).toEqual(referencePlan([START, ...hits], this.settings).filter(c => c.sound === Sound.SHIELD_HIT));
    }));
  }
}
