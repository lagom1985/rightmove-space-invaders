import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { assertStateDelta } from '../common/state-delta.js';
import { playGame, players } from '../common/played-games.js';
import { replay } from '../../src/game/replay.js';
import { readRecord, RULES_VERSION, MAX_GAME_STEPS, CONTROL } from '../../src/game/record.js';
import { createGame } from '../../src/game/game.js';
import { STEP } from '../../src/game/config.js';
import { GameEvent } from '../../src/game/events.js';

// The replay (DDD-R9): replay({ seed, record }) reads the record through readRecord, plays a fresh game made with
// createGame({ newSeed: () => seed, particles: false }) from Enter on the title, one fixed step per recorded step with
// that step's controls, and stops at game over, at record.steps or at MAX_GAME_STEPS, whichever comes first:
// -> { over, steps, deposit }. Pure and synchronous, so the properties assert on what it returns, and that the record
// it was handed is left as it was.

const LETTERS = 'ABCDEFGH';
const seed = fc.stringMatching(/^[0-9a-f]{32}$/);
const controls = fc.integer({ min: 0, max: 7 });

// ---- any readable record ----
// Records written by hand rather than by the recorder, so they reach what the recorder never writes: deltas with leading
// zeros, the same controls twice in a row, another rules version, and steps from just past the last change to the
// largest safe integer, the hour's bound on either side included.
const entry = fc.record({ gap: fc.oneof(fc.integer({ min: 1, max: 40 }), fc.integer({ min: 41, max: 6000 })), controls, zeros: fc.nat({ max: 2 }) });
const length = fc.oneof(
  fc.integer({ min: 1, max: 6000 }),
  fc.integer({ min: MAX_GAME_STEPS - 2, max: MAX_GAME_STEPS + 2 }),
  fc.integer({ min: MAX_GAME_STEPS + 3, max: Number.MAX_SAFE_INTEGER }),
);
const readableRecord = fc.record({
  rules: fc.oneof(fc.constant(RULES_VERSION), fc.maxSafeInteger()),
  first: fc.record({ controls, zeros: fc.nat({ max: 2 }) }),
  later: fc.array(entry, { maxLength: 20 }),
  steps: length,
}).map(({ rules, first, later, steps }) => {
  const written = [{ gap: 0, ...first }, ...later];
  const lastChange = later.reduce((step, { gap }) => step + gap, 0);
  const keys = written.map(({ gap, controls: held, zeros }) => `${'0'.repeat(zeros)}${gap.toString(36)}${LETTERS[held]}`).join('');
  return { rules, steps: Math.max(steps, lastChange + 1), keys };
});

test('any record readRecord accepts replays without throwing, and never past record.steps or MAX_GAME_STEPS', () => {
  let pastTheHour = 0;
  fc.assert(fc.property(seed, readableRecord, (given, record) => {
    expect(readRecord(record), `arranging: ${JSON.stringify(record)} reads`).not.toBeNull();
    const before = { record: structuredClone(record) };
    const { over, steps, deposit } = replay({ seed: given, record });
    assertStateDelta(before, { record }, { universe: ['record'] });
    const bound = Math.min(record.steps, MAX_GAME_STEPS);
    expect(typeof over).toBe('boolean');
    expect(steps, 'the steps replayed').toBeLessThanOrEqual(bound);
    expect(over || steps === bound, `stopped at ${steps} of ${bound}, before game over`).toBe(true);
    expect(Number.isSafeInteger(deposit) && deposit >= 0, `deposit ${deposit}`).toBe(true);
    if (record.steps > MAX_GAME_STEPS) pastTheHour++;
  }));
  expect(pastTheHour, 'no run replayed a record longer than MAX_GAME_STEPS').toBeGreaterThan(0);
});

