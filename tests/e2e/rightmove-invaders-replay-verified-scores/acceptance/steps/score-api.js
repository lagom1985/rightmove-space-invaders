import { createHash, randomBytes } from 'node:crypto';
import { expect } from '@playwright/test';
import fc from 'fast-check';
import { createSessionSigner, readSessionSecret } from '../../../../../netlify/scores/sessions.mjs';
import { createTablePort, handleScores } from '../../../../../netlify/functions/scores.mjs';
import { TableService, TEST_SECRET } from '../../../rightmove-invaders-leaderboard/acceptance/steps/table-service.js';
import { loadRecordedGames } from '../../../../common/recorded-games.js';
import {
  Refusal, TableFailure, CarriedSession, RecordTwist, RecordFault, HonestPace, SeedRequest, Limit,
  RULES_VERSION, TABLE_PROTOCOL, TableProtocol, OTHER_HOUSE_HUNTERS,
} from './domain-types.js';

// The Score API with sessions and records, driven the way Netlify drives it: the leaderboard's harness
// (TableService: the production handlers and restricted port over a real Blobs emulator, called from Node, with the
// test store port, the server clock, ids and log; docs/architecture/atdd-infrastructure-policy.md), extended with what
// this feature adds. It is the same second composition root: it builds the session signer from a known test secret, as
// the roots build it from theirs (DDD-R17), and hands both handlers `sessions` and `clockAllowanceMs` (10 s).
//
// GAMES. A scenario names its games ("Alex's game", "HAX's game"). A named game is a seed and, from slice 02, a game
// really played in Node to its deposit, with the record the game itself handed its signing (tests/common/
// played-games.js). Alex's game is worth £1,250 (DISCUSS's example); a game "played to £X" is worth X. A signing
// "signs ALX with £1,250" claims what its game played to; only "played to £X, signs … with £Y" claims something else.
// This feature's signings always carry a session (but the walking skeleton's), and carry the record when the scenario
// is about the record, or once TABLE_PROTOCOL says the table takes one (slice 02 on).
//
// TIME. Every session is issued on the table's own clock, through the production handler over the raw store
// (arranged, never acted: its log line is dropped). A signing that carries a record has its session issued as long
// before as the game lasted, plus a second, as a real game's would be, so the clock check (slice 03) only refuses
// what a scenario means it to; a scenario that is about the clock sets the session's age itself.
//
// OBSERVING. The When's answer, its one log line, and the store before and after (the leaderboard's universe: score
// keys and leftovers). A reading taken while a signing is under way is a GET through the production handler over the raw
// store, made the moment the signing's write reaches the store (the test store port's afterWrite), so it neither moves
// the clock nor adds a log line. A row's id is its game id: the first 32 hex characters of the SHA-256 of the seed's
// 32 characters (DDD-R4, clarified in DISTILL), computed here on its own, never by the code under test.

const SCORES_URL = 'http://localhost/api/scores';
const SESSIONS_URL = 'http://localhost/api/sessions';
const CAST = Object.freeze({ Alex: 1250 });
const STEP_MS = 1000 / Limit.STEPS_PER_SECOND;
const LETTERS = 'ABCDEFGH';
const CHUNK = 64 * 1024;
const BURST_RUNS = 20;
const SEED = Number(process.env.FC_SEED ?? 20261023);
const LOCAL = Object.freeze({ scope: 'local', context: 'missing', published: 'missing' });
// Every request carries a client address, as Netlify's do, so the log checks can show it is never written (D15).
const CLIENT_IP = '203.0.113.7';
const fromClient = headers => ({ ...headers, 'x-nf-client-connection-ip': CLIENT_IP, 'x-forwarded-for': CLIENT_IP });

export const gameIdOf = seed => createHash('sha256').update(seed).digest('hex').slice(0, 32);
const freshSeed = () => randomBytes(16).toString('hex');
const json = { 'content-type': 'application/json' };
const gameMs = steps => Math.ceil(steps * STEP_MS);
const recordsByDefault = () => TABLE_PROTOCOL === TableProtocol.SESSION_AND_RECORD;

