// The replay-verified table's test vocabulary: domain nouns only, each one used by a driver. The high-score table's own
// vocabulary (refusals, failures, messages, START, the other house-hunters) is the leaderboard's, re-exported here; the
// record's constants are the game's own (src/game/record.js). Technical detail (the session's fields, the record's
// wire format, log fields) lives in the drivers: steps/score-api.js and steps/verified-game.js.
export {
  Refusal, TableFailure, Message, START, OTHER_HOUSE_HUNTERS, TABLE_PROTOCOL, TableProtocol, MAX_PLAUSIBLE_SCORE,
} from '../../../rightmove-invaders-leaderboard/acceptance/steps/domain-types.js';
export { RULES_VERSION, MAX_GAME_STEPS } from '../../../../../src/game/record.js';

// The Score API's new answers to a signing (DESIGN, Signing checks; DDD-R14). `error` is the JSON body's code and the
// log reason. Those the leaderboard already names (too long, for its format, as not a signature, as implausible) are its.
export const Verdict = Object.freeze({
  NO_SESSION: Object.freeze({ status: 400, error: 'session-required' }),
  UNSEALED_SESSION: Object.freeze({ status: 400, error: 'invalid-session' }),
  EXPIRED_SESSION: Object.freeze({ status: 400, error: 'session-expired' }),
  ALREADY_SIGNED: Object.freeze({ status: 409, error: 'already-signed' }),
  NOT_A_RECORD: Object.freeze({ status: 400, error: 'invalid-record' }),
  OTHER_RULES: Object.freeze({ status: 400, error: 'rules-changed' }),
  OVER_AN_HOUR: Object.freeze({ status: 400, error: 'game-too-long' }),
  FASTER_THAN_THE_CLOCK: Object.freeze({ status: 400, error: 'too-fast' }),
  NOT_THE_GAME_IT_CLAIMS: Object.freeze({ status: 400, error: 'replay-mismatch' }),
});

// The session request's answers that aren't a session (DDD-R1).
export const SessionRefusal = Object.freeze({
  NOT_A_SEED: Object.freeze({ status: 400, error: 'invalid-seed' }),
  FORMAT: Object.freeze({ status: 415, error: 'json-required' }),
  TOO_LONG: Object.freeze({ status: 413, error: 'payload-too-large' }),
  ASK_ONLY: Object.freeze({ status: 405, error: 'method-not-allowed', allow: 'POST' }),
});

// What a signing carries in place of the session its game was given.
export const CarriedSession = Object.freeze({
  ITS_OWN: 'its own',
  THE_ONE_IT_SIGNED_WITH: 'the one it signed with',
  ANOTHER_FOR_THE_SAME_GAME: 'another for the same game',
  ISSUE_TIME_MOVED: 'issue time moved',
  ANOTHER_SEED: 'another seed',
  SEAL_CHANGED: 'seal changed',
  SEAL_CUT_SHORT: 'seal cut short',
  MADE_UP: 'made up',
  NOT_A_SESSION: 'not a session',
});

// A record that isn't the game it came with: it ends in the wrong place, or names other rules.
export const RecordTwist = Object.freeze({ STOPS_EARLY: 'stops early', GOES_ON: 'goes on', OTHER_RULES: 'other rules' });

// Something that isn't a record (DDD-R5): each breaks one rule of the reader.
export const RecordFault = Object.freeze({
  KEYS_NOT_TEXT: 'keys not text',
  UNKNOWN_LETTER: 'unknown letter',
  SAME_STEP_TWICE: 'same step twice',
  FIRST_CHANGE_LATE: 'first change late',
  CHANGE_AT_THE_END: 'change at the end',
  NO_RULES: 'no rules',
  NO_STEPS: 'no steps',
});

// How an honest game was played and signed, against the clock (US-05).
export const HonestPace = Object.freeze({ SIGNED_AT_ONCE: 'signed at once', SLOW_SESSION: 'slow session', LONG_PAUSE: 'long pause' });

// What a game's session request does, in the browser (US-02).
export const SessionAnswer = Object.freeze({ AT_ONCE: 'at once', LATE: 'late', FAILS: 'fails', NEVER: 'never' });

// What a request for a session can be instead of { seed } (DDD-R1).
export const SeedRequest = Object.freeze({
  CAPITALS: 'capitals', SHORT: 'short', NO_SEED: 'no seed', WITH_A_NOTE: 'with a note', GARBLED: 'garbled',
  WRONG_FORMAT: 'wrong format', STRETCHED: 'stretched',
});

export const Limit = Object.freeze({
  SESSION_LIFETIME_MS: 2 * 60 * 60 * 1000,   // D18
  CLOCK_ALLOWANCE_MS: 10_000,                // D8, DDD-R11
  BODY_CAP: 128 * 1024,                      // DDD-R3: a signing, 131,072 bytes
  SESSION_BODY_CAP: 1024,                    // DDD-R1: a session request
  HUMAN_PACE: 15,                            // changes of held keys a second, sustained (D20)
  STEPS_PER_SECOND: 120,
});