// ---- games recorded in Node ----
// played-games.js's players: standing still firing, the greedy bot at a program's pace or a human's, and the player that
// plays to a deposit and then waits for the hurdles. -> [name, () => a fresh player]
const player = fc.oneof(
  fc.constant(['standing still, firing', () => players.standStillFiring()]),
  fc.integer({ min: 1, max: 12 }).map(decideEvery => [`greedy, deciding every ${decideEvery} steps`, () => players.greedy({ decideEvery })]),
  fc.constantFrom(1_000, 2_500, 4_000).map(deposit => [`to £${deposit}`, () => players.toDeposit(deposit)]),
);

test('every game recorded in Node replays to its own game over, exactly at its steps, with its deposit', () => {
  fc.assert(fc.property(seed, player, (given, [name, makePlayer]) => {
    const game = playGame({ seed: given, player: makePlayer() });
    expect(game.record, `${name}: arranging: a game with a deposit, asked for initials`).not.toBeNull();
    expect(replay({ seed: given, record: game.record }), name).toEqual({ over: true, steps: game.steps, deposit: game.deposit });
  }), { numRuns: 12 });
});

// ---- games 1 and 2 of one instance ----
// One instance plays two games, each from its own seed, to game over, and signs each as BOT once past the stray-key
// guard, so it hands over each game's record. Each record must be its own game's alone: game 2's from game 2's start,
// as the same game played fresh records it, and each replays to its own game over and deposit (DDD-R6, DDD-R8).
const PAST_THE_GUARD_STEPS = 80;   // 0.67 s of game over: the entry takes typed presses only after 0.6 s (D11)
const SIGN_AS_BOT = [...'bot', 'Enter'].map(key => ({ key }));
const heldKeys = bits => Object.freeze({
  isDown: code => (code === 'ArrowLeft' && (bits & CONTROL.LEFT) !== 0) || (code === 'ArrowRight' && (bits & CONTROL.RIGHT) !== 0) ||
    (code === 'Space' && (bits & CONTROL.FIRE) !== 0),
});

function playTwoGames(seeds, makePlayer) {
  const played = [];
  const game = createGame({ newSeed: () => seeds[played.length], particles: false });
  game.tableAnswered({ scores: [], listedAt: 0 });
  for (const [index, given] of seeds.entries()) {
    game.handlePresses(new Set(['Enter']));
    const started = game.takeEvents().find(event => event.type === GameEvent.GAME_STARTED);
    expect(started?.seed, `arranging: game ${index + 1} started on its seed`).toBe(given);
    const play = makePlayer();
    let steps = 0;
    while (game.g.state !== 'over' && steps < MAX_GAME_STEPS) { game.update(STEP, heldKeys(play(game, steps))); game.takeEvents(); steps++; }
    const deposit = game.g.score;
    for (let i = 0; i < PAST_THE_GUARD_STEPS; i++) game.update(STEP, heldKeys(0));
    game.takeEvents();
    game.handlePresses(new Set(), SIGN_AS_BOT);
    const signed = game.takeEvents().find(event => event.type === GameEvent.INITIALS_ENTERED);
    expect(signed, `arranging: game ${index + 1} was signed`).toBeDefined();
    played.push({ seed: given, record: signed.record, deposit, steps });
  }
  return played;
}

test('games 1 and 2 of one instance each record their own game, as a fresh game does, and replay to its game over and deposit', () => {
  const quickPlayer = fc.oneof(
    fc.constant(['standing still, firing', () => players.standStillFiring()]),
    fc.constantFrom(1_000, 2_500).map(deposit => [`to £${deposit}`, () => players.toDeposit(deposit)]),
  );
  fc.assert(fc.property(fc.uniqueArray(seed, { minLength: 2, maxLength: 2 }), quickPlayer, (seeds, [name, makePlayer]) => {
    for (const [index, game] of playTwoGames(seeds, makePlayer).entries()) {
      const fresh = playGame({ seed: game.seed, player: makePlayer() });
      expect(game, `${name}: game ${index + 1} of one instance, against the same game played fresh`).toEqual({ ...fresh });
      expect(replay({ seed: game.seed, record: game.record }), `${name}: game ${index + 1}`).toEqual({ over: true, steps: game.steps, deposit: game.deposit });
    }
  }), { numRuns: 8 });
});