// ---- the record's wire format (DDD-R5), as a forger writes it ----
function encodeKeys(changes) {
  let last = 0, keys = '';
  for (const [step, bits] of changes) { keys += (step - last).toString(36) + LETTERS[bits]; last = step; }
  return keys;
}
function decodeKeys(keys) {
  let step = 0;
  return [...keys.matchAll(/([0-9a-z]+)([A-H])/g)].map(([, delta, letter]) => [step += Number.parseInt(delta, 36), LETTERS.indexOf(letter)]);
}
const standingStill = steps => ({ rules: RULES_VERSION, steps, keys: '0A' });

// The largest record a human could make in an hour at `pace` changes a second (D20, DDD-R3): as many changes as possible
// two characters apart (a delta of 36 steps), the rest one step apart, each a change from the one before. At 15 a second:
// 54,000 changes, 10,800 of them two characters apart, about 119 KB.
function largestHumanRecord(pace) {
  const steps = 60 * 60 * Limit.STEPS_PER_SECOND, count = 60 * 60 * pace;
  const wide = Math.floor((steps - count) / 35);
  const changes = [[0, 0]];
  for (let i = 1, step = 0; i < count; i++) {
    step += i <= wide ? 36 : 1;
    changes.push([step, i % LETTERS.length]);
  }
  return { rules: RULES_VERSION, steps, keys: encodeKeys(changes) };
}

function twisted(record, twist) {
  if (twist === RecordTwist.OTHER_RULES) return { ...record, rules: RULES_VERSION + 1 };
  if (twist === RecordTwist.GOES_ON) return { ...record, steps: record.steps + 1 };
  const steps = record.steps - 1;
  return { ...record, steps, keys: encodeKeys(decodeKeys(record.keys).filter(([step]) => step < steps)) };
}

function faulty(record, fault) {
  const changes = decodeKeys(record.keys);
  const [, lastBits] = changes.at(-1);
  switch (fault) {
    case RecordFault.KEYS_NOT_TEXT: return { ...record, keys: 12345 };
    case RecordFault.UNKNOWN_LETTER: return { ...record, keys: `0Z${record.keys.slice(2)}` };
    case RecordFault.SAME_STEP_TWICE: return { ...record, keys: `${record.keys.slice(0, 2)}0${LETTERS[(changes[0][1] + 1) % 8]}${record.keys.slice(2)}` };
    case RecordFault.FIRST_CHANGE_LATE: return { ...record, keys: `1${record.keys.slice(1)}` };
    case RecordFault.CHANGE_AT_THE_END: return { ...record, keys: record.keys + (record.steps - changes.at(-1)[0]).toString(36) + LETTERS[(lastBits + 1) % 8] };
    case RecordFault.NO_RULES: { const { rules, ...rest } = record; return rest; }
    case RecordFault.NO_STEPS: return { ...record, steps: 0 };
    default: throw new Error(`unknown fault ${fault}`);
  }
}

// ---- sessions, as a forger alters them ----
function carried(session, how) {
  switch (how) {
    case CarriedSession.ISSUE_TIME_MOVED: return { ...session, issuedAt: session.issuedAt - 60 * 60 * 1000 };
    case CarriedSession.ANOTHER_SEED: return { ...session, seed: freshSeed() };
    case CarriedSession.SEAL_CHANGED: return { ...session, token: (session.token[0] === 'A' ? 'B' : 'A') + session.token.slice(1) };
    case CarriedSession.SEAL_CUT_SHORT: return { ...session, token: session.token.slice(0, -1) };
    case CarriedSession.MADE_UP: return { seed: session.seed, issuedAt: session.issuedAt, token: randomBytes(32).toString('base64url').slice(0, 43) };
    case CarriedSession.NOT_A_SESSION: return 'a session';
    default: return session;
  }
}

// A body of `bytes` bytes or more, of spaces, made only as it is read; `pulled` counts what the reader took.
function endlessBody(bytes) {
  const counter = { pulled: 0 };
  const head = new TextEncoder().encode('{"initials":"HAX","score":50,');
  const stream = new ReadableStream({
    pull(controller) {
      if (counter.pulled >= bytes) { controller.close(); return; }
      const chunk = counter.pulled === 0 ? head : new Uint8Array(CHUNK).fill(32);
      counter.pulled += chunk.byteLength;
      controller.enqueue(chunk);
    },
  }, { highWaterMark: 0 });
  return { stream, counter };
}

