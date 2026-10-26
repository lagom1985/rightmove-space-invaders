import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { loadFreshGame, withDeterministicChance } from './support/fresh-game.js';
import { assertStateDelta, satisfying } from '../common/state-delta.js';
import { GameEvent } from '../../src/game/events.js';

// The rules' fixed step, update(dt, keys), reads the keyboard only through isDown (DDD-T14, ADR-009): main.js hands it
// an { isDown } view, never the keyboard, so no rules code can drain the typed presses, take the pressed set or release
// keys. Here it is handed a keyboard that records every use made of it, over play steps that move the pin and fire.
// Universe: the uses made of the keyboard.

const STEP = 1 / 120;
const GAME_KEYS = ['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Space'];
const TRAPS = ['get', 'has', 'set', 'deleteProperty', 'defineProperty', 'ownKeys', 'getOwnPropertyDescriptor'];

// A keyboard with the given keys held, and every use made of it, as "trap member" ("get isDown").
function recordingKeyboard(held) {
  const uses = [];
  const handler = Object.fromEntries(TRAPS.map(trap => [trap, (target, member, ...rest) => {
    uses.push(`${trap} ${String(member ?? '')}`.trim());
    return Reflect[trap](target, member, ...rest);
  }]));
  const keys = new Proxy({ isDown: code => held.has(code) }, handler);
  return { keys, uses };
}

// Moments every run together must reach, or the property isn't exploring what it claims to.
const WITNESSES = ['moved', 'fired'];

test('update reads the keyboard only through isDown, over play steps that move the pin and fire', async () => {
  const seen = new Set();
  const stretch = fc.record({ held: fc.subarray(GAME_KEYS), steps: fc.integer({ min: 1, max: 40 }) });
  await fc.assert(fc.asyncProperty(fc.array(stretch, { minLength: 1, maxLength: 8 }), stretches => withDeterministicChance(async () => {
    const rules = await loadFreshGame();
    rules.handlePresses(new Set(['Enter']));
    const uses = [];
    for (const { held, steps } of stretches) {
      const { keys: holding, uses: used } = recordingKeyboard(new Set(held));
      const x = rules.g.player.x;
      for (let i = 0; i < steps; i++) rules.update(STEP, holding);
      if (rules.g.player.x !== x) seen.add('moved');
      if (rules.takeEvents().some(event => event.type === GameEvent.SHOT_FIRED)) seen.add('fired');
      uses.push(...used);
    }
    assertStateDelta({ uses: [] }, { uses }, {
      universe: ['uses'],
      expected: { uses: satisfying('only isDown read', (_, after) => after.every(use => use === 'get isDown')) },
    });
  })));
  expect(WITNESSES.filter(witness => !seen.has(witness)), 'moments no run reached').toEqual([]);
});
