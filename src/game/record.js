// The game's record (ADR-013, DESIGN DDD-R5): what the player did, by simulation step, from the game's start to its game
// over, so the function can replay the game (ADR-012). Pure: imports nothing (layering rule 8). Shared by both sides of
// the wire, like high-scores.js (layering rule 5): the game records with it, the function and the replay read with it.
//   record = exactly { rules: RULES_VERSION, steps, keys }
//   keys: one entry per change of the held controls, the steps since the last change in lowercase base 36 with no
//   leading zero, then one capital A-H for the three control bits (A holds none ... H holds left, right and fire). The
//   first entry is at step 0 (its delta exactly 0), every later delta is at least 1, every entry changes the controls,
//   every change comes before `steps`, and `steps` is a safe integer of at least 1, so a game has one record and the
//   record carries nothing but the game (clarified in DELIVER).
// The reader judges neither the rules version (only that it is a safe integer) nor the length: the signing judges both,
// one on each side of the reader (DESIGN's Signing checks). A record of other rules than RULES_VERSION is refused as
// rules-changed before it is read (row 12), and one longer than the 60-minute bound, MAX_GAME_STEPS, as game-too-long
// once it has read (row 13; clarified in DISTILL, C3), so a longer record still reads.

export const RULES_VERSION = 1;                    // raised by every change to how the game plays (D10)
export const MAX_GAME_STEPS = 60 * 60 * 120;       // 432,000: 60 minutes of game time at 120 steps a second (D9)
export const CONTROL = Object.freeze({ LEFT: 1, RIGHT: 2, FIRE: 4 });

const LETTERS = 'ABCDEFGH';                        // the controls held, CONTROL bits 0 to 7, as one letter
const ENTRY = /(0|[1-9a-z][0-9a-z]*)([A-H])/g;    // one entry of keys: its delta, with no leading zero, then its letter
const FIELDS = Object.freeze(['keys', 'rules', 'steps']);   // the record's, sorted, and nothing else

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
  if (typeof record !== 'object' || record === null || !hasItsFieldsAlone(record)) return null;
  const { rules, steps, keys } = record;
  if (!Number.isSafeInteger(rules) || !Number.isSafeInteger(steps) || steps < 1 || typeof keys !== 'string') return null;
  const changes = readKeys(keys, steps);
  return changes && { rules, steps, changes };
}

// Whether the record holds rules, steps and keys, and no other field.
const hasItsFieldsAlone = record => {
  const fields = Object.keys(record).sort();
  return fields.length === FIELDS.length && fields.every((field, at) => field === FIELDS[at]);
};

// keys -> the changes they write, or null unless the whole text is entries, each following on from the one before
// (follows), and every one before `steps`.
function readKeys(keys, steps) {
  const changes = [];
  let read = 0, step = 0;
  for (const { 0: entry, 1: delta, 2: letter, index } of keys.matchAll(ENTRY)) {
    const gap = Number.parseInt(delta, 36);
    const controls = LETTERS.indexOf(letter);
    if (index !== read || !follows(changes, gap, controls)) return null;
    step += gap;
    if (step >= steps) return null;
    changes.push([step, controls]);
    read += entry.length;
  }
  return changes.length > 0 && read === keys.length ? changes : null;
}

// Whether an entry `gap` steps on, holding `controls`, follows `changes`: the first comes at step 0, and every later one
// at least a step after the one before, holding other controls.
const follows = (changes, gap, controls) => (changes.length === 0 ? gap === 0 : gap >= 1 && controls !== changes.at(-1)[1]);
