// Shared high-score rules (ADR-006, DDD-3): one rule on both sides of the wire. Pure: imports nothing.
// src/game/game.js uses all of it; netlify/functions/scores.mjs uses the table size and signature validity (word filter
// included); only the browser uses makesTheTable.

export const TABLE_SIZE = 10;                          // rows on the shared table
export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';  // arcade initials, Up and Down move round it
export const INITIALS_LENGTH = 3;
export const SCORE_STEP = 50;                          // every hurdle value and Dream Home bonus is a multiple of £50
export const MAX_SCORE = 9_999_999;                    // the 7-digit score field of a row's key (ADR-004)

// The 3-letter word filter: short, public (it ships to the browser) and reviewed by the owner. The acceptance tests take
// their blocked example from here.
export const BLOCKED_INITIALS = Object.freeze(['ASS', 'COK', 'CUM', 'DIK', 'FAG', 'FCK', 'FUC', 'FUK', 'KKK', 'NAZ', 'NGR', 'NIG', 'PIS', 'SEX', 'SHT', 'TIT']);

// { initials, score } (exactly these two fields) -> true when the initials are 3 letters A-Z (word filter aside) and the
// score is a positive integer multiple of SCORE_STEP up to MAX_SCORE. The function refuses blocked initials separately
// (400 initials-not-allowed), so validity and the word filter are two questions.
const SIGNATURE_FIELDS = Object.freeze(['initials', 'score']);

const hasExactlyTheFields = signature => typeof signature === 'object' && signature !== null &&
  Object.keys(signature).length === SIGNATURE_FIELDS.length && SIGNATURE_FIELDS.every(field => Object.hasOwn(signature, field));
const isInitialsShape = initials => typeof initials === 'string' && initials.length === INITIALS_LENGTH &&
  [...initials].every(letter => ALPHABET.includes(letter));
const isScore = score => Number.isSafeInteger(score) && score > 0 && score % SCORE_STEP === 0 && score <= MAX_SCORE;

export function isValidSignature(signature) {
  return hasExactlyTheFields(signature) && isInitialsShape(signature.initials) && isScore(signature.score);
}

// initials -> true when they are INITIALS_LENGTH letters of ALPHABET and not in BLOCKED_INITIALS.
export function isAllowedInitials(initials) {
  return isInitialsShape(initials) && !BLOCKED_INITIALS.includes(initials);
}

// table state { status: 'unknown' | 'available' | 'unavailable', rows: [{ initials, score, id }] best first }, deposit
// -> true only when the status is 'available', the deposit is above 0, and there are fewer than TABLE_SIZE rows or the
// deposit is above the 10th row's score (a tie misses).
export function makesTheTable({ status, rows }, deposit) {
  return status === 'available' && deposit > 0 && (rows.length < TABLE_SIZE || deposit > rows[TABLE_SIZE - 1].score);
}
