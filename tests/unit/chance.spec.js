import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { arrange } from './support/fresh-game.js';
import { assertStateDelta, setTo } from '../common/state-delta.js';
import { createChance } from '../../src/game/chance.js';
import { createGame } from '../../src/game/game.js';
import { GameEvent } from '../../src/game/events.js';

// The game's chance (DDD-R6): createChance(seed) is sfc32 over the 32-hex seed's four 32-bit words, warmed up 12 draws,
// and every gameplay draw takes its next(). The function replays a game from its seed (ADR-013), so the same seed must
// give the same draws in every engine, and each game starts a chance of its own.

const seed = fc.stringMatching(/^[0-9a-f]{32}$/);
const HEX = '0123456789abcdef';
const draws = (chance, n) => Array.from({ length: n }, () => chance.next());

// sfc32 written again, in BigInt arithmetic modulo 2^32 rather than the 32-bit integer tricks: an independent model.
const MASK = (1n << 32n) - 1n;
function sfc32Model(seedText) {
  let [a, b, c, d] = [0, 8, 16, 24].map(at => BigInt(`0x${seedText.slice(at, at + 8)}`));
  const next = () => {
    const t = (a + b + d) & MASK;
    d = (d + 1n) & MASK;
    a = b ^ (b >> 9n);
    b = (c + (c << 3n)) & MASK;
    c = ((((c << 21n) & MASK) | (c >> 11n)) + t) & MASK;
    return Number(t) / 2 ** 32;
  };
  for (let warm = 0; warm < 12; warm++) next();
  return { next };
}

test('the same seed gives the same draws, all in [0, 1)', () => {
  fc.assert(fc.property(seed, fc.integer({ min: 1, max: 300 }), (given, n) => {
    const one = createChance(given), other = createChance(given);
    const pairs = Array.from({ length: n }, () => [one.next(), other.next()]);   // interleaved: no state is shared
    expect(pairs.map(([first]) => first)).toEqual(pairs.map(([, second]) => second));
    for (const [draw] of pairs) expect(draw >= 0 && draw < 1, `${draw} is outside [0, 1)`).toBe(true);
  }));
});

test("the draws are sfc32's over the seed's four 32-bit words, after 12 warm-up draws", () => {
  fc.assert(fc.property(seed, fc.integer({ min: 1, max: 50 }), (given, n) => {
    expect(draws(createChance(given), n)).toEqual(draws(sfc32Model(given), n));
  }));
});

// Two seeds a single hex digit apart, anywhere in the 32: every one of the four words counts.
const twoSeeds = fc.tuple(seed, fc.nat({ max: 31 }), fc.integer({ min: 1, max: 15 }))
  .map(([given, at, shift]) => [given, `${given.slice(0, at)}${HEX[(HEX.indexOf(given[at]) + shift) % 16]}${given.slice(at + 1)}`]);

test('two different seeds give different sequences', () => {
  fc.assert(fc.property(twoSeeds, ([one, other]) => {
    expect(draws(createChance(other), 4)).not.toEqual(draws(createChance(one), 4));
  }));
});

// ---- the game's seed ----
// startGame draws one seed from the game's source (createGame's newSeed), creates the game's chance, publishes
// gameStarted { seed }, and only then starts the wave, whose Dream Home timer is the game's first draw. A game played
// again starts a chance of its own: its first draw is its seed's first, not the next of the game before.
// Universe: the seeds the source handed, the gameStarted events published, the screen and the Dream Home timer.
const UNIVERSE = ['seeds handed', 'games started', 'screen', 'dreamTimer'];
const firstDreamTimer = given => 12 + createChance(given).next() * 10;

test('each game draws one seed as it starts, publishes it in gameStarted, and plays its own chance from that seed', () => {
  fc.assert(fc.property(fc.uniqueArray(seed, { minLength: 2, maxLength: 4 }), seeds => {
    const handed = [];
    const rules = createGame({ newSeed: () => { handed.push(seeds[handed.length]); return handed.at(-1); } });
    let started = [];
    const observe = () => ({
      'seeds handed': [...handed], 'games started': [...started], screen: rules.snapshot().screen, dreamTimer: rules.g.dreamTimer,
    });
    for (const [game, given] of seeds.entries()) {
      if (game > 0) {   // the last game ends, and the stray-key guard passes
        arrange.formationOnPin(rules);
        rules.update(1 / 120, { isDown: () => false });
        rules.update(1, { isDown: () => false });
        rules.takeEvents();
        expect(rules.canPlayAgain(), 'arranging: the game did not end').toBe(true);
      }
      const before = observe();
      rules.handlePresses(new Set(['Enter']));
      started = [...started, ...rules.takeEvents().filter(event => event.type === GameEvent.GAME_STARTED).map(({ type, seed }) => ({ type, seed }))];
      assertStateDelta(before, observe(), {
        universe: UNIVERSE,
        expected: {
          'seeds handed': setTo(seeds.slice(0, game + 1)),
          'games started': setTo(seeds.slice(0, game + 1).map(each => ({ type: GameEvent.GAME_STARTED, seed: each }))),
          screen: setTo('play'),
          dreamTimer: setTo(firstDreamTimer(given)),
        },
      });
    }
  }), { numRuns: 30 });
});

// bypass: one fixed condition, a game made without a seed source.
test('without a seed source, Enter on the title throws and leaves the game on the title', () => {
  const rules = createGame({});
  expect(() => rules.handlePresses(new Set(['Enter']))).toThrow(/seed source/);
  expect(rules.snapshot().screen).toBe('title');
  expect(rules.takeEvents()).toEqual([]);
});
