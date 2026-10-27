// The replay (ADR-013, DESIGN DDD-R9): a fresh game with the session's seed and no particles, Enter pressed on the
// title, then one fixed step per recorded step with that step's held controls, stopping at game over, at record.steps or
// at MAX_GAME_STEPS, whichever comes first, so it is bounded for every caller (the user, 2026-10-27). Pure and
// synchronous; never throws on a record readRecord accepted.
//
// RED scaffold (DISTILL, rightmove-invaders-replay-verified-scores): it throws until DELIVER builds it (slice 02).
// The acceptance tests import it in Node (the recorded-games check) and load it into the page (the same check in
// Chromium, Firefox and WebKit).
export const __SCAFFOLD__ = true;

// { seed: 32 lowercase hex, record: the raw { rules, steps, keys }, read through readRecord } -> { over, steps, deposit }
export function replay({ seed, record }) {
  throw new Error('__SCAFFOLD__: replay is not yet implemented (replay.js, DDD-R9)');
}
