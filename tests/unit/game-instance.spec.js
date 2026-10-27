import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { arrange } from './support/fresh-game.js';
import { assertStateDelta, setTo } from '../common/state-delta.js';
import { createGame } from '../../src/game/game.js';
import { STEP } from '../../src/game/config.js';
import { GameEvent } from '../../src/game/events.js';

// One game per instance (DDD-R7, ADR-013): createGame({ newSeed, particles = true }) keeps the game's state, its outbox,
// the signings on their way, the notice count, its best store and its chance to itself. A game played beside another
// plays exactly as it would alone; createGame itself draws nothing; and a game made with particles: false makes none,
// and plays exactly as one made with them (the function replays games without them, DDD-R9).

const seed = fc.stringMatching(/^[0-9a-f]{32}$/);
const NOTHING_HELD = Object.freeze({ isDown: () => false });
const holding = codes => Object.freeze({ isDown: code => codes.includes(code) });

// ---- two games share no state ----
// The model of a game played alone is the same game made in a module copy of its own (?alone=n): it shares nothing with
// any other game, even if the rules kept state at module level.
let copies = 0;
const createGameAlone = async options => (await import(`../../src/game/game.js?alone=${++copies}`)).createGame(options);

// A game, with what it handed out through its ports: the seeds its newSeed gave, the events taken from it, and the best
// scores its stores were asked to save.
async function player(make, seeds) {
  const log = { seeds: [], events: [], saved: [] };
  const newSeed = () => { log.seeds.push(seeds[log.seeds.length % seeds.length]); return log.seeds.at(-1); };
  return { game: await make({ newSeed, particles: false }), log };
}

// Every port of one game, its events taken first. The universe is both games' ports.
const CORNER = Object.freeze({ c: 0, r: 0 });
const SLOTS = ['g', 'read model', 'can play again', 'formation corner', 'events', 'seeds handed', 'best saved'];
const UNIVERSE = ['A', 'B'].flatMap(name => SLOTS.map(slot => `${name}.${slot}`));

function observe({ game, log }) {
  log.events.push(...game.takeEvents());
  return {
    g: structuredClone(game.g), 'read model': game.snapshot(), 'can play again': game.canPlayAgain(),
    'formation corner': [game.invaderX(CORNER), game.invaderY(CORNER)],
    events: [...log.events], 'seeds handed': [...log.seeds], 'best saved': [...log.saved],
  };
}
const observeBoth = pair => Object.fromEntries(Object.entries(pair).flatMap(([name, one]) =>
  Object.entries(observe(one)).map(([slot, value]) => [`${name}.${slot}`, value])));

// What a script does to one game, through its ports only (arranging a game over through fresh-game.js's checked writes).
const ACTS = {
  press: ({ game }, { codes }) => game.handlePresses(new Set(codes)),
  type: ({ game }, { keys }) => game.handlePresses(new Set(), keys.map(key => ({ key }))),
  play: ({ game }, { steps, held }) => { for (let i = 0; i < steps; i++) game.update(STEP, holding(held)); },
  // The game in play ends with this deposit, and the stray-key guard passes; on any other screen, nothing is done.
  over: ({ game }, { deposit }) => {
    if (game.g.state !== 'play') return;
    arrange.deposit(game, deposit);
    arrange.formationOnPin(game);
    game.update(STEP, NOTHING_HELD);
    game.update(1, NOTHING_HELD);
  },
  table: ({ game }, { scores, listedAt }) => game.tableAnswered({ scores, listedAt }),
  'table failed': ({ game }) => game.tableFailed(),
  'signing answered': ({ game }, { n, scores, id, listedAt }) => game.signingAnswered(n, { scores, id, listedAt }),
  'signing failed': ({ game }, { n }) => game.signingFailed(n),
  pause: ({ game }) => game.pause(),
  settings: ({ game }, { sound, music }) => game.applySettings({ sound, music }),
  'best store': ({ game, log }, { best }) => game.applyBestStore({ load: () => best, save: score => log.saved.push(score) }),
};

const rows = fc.array(fc.record({ initials: fc.constantFrom('ABC', 'XYZ'), score: fc.constantFrom(10, 1000), id: fc.constantFrom('r1', 'r2') }), { maxLength: 3 });
const signing = fc.integer({ min: 1, max: 2 });
const action = fc.oneof(
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('press'), codes: fc.subarray(['Enter', 'KeyP', 'KeyM', 'KeyN']) }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('type'), keys: fc.oneof(fc.constant([...'abc', 'Enter']), fc.constant(['x', 'Enter']), fc.array(fc.constantFrom('a', 'x', 'Enter', 'Backspace', 'Escape', '1'), { minLength: 1, maxLength: 4 })) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('play'), steps: fc.integer({ min: 1, max: 240 }), held: fc.subarray(['ArrowLeft', 'ArrowRight', 'Space']) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('over'), deposit: fc.constantFrom(50, 1500) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('table'), scores: rows, listedAt: fc.nat(5) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('table failed') }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('signing answered'), n: signing, scores: rows, id: fc.constantFrom('r1', 'r9'), listedAt: fc.nat(5) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('signing failed'), n: signing }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('pause') }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('settings'), sound: fc.boolean(), music: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('best store'), best: fc.constantFrom(0, 700) }) },
);
const script = fc.array(fc.record({ on: fc.constantFrom('A', 'B'), action }), { minLength: 20, maxLength: 50 });

