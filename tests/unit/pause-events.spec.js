import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { GameEvent } from '../../src/game/events.js';
import { loadFreshGame, withDeterministicChance, arrange } from './support/fresh-game.js';

// The sound system learns of a pause only from the rules' outbox (US-04): `paused` when the game stops,
// `resumed` when it carries on, and never twice for the same change. P and Escape, and the page losing focus
// (pause()), are two different paths into the same change, so the property drives both through the rules' public
// API, the way the page does, and compares what the outbox says with what really happened to `g.paused`.

const STEP = 1 / 120;
const SECONDS_PER_TICK = [STEP, 0.05, 0.3, 1, 2.5];
const keyboard = { isDown: () => false };

// `whenPlaying` says what the command must do to a game in play: flip the pause, or pause it.
const keys = (...pressed) => ({ whenPlaying: 'flip', run: rules => rules.handlePresses(new Set(pressed)) });
const otherKey = key => ({ run: rules => rules.handlePresses(new Set([key])) });
const pageLosesFocus = { whenPlaying: 'pause', run: rules => rules.pause() };
const tick = seconds => ({ run: rules => { if (!rules.g.paused) rules.update(seconds, keyboard); } });   // the page runs no steps while paused
const inPlay = run => ({ run: rules => { if (rules.g.state === 'play' && !rules.g.paused) run(rules); } });
const boltHitsPin = inPlay(rules => { arrange.boltOnPin(rules); rules.update(STEP, keyboard); });
const lastHurdleShot = inPlay(rules => { arrange.lastHurdleShot(rules); rules.update(STEP, keyboard); });
const formationOverrunsPin = inPlay(rules => { arrange.formationOnPin(rules); rules.update(STEP, keyboard); });

const command = fc.oneof(
  { weight: 4, arbitrary: fc.subarray(['KeyP', 'Escape'], { minLength: 1 }).map(pressed => keys(...pressed)) },
  { weight: 3, arbitrary: fc.constant(pageLosesFocus) },
  { weight: 2, arbitrary: fc.constantFrom('Enter', 'Space', 'KeyM', 'KeyN', 'ArrowLeft').map(otherKey) },
  { weight: 6, arbitrary: fc.constantFrom(...SECONDS_PER_TICK).map(tick) },
  { weight: 1, arbitrary: fc.constantFrom(boltHitsPin, lastHurdleShot, formationOverrunsPin) },
);

const ANNOUNCEMENT = { true: GameEvent.PAUSED, false: GameEvent.RESUMED };   // by the new value of g.paused
const PAUSE_EVENTS = new Set(Object.values(ANNOUNCEMENT));
const pausedAfter = { flip: wasPaused => !wasPaused, pause: () => true };

test('every change of the pause is published once as paused or resumed, and nothing else is', async () => {
  const game = fc.record({ started: fc.boolean(), commands: fc.array(command, { maxLength: 60 }) });
  await fc.assert(fc.asyncProperty(game, ({ started, commands }) => withDeterministicChance(async () => {
    const rules = await loadFreshGame();
    const { g, takeEvents } = rules;
    if (started) { rules.handlePresses(new Set(['Enter'])); takeEvents(); }
    for (const step of commands) {
      const { state, paused } = g;
      step.run(rules);
      const published = takeEvents().map(event => event.type).filter(type => PAUSE_EVENTS.has(type));
      expect(published, `the pause went from ${paused} to ${g.paused}`).toEqual(g.paused === paused ? [] : [ANNOUNCEMENT[g.paused]]);
      if (step.whenPlaying && state === 'play') expect(g.paused, 'a game in play did not respond to the pause').toBe(pausedAfter[step.whenPlaying](paused));
    }
  })));
});
