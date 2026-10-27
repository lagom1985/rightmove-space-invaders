// The game's record (ADR-013, DESIGN DDD-R5): what the player did, by simulation step, from the game's start to its game
// over, so the function can replay the game (ADR-012). Pure: imports nothing (layering rule 8). Shared by both sides of
// the wire, like high-scores.js (layering rule 5): the game records with it, the replay reads with it.
//   record = { rules: RULES_VERSION, steps, keys }
//   keys: one entry per change of the held controls, the steps since the last change in lowercase base 36, then one
//   capital A-H for the three control bits (A holds none ... H holds left, right and fire). The first entry is at step 0,
//   every later delta is at least 1, every change comes before `steps`, and `steps` is a safe integer of at least 1. The
//   60-minute bound (MAX_GAME_STEPS) is the signing's next check, game-too-long, not the reader's (clarified in
//   DISTILL, C3), so a longer record still reads.

export const RULES_VERSION = 1;                    // raised by every change to how the game plays (D10)
export const MAX_GAME_STEPS = 60 * 60 * 120;       // 432,000: 60 minutes of game time at 120 steps a second (D9)
export const CONTROL = Object.freeze({ LEFT: 1, RIGHT: 2, FIRE: 4 });

const LETTERS = 'ABCDEFGH';                        // the controls held, CONTROL bits 0 to 7, as one letter
const ENTRY = /([0-9a-z]+)([A-H])/g;              // one entry of keys: its delta, then its letter

// -> a recorder the game keeps from its start to its game over (DDD-R8): step(controls) once a step, with the CONTROL
// bits held at it, and record() -> the record of the steps so far.
export function createRecorder() {
  let steps = 0, keys = '', held = null, heldSince = 0;
  function step(controls) {
    if (controls !== held) {
      keys += `${(steps - heldSince).toString(36)}${LETTERS[controls]}`;
      held = controls;
      heldSince = steps;
    }
    steps++;
  }
  const record = () => ({ rules: RULES_VERSION, steps, keys });
  return Object.freeze({ step, record });
}

// record -> { rules, steps, changes: [[step, controls], ...] }, or null for anything that isn't a record (DDD-R5).
export function readRecord(record) {
  if (typeof record !== 'object' || record === null) return null;
  const { rules, steps, keys } = record;
  if (!Number.isSafeInteger(rules) || !Number.isSafeInteger(steps) || steps < 1 || typeof keys !== 'string') return null;
  const changes = readKeys(keys, steps);
  return changes && { rules, steps, changes };
}

// keys -> the changes they write, or null unless the whole text is entries, the first at step 0, each later one at least
// a step after the one before, and every one before `steps`.
function readKeys(keys, steps) {
  const changes = [];
  let read = 0, step = 0;
  for (const { 0: entry, 1: delta, 2: letter, index } of keys.matchAll(ENTRY)) {
    const gap = Number.parseInt(delta, 36);
    const first = changes.length === 0;
    if (index !== read || (first ? gap !== 0 : gap < 1)) return null;
    step += gap;
    if (step >= steps) return null;
    changes.push([step, LETTERS.indexOf(letter)]);
    read += entry.length;
  }
  return changes.length > 0 && read === keys.length ? changes : null;
}