const padTo = (text, bytes) => {
  expect(Buffer.byteLength(text), 'the signing is already longer than the padding').toBeLessThanOrEqual(bytes);
  return text + ' '.repeat(bytes - Buffer.byteLength(text));
};

export class ScoreApi extends TableService {
  constructor(emulator) {
    super(emulator);
    this.named = new Map();   // name -> { game: { seed, record, deposit, steps }, sessions: [session], signedAt }
    this.secrets = new Set([CLIENT_IP]); // everything the log must never show: seeds, game ids, tokens, records, initials, the IP
  }

  // The signer is built at the first session a scenario needs, as the roots build it (null once the secret is lost).
  signer() {
    if (this.table.sessions === undefined) this.table.sessions = createSessionSigner(readSessionSecret(TEST_SECRET));
    return this.table.sessions;
  }

  // Too short a string (a record of one change, "0E") could turn up in a log line by chance, so only the long ones.
  remember(...values) {
    values.map(value => (typeof value === 'string' ? value : value && JSON.stringify(value)))
      .filter(value => value?.length >= 3).forEach(value => this.secrets.add(value));
  }

  // ---- games ----
  // name -> its entry, the game played (from slice 02, or whenever `withRecord`) to `deposit`.
  game(name, { deposit = CAST[name], withRecord = recordsByDefault(), where } = {}) {
    if (this.named.has(name)) {
      const entry = this.named.get(name);
      expect(deposit, `${name}'s game was played to £${entry.game.deposit}`).toBe(entry.game.deposit);
      return entry;
    }
    expect(deposit, `the scenario never says what ${name}'s game is worth`).toBeDefined();
    const game = withRecord ? this.table.games.take(deposit, where) : { seed: freshSeed(), record: null, deposit, steps: null };
    const entry = { game, sessions: [], withRecord };
    this.named.set(name, entry);
    this.remember(game.seed, gameIdOf(game.seed), game.record?.keys);
    return entry;
  }

  // A session for the entry's seed, issued `leadMs` before the table's clock now.
  async issue(entry, leadMs = entry.game.record ? gameMs(entry.game.steps) + 1000 : 0) {
    this.signer();
    const session = await this.table.issueSession(entry.game.seed, leadMs);
    entry.sessions.push(session);
    this.remember(session.token);
    return session;
  }

  async sessionFor(entry) { return entry.sessions.at(-1) ?? this.issue(entry); }

  // The signing's body: { initials, score, session, record? }, with the record when the game has one.
  signing(entry, initials, score, session, record = entry.game.record) {
    this.remember(initials);
    return { initials, score, session, ...(record && entry.withRecord ? { record } : {}) };
  }

