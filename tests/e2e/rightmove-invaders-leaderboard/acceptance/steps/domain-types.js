// The high-score table's test vocabulary: domain nouns only, each one used by a driver. The table rules come from the
// game's own shared module (src/game/high-scores.js, ADR-006) and the event names from src/game/events.js.
// The player-facing wording lives in the .feature files, which are the scenario SSOT ("Wave: DISTILL / [REF] Messages").
// This file holds only the phrases a driver itself waits for or builds: the prompt, "Game started", "Game over" and
// "High-score table unavailable.".
// Technical detail (the persisted key format, header names, log fields, store operations) lives in the table-service
// harness (steps/table-service.js), which maps these domain names onto it.
export { TABLE_SIZE, ALPHABET, INITIALS_LENGTH, BLOCKED_INITIALS, MAX_PLAUSIBLE_SCORE } from '../../../../../src/game/high-scores.js';
export { GameEvent } from '../../../../../src/game/events.js';

// What the status mirror's live region says, where a driver has to recognise it. The initials are typed
// (rightmove-invaders-typed-initials): the prompt is slice 01's words, which slice 02's prompt starts with.
export const Message = Object.freeze({
  INITIALS_PROMPT: 'New high score! Enter your initials: type 3 letters, then press Enter to sign.',
  TABLE_UNAVAILABLE: 'High-score table unavailable.',
  GAME_STARTED: 'Game started',
  GAME_OVER: 'Game over',
});

// A signing as the player arranges it in a Given (browser scenarios).
export const SigningStatus = Object.freeze({ ON_ITS_WAY: 'on its way', CONFIRMED: 'confirmed', OFF_THE_TABLE: 'off the table', UNCONFIRMED: 'unconfirmed' });

// The rules' names for a signing's status (g.signing.status, g.settled.outcome) and the table status (g.table.status).
export const SigningOutcome = Object.freeze({ PENDING: 'pending', CONFIRMED: 'confirmed', OFF_TABLE: 'off-table', UNCONFIRMED: 'unconfirmed' });
export const TableStatus = Object.freeze({ UNKNOWN: 'unknown', AVAILABLE: 'available', UNAVAILABLE: 'unavailable' });

// What can go wrong between the page and the table (injected with page.route, DDD-16).
export const SigningTrouble = Object.freeze({ DROPPED: 'dropped', TURNED_AWAY: 'turned away' });
export const PressSpacing = Object.freeze({ A_FRAME_APART: 'a frame apart', WITHIN_ONE_FRAME: 'within one frame' });

// The Score API's answers that aren't a table (DDD-6). `error` is the JSON body's code; it is also the log reason.
export const Refusal = Object.freeze({
  FORMAT: Object.freeze({ status: 415, error: 'json-required' }),
  TOO_LONG: Object.freeze({ status: 413, error: 'payload-too-large' }),
  NOT_A_SIGNATURE: Object.freeze({ status: 400, error: 'invalid-signature' }),
  INITIALS: Object.freeze({ status: 400, error: 'initials-not-allowed' }),
  IMPLAUSIBLE: Object.freeze({ status: 400, error: 'implausible-score' }),
  READ_OR_SIGN_ONLY: Object.freeze({ status: 405, error: 'method-not-allowed', allow: 'GET, POST' }),
  NOT_SAVED: Object.freeze({ status: 503, error: 'not-saved' }),
  UNEXPECTED: Object.freeze({ status: 500, error: 'unexpected' }),
});

// What the table service can fail at (the harness maps each to a store operation and a fixed log reason).
export const TableAction = Object.freeze({ LOOKING: 'looking', SAVING: 'saving', TIDYING: 'tidying' });
export const TableFailure = Object.freeze({ FAILED_LOOK: 'failed look', FAILED_SAVE: 'failed save', FAILED_TIDY_UP: 'failed tidy-up', UNEXPECTED: 'unexpected failure', DUPLICATE: 'duplicate' });

// Ways of asking the table for something it doesn't do.
export const TableRequest = Object.freeze({ WIPE: 'wipe itself', REPLACE: 'replace its rows' });

export const Limit = Object.freeze({
  PRUNE_AT_MOST: 5,      // scores a signing may tidy away (DDD-1)
});

// How a signing reaches the table (rightmove-invaders-replay-verified-scores). DELIVER flips the switch twice, each time in
// the commit that changes what the function takes (that feature's DISTILL, "Retirement list for DELIVER"):
//   BARE                 today: { initials, score }; other house-hunters' rows are signed through the function itself;
//   SESSION              slice 01: each game asks for a session as it starts, and its signing carries it; other
//                        house-hunters' rows are arranged through the local server's test route (POST /__test/rows);
//   SESSION_AND_RECORD   slice 02 on: the signing also carries the game's record, so every deposit signed in a server
//                        scenario is a game really played in Node (tests/common/played-games.js) and replayed.
export const TableProtocol = Object.freeze({ BARE: 'bare', SESSION: 'session', SESSION_AND_RECORD: 'session and record' });
export const TABLE_PROTOCOL = TableProtocol.SESSION_AND_RECORD;

// Every scenario's clock starts here (page clock and server clock alike).
export const START = new Date('2026-01-01T09:00:00Z');

// Initials for signatures other house-hunters left (never words).
export const OTHER_HOUSE_HUNTERS = Object.freeze(['KIM', 'LEO', 'MAX', 'NED', 'OLA', 'PAM', 'RAY', 'SUE', 'TED', 'VAL', 'WES', 'ZOE']);
