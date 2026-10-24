import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { GameEvent } from '../../src/events.js';
import { loadFreshGame, withDeterministicChance, arrange } from './support/fresh-game.js';

// The marching beat follows the formation's steps (US-03), so the formation may only step while the game
// is in play: never on the Wave cleared banner, while the pin respawns, or after game over. The rules
// publish `formationStepped` for every step, so the property reads the rules' own outbox.
// Each run plays a fresh copy of the game (the module keeps one game's state), driven the way the page
// drives it: key presses, then fixed time steps.

const STEP = 1 / 120;
const SECONDS_PER_TICK = [STEP, 0.05, 0.3, 1, 1.5, 2.5];   // a frame, and long jumps over banners and respawns
const OUT_OF_PLAY = ['clear', 'dead', 'over'];   // the banner, the respawn and game over

const keyboard = { isDown: () => false };
const tick = seconds => ({ run: game => game.advance(seconds) });
const press = key => ({ run: game => game.press(key) });
const boltHitsPin = { run: game => game.boltHitsPin() };
const lastHurdleShot = { run: game => game.lastHurdleShot() };
const formationOverrunsPin = { run: game => game.formationOverrunsPin() };

const command = fc.oneof(
  { weight: 8, arbitrary: fc.constantFrom(...SECONDS_PER_TICK).map(tick) },
  { weight: 2, arbitrary: fc.constantFrom('Enter', 'Space').map(press) },
  { weight: 2, arbitrary: fc.constant(boltHitsPin) },
  { weight: 1, arbitrary: fc.constant(lastHurdleShot) },
  { weight: 1, arbitrary: fc.constant(formationOverrunsPin) },
);

// Every state a game was seen in, over all the runs: proof that the arrangements still reach the states
// this property is about.
const seen = new Set();

// How many time steps that began in play published a formationStepped, over all the runs: the witness that the
// rules still publish the step at all, which the property above could not tell from a formation that never steps.
let steppedInPlay = 0;

// A game of its own, driven the way the page drives it.
async function freshGame() {
  const rules = await loadFreshGame();
  const { g, update, handlePresses, takeEvents } = rules;
  const ticks = [];   // per time step: formationStepped events published, and whether the step began in play

  function advance(seconds) {
    const { state, respawn } = g;
    update(seconds, keyboard);
    const steps = takeEvents().filter(event => event.type === GameEvent.FORMATION_STEPPED).length;
    const pinIsBack = state === 'dead' && respawn - seconds <= 0;   // the respawn ends within this step, so the step counts as in play
    const inPlay = state === 'play' || pinIsBack;
    ticks.push({ steps, inPlay, began: state });
    seen.add(state).add(g.state);
    if (inPlay && steps > 0) steppedInPlay++;
  }

  return {
    ticks,
    advance,
    press: key => { handlePresses(new Set([key])); takeEvents(); },
    boltHitsPin: () => arrange.boltOnPin(rules),
    lastHurdleShot() {
      if (g.state !== 'play') return;
      arrange.lastHurdleShot(rules);
      advance(STEP);
    },
    formationOverrunsPin() {
      if (g.state !== 'play') return;
      arrange.formationOnPin(rules);
      advance(STEP);
    },
  };
}

const playWithDeterministicChance = commands => withDeterministicChance(async () => {
  const game = await freshGame();
  for (const step of [press('Enter'), ...commands]) step.run(game);
  return game;
});

test('the formation never steps on the banner, while the pin respawns, or after game over', async () => {
  await fc.assert(fc.asyncProperty(fc.array(command, { maxLength: 80 }), async commands => {
    const game = await playWithDeterministicChance(commands);
    const steppedOutOfPlay = game.ticks.filter(({ inPlay, steps }) => !inPlay && steps > 0);
    expect(steppedOutOfPlay, 'time steps that began out of play and still stepped the formation').toEqual([]);
  }));
  for (const state of OUT_OF_PLAY) expect(seen.has(state), `no run reached the "${state}" state`).toBe(true);
  expect(steppedInPlay, 'no time step in play published formationStepped').toBeGreaterThan(0);
});
