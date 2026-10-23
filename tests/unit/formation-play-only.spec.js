import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import { GameEvent } from '../../src/events.js';

// The marching beat follows the formation's steps (US-03), so the formation may only step while the game
// is in play: never on the Wave cleared banner, while the pin respawns, or after game over. The rules
// publish `formationStepped` for every step, so the property reads the rules' own outbox.
// Each run plays a fresh copy of the game (the module keeps one game's state), driven the way the page
// drives it: key presses, then fixed time steps.

const STEP = 1 / 120;
const SECONDS_PER_TICK = [STEP, 0.05, 0.3, 1, 1.5, 2.5];   // a frame, and long jumps over banners and respawns

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

let copies = 0;

// A game of its own, with a deterministic Math.random (enemy fire and Dream Home timing).
async function freshGame() {
  const { g, update, handlePresses, takeEvents, invaderX, invaderY, PW, IW, IH } =
    await import(`../../src/game.js?copy=${++copies}`);
  const ticks = [];   // per time step: formationStepped events published, and whether the step began in play

  function advance(seconds) {
    const { state, respawn } = g;
    update(seconds, keyboard);
    const steps = takeEvents().filter(event => event.type === GameEvent.FORMATION_STEPPED).length;
    const pinIsBack = state === 'dead' && respawn - seconds <= 0;   // the respawn ends within this step, so the step counts as in play
    ticks.push({ steps, inPlay: state === 'play' || pinIsBack, began: state });
  }

  return {
    ticks,
    advance,
    press: key => { handlePresses(new Set([key])); takeEvents(); },
    boltHitsPin: () => g.bolts.push({ x: g.player.x + PW / 2 - 1, y: g.player.y, vy: 240, color: '#ffffff' }),
    lastHurdleShot() {
      if (g.state !== 'play') return;
      const alive = g.invaders.filter(hurdle => hurdle.alive);
      const last = alive.pop();
      alive.forEach(hurdle => { hurdle.alive = false; });
      g.shot = { x: invaderX(last) + IW / 2, y: invaderY(last) + IH / 2 };
      advance(STEP);
    },
    formationOverrunsPin() {
      if (g.state !== 'play') return;
      g.formation.y = g.player.y;
      g.formation.timer = 0;
      advance(STEP);
    },
  };
}

async function playWithDeterministicChance(commands) {
  const random = Math.random;
  let seed = 7;
  Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  try {
    const game = await freshGame();
    for (const step of [press('Enter'), ...commands]) step.run(game);
    return game;
  } finally {
    Math.random = random;
  }
}

test('the formation never steps on the banner, while the pin respawns, or after game over', async () => {
  await fc.assert(fc.asyncProperty(fc.array(command, { maxLength: 80 }), async commands => {
    const game = await playWithDeterministicChance(commands);
    const steppedOutOfPlay = game.ticks.filter(({ inPlay, steps }) => !inPlay && steps > 0);
    expect(steppedOutOfPlay, 'time steps that began out of play and still stepped the formation').toEqual([]);
  }));
});