  async post(body, sent, headers = json) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    await this.act(new Request(SCORES_URL, { method: 'POST', headers: fromClient(headers), body: text }), sent);
  }

  // Arranging through the handler: a signing that must end as `status`.
  async arrangeSigning(entry, initials, status) {
    const session = await this.sessionFor(entry);
    await this.post(this.signing(entry, initials, entry.game.deposit, session), { initials, score: entry.game.deposit });
    expect(this.last.answer.status, `arranging: ${initials}'s signing answered ${this.last.answer.text}`).toBe(status);
    this.table.clock.moveOn(1000);   // time passes before the next signing, even when no listing moved the clock
  }

  // ---- arranging ----
  async gameGivenASession(name) { await this.issue(this.game(name)); }

  async gameHasSigned(name, initials, deposit) { await this.arrangeSigning(this.game(name, { deposit }), initials, 200); }

  async gameSignedThenOwnerDeleted(name, initials, deposit) {
    const entry = this.game(name, { deposit });
    await this.arrangeSigning(entry, initials, 200);
    const [key] = await this.keysOf(entry);
    await this.table.raw.delete(key);
    expect(await this.keysOf(entry), 'arranging: the owner deleted the row').toEqual([]);
  }

  // Better scores are held until 20 outrank the game, so its own signing (21 keys) tidies the lowest away: itself.
  async gameSignedAndTidiedItself(name, initials, deposit) {
    const entry = this.game(name, { deposit });
    const better = (await this.table.snapshot())['table.scores'].length;
    for (let i = better; i < 20; i++) await this.holdSignature(OTHER_HOUSE_HUNTERS[i % OTHER_HOUSE_HUNTERS.length], 3000 + 50 * i, undefined, `better${i}`);
    await this.arrangeSigning(entry, initials, 200);
    expect(await this.keysOf(entry), 'arranging: the signing tidied its own row away').toEqual([]);
  }

  async gameTriedToSignButSavingFailed(name, initials, deposit) {
    const entry = this.game(name, { deposit });
    this.table.test.failing.add('set');
    await this.arrangeSigning(entry, initials, 500);
    this.table.test.failing.delete('set');
  }

  // As above, then the owner deletes one of the better scores, so the table holds 19 above the game: signing it again
  // makes 20 rows, and nothing is tidied away.
  async gameSignedPrunedThenOneBetterDeleted(name, initials, deposit) {
    await this.gameSignedAndTidiedItself(name, initials, deposit);
    const [better] = (await this.table.snapshot())['table.scores'].filter(key => /-better\d+$/.test(key));
    await this.table.raw.delete(better);
  }

  async gameSavedButLookFailed(name, initials, deposit) {
    const entry = this.game(name, { deposit });
    this.table.test.failing.add('list');
    await this.arrangeSigning(entry, initials, 500);
    this.table.test.failing.delete('list');
    expect(await this.keysOf(entry), 'arranging: the row was saved').toHaveLength(1);
  }

  noSecret() { this.table.sessions = null; }

  async sessionThenSecretLost(name) {
    await this.gameGivenASession(name);
    this.noSecret();
  }

  // ---- acting: signings ----
  async signCarrying(name, initials, deposit, how) {
    const entry = this.game(name, { deposit });
    const own = await this.sessionFor(entry);
    const session = how === CarriedSession.ANOTHER_FOR_THE_SAME_GAME ? await this.issue(entry) : carried(own, how);
    if (typeof session === 'object') this.remember(session.token, session.seed, gameIdOf(session.seed));
    await this.post(this.signing(entry, initials, deposit, session), { initials, score: deposit });
  }

  async signAged(name, initials, deposit, ageMs) {
    const entry = this.game(name, { deposit });
    const session = await this.sessionFor(entry);
    this.table.clock.setTo(session.issuedAt + ageMs);
    await this.post(this.signing(entry, initials, deposit, session), { initials, score: deposit });
  }

  async signPlayedTo(name, played, initials, claimed) {
    const entry = this.game(name, { deposit: played, withRecord: true });
    const session = await this.sessionFor(entry);
    await this.post(this.signing(entry, initials, claimed, session), { initials, score: claimed });
  }

  async signWithoutSession(initials, score) {
    this.remember(initials);
    await this.post({ initials, score }, { initials, score });
  }

  async signMadeUpStandingStill(initials, claimed, issuedBeforeMs, lengthMs) {
    const entry = this.forger();
    const record = standingStill(Math.round(lengthMs / STEP_MS));
    const session = await this.issue(entry, issuedBeforeMs + 1000);
    await this.post(this.signing(entry, initials, claimed, session, record), { initials, score: claimed });
  }

  // The cookies that only scripts/serve.mjs reads (DDD-R11, E6), sent to the function's handler: they must change nothing.
  async signAskingForTheLenientClock(name, initials, deposit) {
    const entry = this.game(name, { deposit, withRecord: true });
    const session = await this.issue(entry, 0);
    this.table.clock.setTo(session.issuedAt + 1000);
    await this.post(this.signing(entry, initials, deposit, session), { initials, score: deposit }, { ...json, cookie: 'test-clock=lenient; test-board=a-test-board' });
  }

  async signMadeUpAMinuteAfter(initials, claimed, lengthMs) {
    const entry = this.forger();
    const session = await this.issue(entry, 60_000);
    await this.post(this.signing(entry, initials, claimed, session, standingStill(Math.round(lengthMs / STEP_MS))), { initials, score: claimed });
  }

  // A forger's game: a seed asked for, no game played.
  forger() {
    const entry = { game: { seed: freshSeed(), record: null, deposit: null, steps: null }, sessions: [], withRecord: true };
    this.remember(entry.game.seed, gameIdOf(entry.game.seed));
    return entry;
  }

  async signTwisted(name, initials, deposit, twist) {
    const entry = this.game(name, { deposit, withRecord: true });
    const session = await this.sessionFor(entry);
    await this.post(this.signing(entry, initials, deposit, session, twisted(entry.game.record, twist)), { initials, score: deposit });
  }

  async signFaulty(name, initials, deposit, fault) {
    const entry = this.game(name, { deposit, withRecord: true });
    const session = await this.sessionFor(entry);
    await this.post(this.signing(entry, initials, deposit, session, faulty(entry.game.record, fault)), { initials, score: deposit });
  }

  async signLongestRecorded(initials) {
    const games = await loadRecordedGames();
    expect(games.length, 'no recorded games: make them with node scripts/record-corpus.mjs (milestone 6)').toBeGreaterThan(0);
    const longest = games.reduce((a, b) => (b.steps > a.steps ? b : a));
    const entry = { game: longest, sessions: [], withRecord: true };
    this.remember(longest.seed, gameIdOf(longest.seed));
    const session = await this.issue(entry, gameMs(longest.steps));   // exactly as long before as the game lasted
    await this.post(this.signing(entry, initials, longest.deposit, session), { initials, score: longest.deposit });
  }

  async signStandingStillFor(steps, claimed) {
    const entry = this.forger();
    const session = await this.issue(entry, 61 * 60 * 1000);
    await this.post(this.signing(entry, 'HAX', claimed, session, standingStill(steps)), { initials: 'HAX', score: claimed });
  }

  // ---- acting: the recorded games, signed one after another on one table ----
  async signRecordedGames(games) {
    this.recordedSigned = [];
    for (const [i, game] of games.entries()) {
      const entry = { game, sessions: [], withRecord: true };
      this.remember(game.seed, gameIdOf(game.seed));
      const session = await this.issue(entry, gameMs(game.record.steps));
      await this.post(this.signing(entry, OTHER_HOUSE_HUNTERS[i % OTHER_HOUSE_HUNTERS.length], game.deposit, session), { initials: 'REC', score: game.deposit });
      const { status, body } = this.last.answer;
      this.recordedSigned.push({ name: game.name, status, error: body?.error, steps: this.last.logs[0]?.steps, recordedSteps: game.record.steps });
      this.table.clock.moveOn(1000);
    }
  }

  async signLargestHumanRecord(claimed, pace) {
    const entry = this.forger();
    const session = await this.issue(entry, 61 * 60 * 1000);
    const body = JSON.stringify(this.signing(entry, 'HAX', claimed, session, largestHumanRecord(pace)));
    expect(Buffer.byteLength(body), `the largest record at ${pace} changes a second fits under the 128 KB limit`).toBeLessThanOrEqual(Limit.BODY_CAP);
    await this.post(body, { initials: 'HAX', score: claimed });
  }

  async signPadded(name, initials, deposit, bytes) {
    const entry = this.game(name, { deposit });
    const session = await this.sessionFor(entry);
    await this.post(padTo(JSON.stringify(this.signing(entry, initials, deposit, session)), bytes), { initials, score: deposit });
  }

  async signEndless(bytes) {
    const { stream, counter } = endlessBody(bytes);
    this.counter = counter;
    await this.act(new Request(SCORES_URL, { method: 'POST', headers: fromClient(json), body: stream, duplex: 'half' }), { initials: 'HAX', score: 50 });
  }

  // The game time is a whole number of ms (steps a multiple of 3), so "less 10 seconds" is the boundary exactly.
  async signLessThanItLasted(name, initials, deposit, marginMs) {
    const entry = this.game(name, { deposit, withRecord: true, where: game => game.steps % 3 === 0 });
    const session = await this.issue(entry, 0);
    this.table.clock.setTo(session.issuedAt + entry.game.steps / 3 * 25 - marginMs);   // steps x 1000/120, exactly
    await this.post(this.signing(entry, initials, deposit, session), { initials, score: deposit });
  }

  async signAtPace(name, initials, deposit, pace) {
    const entry = this.game(name, { deposit, withRecord: true });
    const started = this.table.clock.t;
    const lasted = gameMs(entry.game.steps);
    const issuedLate = pace === HonestPace.SLOW_SESSION ? 4000 : 0;
    this.table.clock.setTo(started + issuedLate);
    const session = await this.issue(entry, 0);
    const signedAfterStart = { [HonestPace.SIGNED_AT_ONCE]: lasted + 1000, [HonestPace.SLOW_SESSION]: lasted, [HonestPace.LONG_PAUSE]: lasted + 600_000 + 1000 }[pace];
    this.table.clock.setTo(started + signedAfterStart);
    await this.post(this.signing(entry, initials, deposit, session), { initials, score: deposit });
  }

  // ---- acting: session requests ----
  async askForSession(kind = null) {
    const seed = freshSeed();
    this.remember(seed, gameIdOf(seed));
    const bodies = {
      [SeedRequest.CAPITALS]: JSON.stringify({ seed: seed.toUpperCase() }),
      [SeedRequest.SHORT]: JSON.stringify({ seed: seed.slice(1) }),
      [SeedRequest.NO_SEED]: JSON.stringify({}),
      [SeedRequest.WITH_A_NOTE]: JSON.stringify({ seed, note: 'first game today' }),
      [SeedRequest.GARBLED]: `seed=${seed}`,
      [SeedRequest.WRONG_FORMAT]: JSON.stringify({ seed }),
      [SeedRequest.STRETCHED]: padTo(JSON.stringify({ seed }), Limit.SESSION_BODY_CAP + 1),
    };
    const headers = kind === SeedRequest.WRONG_FORMAT ? { 'content-type': 'text/plain;charset=UTF-8' } : json;
    await this.act(new Request(SESSIONS_URL, { method: 'POST', headers: fromClient(headers), body: bodies[kind] ?? JSON.stringify({ seed }) }), { seed, sessionRequest: true, at: this.table.clock.t });
  }

  async readSessions() {
    await this.act(new Request(SESSIONS_URL, { method: 'GET', headers: fromClient({}) }), { sessionRequest: true });
  }

  // ---- acting: the race (property) ----
  // BURST_RUNS bursts, generated from the fast-check seed: each a fresh table, one game (a played one once the table takes
  // records), `size` signings of it with different initials, some carrying sessions of their own, sent at once while
  // `readers` readings are taken, or the first answered before the rest are sent; then one reading more. Every answer
  // and reading is kept for the Thens.
  async runBursts(least, most) {
    const cases = fc.sample(fc.record({
      size: fc.integer({ min: least, max: most }),
      ownSessions: fc.array(fc.boolean(), { minLength: most, maxLength: most }),
      readers: fc.integer({ min: 1, max: 3 }),
      firstAhead: fc.boolean(),
    }), { seed: SEED, numRuns: BURST_RUNS });
    this.bursts = [];
    for (const burst of cases) this.bursts.push(await this.burst(burst));
  }

  async burst({ size, ownSessions, readers, firstAhead }) {
    const table = this.newTable();
    table.sessions = createSessionSigner(readSessionSecret(TEST_SECRET));
    const withRecord = recordsByDefault();
    const entry = { game: withRecord ? table.games.take(CAST.Alex) : { seed: freshSeed(), record: null, deposit: CAST.Alex }, sessions: [], withRecord };
    const lead = entry.game.record ? gameMs(entry.game.steps) + 1000 : 0;
    const first = await table.issueSession(entry.game.seed, lead);
    const bodies = [];
    for (let i = 0; i < size; i++) {
      const session = ownSessions[i] ? await table.issueSession(entry.game.seed, lead) : first;
      bodies.push(JSON.stringify(this.signing(entry, OTHER_HOUSE_HUNTERS[i], entry.game.deposit, session)));
    }
    const shown = [];
    const read = async () => shown.push((await this.readQuietly(table)).scores);
    const sign = body => table.handle(new Request(SCORES_URL, { method: 'POST', headers: json, body }));
    const ahead = firstAhead ? [await sign(bodies.shift())] : [];
    const signings = bodies.map(sign);
    const readings = Array.from({ length: readers }, read);
    const answers = [...ahead, ...(await Promise.all(signings))];
    await Promise.all(readings);
    await read();
    const last = shown.at(-1);
    for (const answer of answers) if (answer.status === 200) shown.push(answer.body.scores);
    return { id: gameIdOf(entry.game.seed), firstAhead, aheadInitials: OTHER_HOUSE_HUNTERS[0], deposit: entry.game.deposit, statuses: answers.map(answer => answer.status), shown, last };
  }

  // ---- observing ----
  // A GET through the production handler over the raw store: no clock moved, no log line.
  async readQuietly(table = this.table) {
    const answer = await handleScores(new Request(SCORES_URL, { method: 'GET' }), createTablePort(table.raw), { ...table.options(() => {}) });
    return answer.json();
  }

  async keysOf(entry) {
    const id = gameIdOf(entry.game.seed);
    return (await this.table.snapshot())['table.scores'].filter(key => key.endsWith(`-${id}`));
  }

  // The When, with a reading taken the moment its first write reaches the store. The roots always hand the handlers a
  // session signer (null without a secret), so it is built before the first request.
  async act(request, sent = null) {
    this.signer();
    this.midRead = null;
    this.table.test.hooks.afterWrite = async () => {
      this.table.test.hooks.afterWrite = null;
      this.midRead = (await this.readQuietly()).scores;
    };
    try {
      await super.act(request, sent);
    } finally {
      this.table.test.hooks.afterWrite = null;
    }
  }

  isSessionRequest() { return this.last.sent?.sessionRequest === true; }

  expectSessionIssued() {
    this.expectAnswer(200);
    const { session, scores, listedAt } = this.last.answer.body;
    expect(session, 'the answer carries a session').toEqual({ seed: this.last.sent.seed, issuedAt: expect.any(Number), token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(session.issuedAt, 'issued on the table\'s clock, as the request came in').toBeGreaterThanOrEqual(this.last.sent.at);
    expect(session.issuedAt, 'issued on the table\'s clock, no later than its listing').toBeLessThanOrEqual(listedAt);
    expect(Array.isArray(scores), 'the answer carries the table').toBe(true);
  }

  expectNoSessionIssued() {
    expect(this.last.answer.body?.session, `no session should be issued: ${this.last.answer.text}`).toBeUndefined();
    this.expectUnchanged();
  }

  // Every log check here also checks that the line gives nothing away (DDD-R14, US-01): whichever line a scenario reads.
  expectRefusalLogged() {
    if (!this.isSessionRequest()) super.expectRefusalLogged();
    else {
      expect(this.last.logs, 'one log line per request').toHaveLength(1);
      expect(this.last.logs[0]).toMatchObject({ event: 'sessions.rejected', reason: this.lastRefusal.error, ms: expect.any(Number), ...LOCAL });
    }
    this.expectLogSaysNothingAboutThePlayer();
  }

  expectLogged(failure) {
    if (!this.isSessionRequest()) {
      super.expectLogged(failure);
      this.expectLogSaysNothingAboutThePlayer();
      return;
    }
    expect(failure, 'a session request can only fail to look at the table, or unexpectedly').toBe(TableFailure.FAILED_LOOK);
    expect(this.last.logs, 'one log line per request').toHaveLength(1);
    expect(this.last.logs[0]).toMatchObject({ event: 'sessions.error', reason: 'list-failed' });
    this.expectLogSaysNothingAboutThePlayer();
  }

  expectSessionIssuedLogged() {
    expect(this.last.logs, 'one log line per request').toHaveLength(1);
    expect(this.last.logs[0]).toMatchObject({ event: 'sessions.issued', reason: 'ok', ms: expect.any(Number), ...LOCAL });
    this.expectLogSaysNothingAboutThePlayer();
  }

  expectNoSecretLogged() {
    this.expectRefused(Refusal.UNEXPECTED);
    expect(this.last.logs, 'one log line per request').toHaveLength(1);
    expect(this.last.logs[0]).toMatchObject({ event: this.isSessionRequest() ? 'sessions.error' : 'scores.error', reason: 'secret-missing', ...LOCAL });
    this.expectLogSaysNothingAboutThePlayer();
  }

  // DDD-R14: a line that replayed carries the game's length in steps and how long the replay took; one that didn't, neither.
  expectReplayed() {
    expect(this.last.logs, 'one log line per request').toHaveLength(1);
    expect(this.last.logs[0], 'a replayed signing logs its steps and replayMs').toMatchObject({ steps: expect.any(Number), replayMs: expect.any(Number) });
    this.expectLogSaysNothingAboutThePlayer();
  }

  expectNeverReplayed() {
    expect(this.last.logs, 'one log line per request').toHaveLength(1);
    expect(this.last.logs[0], 'a signing refused before its replay').not.toHaveProperty('replayMs');
    expect(this.last.logs[0], 'a signing refused before its replay').not.toHaveProperty('steps');
    this.expectLogSaysNothingAboutThePlayer();
  }

  // DDD-17 and DDD-R14: never a key, initials, an id, a seed, a game id, a token or a record.
  expectLogSaysNothingAboutThePlayer() {
    super.expectLogSaysNothingAboutThePlayer();
    const logged = JSON.stringify(this.last.logs);
    for (const secret of this.secrets) expect(logged, 'the log gives away something about the player or their game').not.toContain(secret);
  }

  expectShowsOnce(rows, initials, deposit, absent) {
    expect(rows, 'nothing was read').toBeDefined();
    expect(rows.filter(row => row.initials === initials && row.score === deposit), `${initials} with £${deposit}`).toHaveLength(1);
    if (absent) expect(rows.filter(row => row.initials === absent), `rows for ${absent}`).toEqual([]);
  }

  expectMidReadShowsOnce(initials, deposit, absent) {
    expect(this.midRead, 'the signing never reached the store, so nothing was read while it was under way').not.toBeNull();
    this.expectShowsOnce(this.midRead, initials, deposit, absent);
  }

  async expectNowShowsOnce(initials, deposit, absent) {
    this.expectShowsOnce((await this.readQuietly()).scores, initials, deposit, absent);
  }

  // Each recorded game was saved at its recorded deposit, after a replay of every step it recorded (DDD-R12, K21).
  expectRecordedGamesSaved() {
    expect(this.recordedSigned.filter(({ status }) => status !== 200).map(({ name, error }) => `${name}: ${error}`), 'recorded games the table refused').toEqual([]);
    expect(this.recordedSigned.filter(({ steps, recordedSteps }) => steps !== recordedSteps).map(({ name }) => name), 'recorded games not played back to their last step').toEqual([]);
  }

  expectOnlyRecordedGameRefused(name) {
    expect(this.recordedSigned.filter(({ status }) => status !== 200).map(({ name: game, status, error }) => ({ game, status, error })), 'recorded games the table refused')
      .toEqual([{ game: name, status: 400, error: 'replay-mismatch' }]);
  }

  // The body arrives in pieces of CHUNK bytes, so "soon after" is the limit and the one piece that crossed it.
  expectReadStoppedNearTheLimit() {
    expect(this.counter.pulled, 'bytes the table read').toBeLessThanOrEqual(Limit.BODY_CAP + CHUNK);
  }

  // D7, DDD-R4: whatever order the writes, listings and removals interleave in, no answer and no reading shows two rows
  // for one game. The store itself may hold a loser's key for a moment (and, on the emulator, whose listings can come back
  // short during concurrent writes, until pruning removes it): only what anyone is shown is asserted. A signing is saved
  // (200) or refused as already signed (409); with initials of their own, no two signings share a key.
  expectNeverTwoRowsForOneGame() {
    for (const { id, statuses, shown } of this.bursts) {
      for (const rows of shown) expect(rows.filter(row => row.id === id).length, 'rows shown for one game').toBeLessThanOrEqual(1);
      expect(statuses.every(status => status === 200 || status === 409), `answers: ${statuses}`).toBe(true);
    }
  }

  // Not vacuous: a race may leave no row (DDD-R4), but a signing that arrived ahead was saved, and its game's row is the
  // one the last reading shows. At least one burst sends one ahead.
  expectFirstAheadKeptItsRow() {
    const ahead = this.bursts.filter(({ firstAhead }) => firstAhead);
    expect(ahead.length, `bursts with a signing ahead, of ${this.bursts.length}`).toBeGreaterThan(0);
    for (const { id, aheadInitials, deposit, statuses, last } of ahead) {
      expect(statuses[0], 'the signing that arrived ahead').toBe(200);
      expect(last.filter(row => row.id === id), 'the game\'s row in the last reading').toEqual([{ initials: aheadInitials, score: deposit, id }]);
    }
  }
}