// The witnesses, over all the runs: how often a game was seen holding the state it keeps to itself, so the scripts are
// known to still reach it.
const reached = { 'a game started': 0, 'a notice shown': 0, 'a signing settled': 0, 'a best saved': 0 };
const witness = ({ game, log }) => {
  if (log.events.some(event => event.type === GameEvent.GAME_STARTED)) reached['a game started']++;
  if (game.g.initials?.notice) reached['a notice shown']++;
  if (game.g.settled) reached['a signing settled']++;
  if (log.saved.length) reached['a best saved']++;
};

test('two games made by createGame share no state: each plays exactly as it would alone', async () => {
  await fc.assert(fc.asyncProperty(fc.uniqueArray(seed, { minLength: 4, maxLength: 4 }), script, async (seeds, steps) => {
    const seedsOf = { A: seeds.slice(0, 2), B: seeds.slice(2) };
    const pair = { A: await player(createGame, seedsOf.A), B: await player(createGame, seedsOf.B) };
    const alone = { A: await player(createGameAlone, seedsOf.A), B: await player(createGameAlone, seedsOf.B) };
    for (const { on, action: act } of steps) {
      const before = observeBoth(pair);
      ACTS[act.kind](pair[on], act);
      ACTS[act.kind](alone[on], act);
      const asAlone = observe(alone[on]);
      assertStateDelta(before, observeBoth(pair), {
        universe: UNIVERSE,
        expected: Object.fromEntries(SLOTS.map(slot => [`${on}.${slot}`, setTo(asAlone[slot])])),
      });
      witness(pair[on]);
    }
  }), { numRuns: 100 });
  for (const [what, seen] of Object.entries(reached)) expect(seen, `no game ever reached ${what}`).toBeGreaterThan(0);
});

// ---- createGame draws nothing ----
// Universe: the seeds the games' sources handed, the draws of the shared luck the particles use, and the events
// published. Making games, with or without particles, changes none of them: the first seed is drawn as a game starts.
test('createGame draws nothing: no seed, no luck, no event, until a game starts', () => {
  fc.assert(fc.property(seed, fc.array(fc.boolean(), { minLength: 1, maxLength: 4 }), (given, particleChoices) => {
    const random = Math.random;
    const handed = [];
    let draws = 0;
    Math.random = () => { draws++; return random(); };
    try {
      let games = [];
      const drawn = () => ({ 'seeds handed': [...handed], 'random draws': draws, 'events published': games.flatMap(game => game.takeEvents()) });
      const before = drawn();
      games = particleChoices.map(particles => createGame({ newSeed: () => { handed.push(given); return given; }, particles }));
      assertStateDelta(before, drawn(), { universe: ['seeds handed', 'random draws', 'events published'] });
      for (const game of games) expect(game.snapshot().screen, 'a new game is on the title').toBe('title');
    } finally {
      Math.random = random;
    }
  }));
});

// ---- particles: false ----
// Two games on one seed, one made with particles and one without, in either order, are played the same: the first
// second fires (so the one with particles throws some), then any keys held for any steps. Universe of the one without:
// its particles, which stay none, and the rest of its state, which is always the other's.
const gameplay = game => {
  const { particles, ...rest } = game.g;
  return structuredClone(rest);
};
const look = game => ({ particles: structuredClone(game.g.particles), gameplay: gameplay(game) });
const held = fc.record({ steps: fc.integer({ min: 1, max: 240 }), held: fc.subarray(['ArrowLeft', 'ArrowRight', 'Space']) });

test('a game made with particles: false makes no particles, and plays exactly as one made with them', () => {
  let sparkled = 0;
  fc.assert(fc.property(seed, fc.boolean(), fc.array(held, { maxLength: 6 }), (given, withParticlesFirst, segments) => {
    const made = {};
    for (const particles of withParticlesFirst ? [true, false] : [false, true]) made[particles] = createGame({ newSeed: () => given, particles });
    const { false: plain, true: sparkling } = made;
    for (const game of [plain, sparkling]) game.handlePresses(new Set(['Enter']));
    let threw = false;
    for (const { steps, held: codes } of [{ steps: 120, held: ['Space'] }, ...segments]) {
      const before = look(plain);
      for (let i = 0; i < steps; i++) {
        plain.update(STEP, holding(codes));
        sparkling.update(STEP, holding(codes));
        threw ||= sparkling.g.particles.length > 0;
      }
      assertStateDelta(before, look(plain), { universe: ['particles', 'gameplay'], expected: { gameplay: setTo(gameplay(sparkling)) } });
    }
    if (threw) sparkled++;
  }), { numRuns: 40 });
  expect(sparkled, 'the games made with particles threw none').toBeGreaterThan(0);
});
