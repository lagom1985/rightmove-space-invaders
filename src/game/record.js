// The game's record (ADR-013, DESIGN DDD-R5): what the player did, by simulation step, from the game's start to its game
// over, so the function can replay the game (ADR-012). Pure: imports nothing (layering rule 8). Shared by both sides of
// the wire, like high-scores.js: the browser records with it, the function reads with it.
//
// RED scaffold (DISTILL, rightmove-invaders-replay-verified-scores): the constants are DESIGN's, as real values; the
// recorder and the reader throw until DELIVER builds them (enabling task E4).
//   record = { rules: RULES_VERSION, steps, keys }
//   keys: one entry per change of the held controls, the step delta in base 36 then a capital A-H for the three bits
//   (A = none ... H = left + right + fire), the delta in lowercase base 36. The first entry is at step 0, every later
//   delta is at least 1, every change comes before `steps`, and `steps` is a safe integer of at least 1. The 60-minute
//   bound (MAX_GAME_STEPS) is the signing's next check, game-too-long, not the reader's (clarified in DISTILL, C3).
export const __SCAFFOLD__ = true;

export const RULES_VERSION = 1;                    // raised by every change to how the game plays (D10)
export const MAX_GAME_STEPS = 60 * 60 * 120;       // 432,000: 60 minutes of game time at 120 steps a second (D9)
export const CONTROL = Object.freeze({ LEFT: 1, RIGHT: 2, FIRE: 4 });

// -> a recorder the game keeps from its start to its game over (DDD-R8).
export function createRecorder() {
  throw new Error('__SCAFFOLD__: createRecorder is not yet implemented (record.js, DDD-R5)');
}

// record -> { rules, steps, changes: [[step, bits], ...] }, or null for anything that isn't a record (DDD-R5).
export function readRecord(record) {
  throw new Error('__SCAFFOLD__: readRecord is not yet implemented (record.js, DDD-R5)');
}
