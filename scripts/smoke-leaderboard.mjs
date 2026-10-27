// Preview smoke test of the high-score table on Netlify: the DEVOPS spec "Preview smoke test" in
// docs/feature/rightmove-invaders-leaderboard/feature-delta.md (K10-K14), and with --slice its extension for that slice of
// rightmove-invaders-replay-verified-scores (its feature-delta.md, DEVOPS "Preview smoke test, extended", Slice gates),
// step for step. Node 22 fetch, no dependencies; the valid and blocked initials come from the rules the function bundles
// (src/game/high-scores.js), and the public test secret's probe is sealed as a root seals a session
// (netlify/scores/sessions.mjs, tests/common/session-secret.js). From slice 02 every signing carries its game's record,
// so the games are made in Node on the real rules (src/game/game.js, record.js and replay.js, through tests/common/
// played-games.js and recorded-games.js), and each replays to its own deposit and length before the run sends anything.
//
//   --site <name> --preview <URL> [--slice 01|02] [--production <URL>] [--permalink <URL>]    preview run: the
//       leaderboard's steps 1 and 4-10 (K10, K12, K14); with --slice, that slice's gate steps, signing in its shape (01:
//       S1, S2, S4, S4c, S4b, S5, S3, S6 and S6b; 02: S1, the write guard's opening GET, then S7, S8, S9, S9b and S9c)
//   --site <name> --burst <URL> [--slice 02]    burst run on a throwaway preview whose only change removes rateLimit:
//       steps 1-3 (K11); with --slice 02, S10 (K11, K20)
//   --production <URL>                 production mode, P1 (K13): one GET, never a POST
//   --site <name> --unpublished <permalink> --production <URL> [--slice 01|02] [--site-id <ID>]    unpublished check,
//       U1-U3 (K13), U2 signing as the permalink's code does (from --slice 01, through a session from that permalink; from
//       --slice 02, with a record too): the published deploy's ID comes from Netlify's API with NETLIFY_AUTH_TOKEN and
//       --site-id, or the owner types it back
//
// It prints one JSON summary on stdout (progress goes to stderr) and exits 0 when every hard check passed; 1 when one
// failed or was inconclusive (an inconclusive step is never a pass), the run was stopped, or the command was malformed;
// 2 when the write guard refused, and nothing was written. One limiter holds every request to at most 10 per 60 s per
// host, counted across steps; only the over-limit steps (2, 8a, 8b, 8c, 8d, 9, S10.2 and S10.4) bypass it, each with a
// 61 s wait before and after.
// It needs a pushed deploy, so it runs only with the owner's OK to push (DEVOPS pre-requisite 9). The token stays in the
// owner's shell: it goes to api.netlify.com only, and is never printed or written.
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createInterface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { STEP } from '../src/game/config.js';
import { ALPHABET, BLOCKED_INITIALS, MAX_PLAUSIBLE_SCORE, SCORE_STEP, TABLE_SIZE, isAllowedInitials } from '../src/game/high-scores.js';
import { MAX_GAME_STEPS, RULES_VERSION, createRecorder, readRecord } from '../src/game/record.js';
import { replay } from '../src/game/replay.js';
import { createSessionSigner, readSessionSecret } from '../netlify/scores/sessions.mjs';
import { playGame, players, seedFor } from '../tests/common/played-games.js';
import { loadRecordedGames } from '../tests/common/recorded-games.js';
import { TEST_SECRET } from '../tests/common/session-secret.js';

// ---- the write guard: decided before every POST, in every mode; a refusal writes nothing ----

export const Refusal = Object.freeze({
  NO_SITE: 'no-site',                            // --site is missing, or isn't a Netlify site name
  PRODUCTION_HOST: 'production-host',            // <site>.netlify.app, or the production branch's main--<site>.netlify.app
  PERMALINK: 'permalink',                        // a deploy permalink, outside the unpublished check
  NOT_A_PREVIEW: 'not-a-preview',                // any other host: the custom domain, another site, another domain
  NOT_A_PERMALINK: 'not-a-permalink',            // the unpublished check aims at a permalink of the site, nothing else
  PUBLISHED_UNKNOWN: 'published-deploy-unknown', // the published deploy's ID couldn't be learned
  PUBLISHED_DEPLOY: 'published-deploy',          // the permalink is the published deploy's
  NO_EMPTY_FIRST_GET: 'no-empty-first-get',      // the host's first request wasn't a GET that answered 200 with scores: []
});

// A site name, and a subdomain prefix: deploy-preview-<n>, or a branch name as Netlify writes it into a hostname.
const LABEL = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEPLOY_ID = /^[0-9a-f]{24}$/;   // a deploy's ID, the prefix of its permalink
const isDeployId = id => typeof id === 'string' && DEPLOY_ID.test(id);
const PRODUCTION_BRANCH = 'main';
const ALLOWED = Object.freeze({ allowed: true });
const refused = reason => Object.freeze({ allowed: false, reason });

// The site's hosts on netlify.app: 'production', 'permalink' (with its deploy ID), 'preview' (a deploy preview or a branch
// deploy), or 'other'.
function hostOf(site, hostname) {
  const suffix = `--${site}.netlify.app`;
  if (hostname === `${site}.netlify.app`) return { kind: 'production' };
  if (!hostname.endsWith(suffix)) return { kind: 'other' };
  const prefix = hostname.slice(0, -suffix.length);
  if (prefix === PRODUCTION_BRANCH) return { kind: 'production' };
  if (DEPLOY_ID.test(prefix)) return { kind: 'permalink', deployId: prefix };
  return { kind: LABEL.test(prefix) ? 'preview' : 'other' };
}

// Rule 1, outside the unpublished check: the site's deploy previews and branch deploys only.
const OUTSIDE_THE_CHECK = Object.freeze({ production: Refusal.PRODUCTION_HOST, permalink: Refusal.PERMALINK, other: Refusal.NOT_A_PREVIEW });
const previewRefusal = host => OUTSIDE_THE_CHECK[host.kind];

// Rule 2, the unpublished check: a permalink of the site only, and only when the published deploy's ID is known and isn't
// the permalink's.
function permalinkRefusal(host, publishedId) {
  if (host.kind !== 'permalink') return Refusal.NOT_A_PERMALINK;
  if (!isDeployId(publishedId)) return Refusal.PUBLISHED_UNKNOWN;
  return publishedId === host.deployId ? Refusal.PUBLISHED_DEPLOY : undefined;
}

// Rule 3: the host's first request was a GET that answered 200 with an empty table. The production table has rows.
const isEmptyTable = answer => answer?.method === 'GET' && answer.status === 200 &&
  Array.isArray(answer.body?.scores) && answer.body.scores.length === 0;

// { site (from --site), url (the POST's), unpublished: { publishedId } in the unpublished check only, with the ID learned
// from Netlify's API or typed back by the owner (null when it couldn't be learned), firstAnswer: { method, status, body }
// of the run's first request to the host } -> { allowed: true } or { allowed: false, reason: a Refusal }. Pure.
export function decidePost({ site, url, unpublished = null, firstAnswer }) {
  if (typeof site !== 'string' || !LABEL.test(site)) return refused(Refusal.NO_SITE);
  if (!URL.canParse(url)) return refused(Refusal.NOT_A_PREVIEW);
  const host = hostOf(site, new URL(url).hostname);
  const hostRefusal = unpublished ? permalinkRefusal(host, unpublished.publishedId) : previewRefusal(host);
  if (hostRefusal) return refused(hostRefusal);
  return isEmptyTable(firstAnswer) ? ALLOWED : refused(Refusal.NO_EMPTY_FIRST_GET);
}

class GuardRefusal extends Error {
  constructor(reason, url) {
    super(`the write guard refused: ${reason}`);
    this.reason = reason;
    this.host = URL.canParse(url) ? new URL(url).hostname : String(url);
  }
}

// Before a run sends anything: refuse now, unless every objection is one the run can still clear.
function refuseUnless(decision, url, ...clearable) {
  if (!decision.allowed && !clearable.includes(decision.reason)) throw new GuardRefusal(decision.reason, url);
}


// ---- the client: every POST passes the guard first, and the pacing holds outside the over-limit steps ----

const WINDOW_MS = 60_000;
const LIMIT = 10;   // config.rateLimit: 10 requests per 60 s per IP and domain
// The run's clock, a port: now() in ms since the epoch, and sleep(ms). The unit tests hand in a virtual one.
const SYSTEM_CLOCK = Object.freeze({ now: () => Date.now(), sleep: ms => delay(Math.max(0, ms)) });

// One request and its answer, timed on the client with the body read. A redirect is an answer, never a request to a host
// the guard didn't decide on. No answer at all (the network failed) is status 0.
async function exchange(fetch, clock, url, init) {
  const sentAt = clock.now();
  const elapsed = () => clock.now() - sentAt;
  try {
    const response = await fetch(url, { ...init, redirect: 'manual' });
    const body = await response.json().catch(() => null);
    return { status: response.status, headers: Object.fromEntries(response.headers), body, sentAt, ms: elapsed() };
  } catch {
    return { status: 0, headers: {}, body: null, sentAt, ms: elapsed() };
  }
}

// A request that would be the 11th to its host in the last 60 s waits for the oldest to age out. The window slides
// across steps, and holds the over-limit steps' requests too.
async function withinTheLimit(sentTimes, clock) {
  for (;;) {
    const recent = sentTimes.filter(time => time > clock.now() - WINDOW_MS);
    if (recent.length < LIMIT) return;
    await clock.sleep(recent[0] + WINDOW_MS - clock.now());
  }
}

// { site, unpublished (as decidePost takes it), fetch (the network port), clock (the clock port) } -> { get(url,
// { overLimit }), post(url, body, { overLimit, headers }) }, each resolving to { status, headers, body, sentAt, ms }; a
// refused POST rejects with the guard's reason and sends nothing. A session request is a POST, so the guard decides it.
export function createSmokeClient({ site, unpublished = null, fetch = globalThis.fetch, clock = SYSTEM_CLOCK }) {
  const firstAnswers = new Map();   // hostname -> the run's first answer from it (rule 3)
  const sentTimes = new Map();      // hostname -> send times, for the pacing

  async function send(url, init, overLimit) {
    const host = new URL(url).hostname;
    const isFirst = !sentTimes.has(host);   // the first sent, whichever answers first
    if (isFirst) sentTimes.set(host, []);
    if (!overLimit) await withinTheLimit(sentTimes.get(host), clock);
    sentTimes.get(host).push(clock.now());
    const answer = await exchange(fetch, clock, url, init);
    if (isFirst) firstAnswers.set(host, { method: init.method, status: answer.status, body: answer.body });
    return answer;
  }

  return Object.freeze({
    get: (url, { overLimit = false } = {}) => send(url, { method: 'GET' }, overLimit),
    async post(url, body, { overLimit = false, headers = {} } = {}) {
      const firstAnswer = URL.canParse(url) ? firstAnswers.get(new URL(url).hostname) : undefined;
      const decision = decidePost({ site, url, unpublished, firstAnswer });
      if (!decision.allowed) throw new GuardRefusal(decision.reason, url);
      const init = { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) };
      return send(url, init, overLimit);
    },
  });
}

// ---- the steps (the specs' tables): each resolves to one entry of the summary ----

const SCORES_PATH = '/api/scores';
const SESSIONS_PATH = '/api/sessions';
const TEST_ROWS_PATH = '/__test/rows';   // the local server's test route (DDD-R17), which the function never serves
const COOL_DOWN_MS = 61_000;   // before and after each over-limit step, and before S4c
const CACHE_TTL_MS = 15_000;   // the GET cache at the CDN (DDD-6)
const BURST_SIZE = 20;
const PAIRS = 30;              // pairs, and sessions, in a K10 or K25 step
const PACE_MS = 13_000;        // one session request, or one pair, every 13 s: 4.6 or 9.2 requests a minute
const P95_UNDER_MS = 1000;
const LIMIT_WITH_LAG = 13;     // K14: about 13 accepted before the first 429, with Netlify's enforcement lag
const MIXED_ACCEPTED_AT_MOST = 18;
const OVER_LIMIT = Object.freeze({ overLimit: true });
// Netlify's API: the site's published deploy is published_deploy.id in getSite, GET /api/v1/sites/{site_id} (DEVOPS
// write guard, rule 2). Checked against the OpenAPI reference (https://open-api.netlify.com/, operation getSite): the
// Site object's published_deploy is a Deploy object, and a Deploy's id is a string. The reference doesn't document the
// id's format: the 24 hex digits a permalink starts with (DEPLOY_ID) are this script's assumption, kept fail-closed, so
// an id of any other shape refuses.
const PUBLISHED_DEPLOY_ID_FIELD = Object.freeze(['published_deploy', 'id']);
const NETLIFY_SITES_API = 'https://api.netlify.com/api/v1/sites/';

// Valid initials for the smoke signatures, and initials on the word filter for step 4 and S4b, from the bundled rules.
const SIGNERS = [...ALPHABET].map(letter => `SM${letter}`).filter(isAllowedInitials);
const BLOCKED = BLOCKED_INITIALS[0];
const signerAt = i => SIGNERS[i % SIGNERS.length];
const signature = i => ({ initials: signerAt(i), score: (i + 1) * SCORE_STEP });
// The i-th signing of a game made in Node claims its deposit, or `score` when a step means it to claim another.
const claimOf = (game, i, score = game.deposit) => ({ initials: signerAt(i), score });
// A seed of 32 hex digits, uppercase: the near miss of a seed that S4 sends, refused as invalid-seed.
const MALFORMED_SEED = '0123456789ABCDEF0123456789ABCDEF';

const at = (base, path, query = '') => new URL(`${path}${query}`, base).href;
const scoresAt = (base, query = '') => at(base, SCORES_PATH, query);
const sessionsAt = base => at(base, SESSIONS_PATH);
const missQuery = () => `?table=${randomUUID()}`;   // a cache miss by design (Netlify-Vary: query=table)
const freshSeed = () => randomBytes(16).toString('hex');   // 32 lowercase hex digits, as a game's seed (DDD-R1)
const rowsOf = body => (Array.isArray(body?.scores) ? body.scores : []);
const idsOf = body => rowsOf(body).map(row => row.id);
const isEmptyList = body => Array.isArray(body?.scores) && body.scores.length === 0 && Number.isFinite(body.listedAt);
const hasNoStore = answer => /\bno-store\b/.test(answer.headers['cache-control'] ?? '');
const passOrFail = pass => (pass ? 'pass' : 'fail');
const p95Of = samples => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1];   // the 29th of 30
const isoAt = ms => new Date(ms).toISOString();
const toStderr = message => process.stderr.write(`${message}\n`);
const until = async (run, time) => { if (time > run.clock.now()) await run.clock.sleep(time - run.clock.now()); };
const coolDown = async run => { run.progress('waiting 61 s for the rate-limit window to clear'); await run.clock.sleep(COOL_DOWN_MS); };

// Cache-Status (RFC 9211): one member per cache, each with parameters; `hit` on any member means no function ran.
const isHit = (cacheStatus = '') => cacheStatus.split(',')
  .some(member => member.split(';').slice(1).some(parameter => parameter.trim() === 'hit'));

// A step's entry, with when it started and finished on the run's clock (to find its log lines by), renamed `step` when
// a slice's run names it its own way.
async function timed(run, takeStep, step) {
  const startedAt = run.clock.now();
  const entry = await takeStep(run);
  return { ...entry, ...(step && { step }), startedAt: isoAt(startedAt), finishedAt: isoAt(run.clock.now()) };
}

// ---- games made in Node, on the real rules (DEVOPS "Records made in Node") ----

const STEPS_A_SECOND = Math.round(1 / STEP);              // 120
const STEPS_A_MINUTE = 60 * STEPS_A_SECOND;
const SCRIPTED_AT_MOST_STEPS = 30 * STEPS_A_SECOND;       // a scripted game kept lasts at most 30 s
const TEN_MINUTES = Object.freeze([9 * STEPS_A_MINUTE, 11 * STEPS_A_MINUTE]);   // a 10-minute game lasts 9 to 11
const LONG_AT_LEAST_STEPS = 15 * STEPS_A_MINUTE;          // the corpus's longest game: 15 minutes or more (K22)
const TRIES = 600;                                        // seeds played for a kind of game, before giving up

// `count` games, each played by a fresh player from `play()`, that `keeps(game, kept)` keeps, for seeds in a fixed order,
// so every run makes the same ones; only games that asked for initials (a record) count.
function gamesFound(kind, count, play, keeps) {
  const kept = [];
  for (let i = 0; kept.length < count && i < TRIES; i++) {
    const game = playGame({ seed: seedFor(`a smoke-test ${kind}, try ${i}`), player: play() });
    if (game.record && keeps(game, kept)) kept.push(game);
  }
  if (kept.length < count) throw new Error(`only ${kept.length} of ${count} ${kind}s in ${TRIES} seeds`);
  return kept;
}

const hasNewDeposit = (game, kept) => !kept.some(other => other.deposit === game.deposit);

// The games the script signs, made in Node: { scripted(count), tenMinute(count), longest() }, each resolving to games
// { seed, record, deposit, steps } (tests/common/played-games.js). Scripted games stand still and hold fire, and those of
// at most 30 s are kept, each with a deposit of its own; 10-minute games are the corpus bot's (players.greedy), of 9 to
// 11 minutes; the long game is the recorded corpus's longest, of 15 minutes or more. Playing takes milliseconds a game,
// about 7 s for 30 games of 10 minutes.
export function createNodeGames() {
  return Object.freeze({
    scripted: async count => gamesFound('scripted game', count, players.standStillFiring,
      (game, kept) => game.steps <= SCRIPTED_AT_MOST_STEPS && hasNewDeposit(game, kept)),
    tenMinute: async count => gamesFound('10-minute game', count, players.greedy,
      game => game.steps >= TEN_MINUTES[0] && game.steps <= TEN_MINUTES[1]),
    async longest() {
      const corpus = await loadRecordedGames();
      const long = corpus.reduce((longest, game) => (game.steps > (longest?.steps ?? 0) ? game : longest), null);
      if (!(long?.steps >= LONG_AT_LEAST_STEPS)) throw new Error('the recorded corpus has no game of 15 minutes or more (tests/fixtures/recorded-games/)');
      const { seed, record, deposit, steps } = long;
      return { seed, record, deposit, steps };
    },
  });
}

// Whether a game replays in Node, on the rules the deploy bundles, to game over exactly at its own length, on its own
// deposit (K21). A record replay refuses is no game.
function replaysToItself({ seed, record, deposit, steps }) {
  try {
    const played = replay({ seed, record });
    return played.over && played.steps === steps && record.steps === steps && played.deposit === deposit;
  } catch {
    return false;
  }
}

// The games a run signs (one game, or a list), made before its first request and each checked, so the deploy's verdict
// on a signing is never the script's own mistake: one that doesn't replay to itself stops the run before anything is
// sent.
async function gamesMade(making) {
  const games = await making;
  const astray = [games].flat().find(game => !replaysToItself(game));
  if (astray) throw new Error(`stopped before sending anything: a game made in Node (seed ${astray.seed}) doesn't replay to its own deposit and length`);
  return games;
}

const minutesOf = game => Math.round((game.steps / STEPS_A_MINUTE) * 100) / 100;

// ---- sessions (DDD-R1, DDD-R2) ----

const askSession = (run, seed, options) => run.client.post(sessionsAt(run.target), { seed }, options);

// The session a 200 carries, with the table's rows and listedAt, for the seed that was sent; null for any other answer.
function sessionFor(answer, seed) {
  const listed = answer.status === 200 && Array.isArray(answer.body?.scores) && Number.isFinite(answer.body.listedAt);
  const session = listed ? answer.body.session : null;
  return session?.seed === seed && Number.isSafeInteger(session.issuedAt) && typeof session.token === 'string' ? session : null;
}

// A session sealed with the repository's public test secret, as a root seals one: with the 32 bytes readSessionSecret
// decodes, as the Netlify entry reads SCORES_SESSION_SECRET (the base64 text itself would seal another token, which
// even a deploy whose secret is the public value refuses). A deploy that signs with it has the public value.
const PUBLIC_SIGNER = createSessionSigner(readSessionSecret(TEST_SECRET));
const publicSession = (seed, issuedAt) => ({ seed, issuedAt, token: PUBLIC_SIGNER.sign(seed, issuedAt) });
// A game's row id, its game id: the seed's SHA-256, whatever the secret (DDD-R4).
const gameIdOf = seed => PUBLIC_SIGNER.gameId(seed);

// The session phase of a signing step: one session request every 13 s from `from`, the i-th for the i-th seed.
// -> [{ answer, session }], session null when none came back for its seed.
async function sessionPhase(run, from, seeds) {
  const asked = [];
  for (const [i, seed] of seeds.entries()) {
    await until(run, from + i * PACE_MS);
    const answer = await askSession(run, seed);
    asked.push({ answer, session: sessionFor(answer, seed) });
  }
  return asked;
}

const freshSeeds = count => Array.from({ length: count }, freshSeed);

// The pair phase: one pair every 13 s from `from`, the i-th signing then a cache-missing GET. A pair is timed by its two
// exchanges, so a wait for the limit is never counted. K10: every pair answered 200, and the p95 under `p95UnderMs`
// (1000 ms; D21's 1,250 ms from slice 02, whose signings carry records).
async function pairPhase(run, from, signings, p95UnderMs = P95_UNDER_MS) {
  const pairs = [];
  for (const [i, signing] of signings.entries()) {
    await until(run, from + i * PACE_MS);
    const post = await run.client.post(scoresAt(run.target), signing);
    const get = await run.client.get(scoresAt(run.target, missQuery()));
    pairs.push({ ms: post.ms + get.ms, post, get });
  }
  const p95Ms = p95Of(pairs.map(pair => pair.ms));
  const answered = pairs.every(pair => pair.post.status === 200 && pair.get.status === 200);
  return {
    passed: answered && p95Ms < p95UnderMs, p95Ms, pairMs: pairs.map(pair => pair.ms),
    statuses: pairs.map(pair => [pair.post.status, pair.get.status]), ids: pairs.map(pair => pair.post.body?.id ?? null),
    firstPostHeaders: pairs[0].post.headers,
  };
}

// ---- the leaderboard's steps ----

// 1 (S1): the deploy's first request. 200 with an empty table: the function loaded with its rules and opened an empty
// deploy store (and the guard's rule 3). Its time is the cold-start sample, kept out of the p95s.
async function firstRequest(run) {
  const answer = await run.client.get(scoresAt(run.target));
  const outcome = passOrFail(answer.status === 200 && isEmptyList(answer.body));
  return { step: '1', kpi: 'K10 K12', outcome, status: answer.status, coldStartMs: answer.ms, headers: answer.headers };
}

// 2 (burst run, over-limit): 20 simultaneous POSTs with distinct scores, the leaderboard's signatures unless `signings`
// says otherwise. All 200, each with its own id, and each one in the true top 10 finds its id in its answer. Only a 429
// is inconclusive (the rule wasn't removed: fix the throwaway branch and rerun on a fresh throwaway preview); any other
// non-200 fails K11 for good.
const isRateLimited = statuses => statuses.includes(429);

async function burstOfSignings(run, signings = Array.from({ length: BURST_SIZE }, (_, i) => signature(i))) {
  const answers = await Promise.all(signings.map(signing => run.client.post(scoresAt(run.target), signing, OVER_LIMIT)));
  const statuses = answers.map(answer => answer.status);
  const rows = signings.map(({ initials, score }, i) => ({ initials, score, id: answers[i].body?.id }));
  const expected = [...rows].sort((a, b) => b.score - a.score).slice(0, TABLE_SIZE);
  const ownIds = new Set(rows.map(row => row.id)).size === rows.length && rows.every(row => typeof row.id === 'string');
  const findsOwn = expected.every(row => rowsOf(answers[rows.indexOf(row)].body).some(shown => shown.id === row.id));
  const outcome = statuses.some(status => status !== 200 && status !== 429) ? 'fail'
    : isRateLimited(statuses) ? 'inconclusive' : passOrFail(ownIds && findsOwn);
  const lastListedAt = Math.max(...answers.map(answer => answer.body?.listedAt ?? 0));
  return { step: '2', kpi: 'K11', overLimit: true, outcome, statuses, expected, lastListedAt };
}

// 3 (burst run), 61 s after step 2: a cache miss shows exactly the burst's top 10, listed after the burst.
async function burstTable(run, burst) {
  if (!burst.statuses.every(status => status === 200)) return { step: '3', kpi: 'K11', outcome: 'skipped', reason: 'step 2 was not answered 200 throughout' };
  const answer = await run.client.get(scoresAt(run.target, missQuery()));
  const shown = rowsOf(answer.body).map(({ initials, score, id }) => ({ initials, score, id }));
  const pass = answer.status === 200 && isDeepStrictEqual(shown, burst.expected) && answer.body.listedAt > burst.lastListedAt;
  return { step: '3', kpi: 'K11', outcome: passOrFail(pass), status: answer.status, shown, listedAt: answer.body?.listedAt ?? null };
}

// 4: initials on the word filter answer 400 initials-not-allowed, which only the bundled high-scores.js can give.
async function wordFilter(run) {
  const answer = await run.client.post(scoresAt(run.target), { initials: BLOCKED, score: SCORE_STEP });
  const outcome = passOrFail(answer.status === 400 && answer.body?.error === 'initials-not-allowed');
  return { step: '4', kpi: 'K12', outcome, status: answer.status, headers: answer.headers };
}

// 5: within 15 s, two plain GETs and a ?x= one share one cache object (hits, with the 1st one's listedAt); ?table= misses
// it, with a newer listedAt. A missing Cache-Status fails the step rather than passing it vacuously.
async function sharedCache(run) {
  const started = run.clock.now();
  const urls = [scoresAt(run.target), scoresAt(run.target), scoresAt(run.target, `?x=${randomUUID()}`), scoresAt(run.target, missQuery())];
  const answers = [];
  for (const url of urls) answers.push(await run.client.get(url));
  const withinMs = run.clock.now() - started;
  const [first, second, other, miss] = answers;
  const cacheStatus = answers.map(answer => answer.headers['cache-status'] ?? null);
  const shared = [second, other].every(answer => isHit(answer.headers['cache-status']) && answer.body?.listedAt === first.body?.listedAt);
  const missed = !isHit(miss.headers['cache-status']) && miss.body?.listedAt > first.body?.listedAt;
  const pass = answers.every(answer => answer.status === 200) && shared && missed;
  const outcome = !cacheStatus.every(Boolean) ? 'fail' : withinMs > CACHE_TTL_MS ? 'inconclusive' : passOrFail(pass);
  const listedAt = answers.map(answer => answer.body?.listedAt ?? null);
  return { step: '5', kpi: 'K14', outcome, withinMs, statuses: answers.map(answer => answer.status), cacheStatus, listedAt };
}

// 6: 30 pairs, one every 13 s: a POST, then a cache-missing GET. K10: the p95 (the 29th of 30) under 1000 ms.
async function signingPairs(run) {
  const { passed, ...pairs } = await pairPhase(run, run.clock.now(), Array.from({ length: PAIRS }, (_, i) => signature(i)));
  return { step: '6', kpi: 'K10', outcome: passOrFail(passed), ...pairs };
}

// 7 (with --production): the production table holds none of the ids signed on the preview. A 404 means production has
// no function yet: skipped, and the first request's empty table plus the preview's log line are the evidence.
async function productionUntouched(run, ids) {
  if (!run.production) return { step: '7', kpi: 'K12', outcome: 'skipped', reason: 'no --production' };
  const answer = await run.client.get(scoresAt(run.production));
  if (answer.status === 404) return { step: '7', kpi: 'K12', outcome: 'skipped', status: 404, reason: 'production has no function yet' };
  const ours = new Set(ids.filter(Boolean));
  const leaked = rowsOf(answer.body).map(row => row.id).filter(id => ours.has(id));
  return { step: '7', kpi: 'K12', outcome: passOrFail(answer.status === 200 && leaked.length === 0), status: answer.status, leaked };
}

// An over-limit run: `count` requests at `perSecond`, sent on schedule without waiting for the answers. Cache-missing
// GETs unless `request(i)` sends something else.
async function flood(run, { perSecond, count, request = () => run.client.get(scoresAt(run.target, missQuery()), OVER_LIMIT) }) {
  const start = run.clock.now();
  const inFlight = [];
  for (let i = 0; i < count; i++) {
    await until(run, start + (i * 1000) / perSecond);
    inFlight.push(request(i));
  }
  const answers = await Promise.all(inFlight);
  const first = answers[0].sentAt;
  const first429 = answers.find(answer => answer.status === 429);
  return {
    answers,
    achievedPerSecond: Math.round(((count - 1) / ((answers.at(-1).sentAt - first) / 1000)) * 100) / 100,
    first429AfterMs: first429 ? first429.sentAt - first : null,
    accepted: answers.filter(answer => answer.status === 200).length,
  };
}

// The most 200s sent within any 60 s window that lies wholly inside the run.
function mostAcceptedInAFullWindow(answers) {
  const last = answers.at(-1).sentAt;
  const starts = answers.map(answer => answer.sentAt).filter(start => start + WINDOW_MS <= last);
  const acceptedFrom = start => answers.filter(answer => answer.status === 200 && answer.sentAt >= start && answer.sentAt < start + WINDOW_MS).length;
  return Math.max(0, ...starts.map(acceptedFrom));
}

const isWithin = (afterMs, limitMs) => afterMs !== null && afterMs <= limitMs;

// 8a (over-limit): 2 a second for 125 s. Pass: a 429 within 16 s of the first request, and at most 30 accepted in each
// full 60 s window (the limit plus the documented 10 s lag at this rate). Above 20 in a window isn't a fail: it asks for
// the abuse table's recompute before the merge.
async function steadyFlood(run) {
  const { achievedPerSecond, first429AfterMs, answers } = await flood(run, { perSecond: 2, count: 250 });
  const mostAccepted = mostAcceptedInAFullWindow(answers);
  const outcome = achievedPerSecond < 2 ? 'inconclusive' : passOrFail(isWithin(first429AfterMs, 16_000) && mostAccepted <= 30);
  return { step: '8a', kpi: 'K14', overLimit: true, outcome, achievedPerSecond, first429AfterMs, mostAcceptedInAWindow: mostAccepted, recompute: mostAccepted > 20 };
}

// 8b (over-limit): 20 a second for 60 s, then 61 s later one GET. Pass: a 429 within 11 s, and the last GET is 200. The
// accepted count is one fast IP's real per-minute cap; above 210 (10 + 10 s x 20 a second) it asks for the abuse table's
// recompute.
async function fastFlood(run) {
  const { achievedPerSecond, first429AfterMs, accepted } = await flood(run, { perSecond: 20, count: 1200 });
  await coolDown(run);
  const after = await run.client.get(scoresAt(run.target, missQuery()));
  const outcome = achievedPerSecond < 20 ? 'inconclusive' : passOrFail(isWithin(first429AfterMs, 11_000) && after.status === 200);
  return { step: '8b', kpi: 'K14', overLimit: true, outcome, achievedPerSecond, first429AfterMs, accepted, afterStatus: after.status, recompute: accepted > 210 };
}

// 9 (over-limit): 25 plain GETs, one a second: whether cache hits count toward the limit is recorded, either way. Pass
// needs positive evidence: the plain GET 61 s later is 200 with a Cache-Status (a cached 429 would answer 429 there). A
// 429 whose Cache-Status shows a hit fails.
async function cachedFlood(run) {
  const { answers } = await flood(run, { perSecond: 1, count: 25, request: () => run.client.get(scoresAt(run.target), OVER_LIMIT) });
  await coolDown(run);
  const after = await run.client.get(scoresAt(run.target));
  const cached429 = answers.some(answer => answer.status === 429 && isHit(answer.headers['cache-status']));
  const pass = !cached429 && after.status === 200 && Boolean(after.headers['cache-status']);
  return {
    step: '9', kpi: 'K14', overLimit: true, outcome: passOrFail(pass), cacheHitsCountTowardTheLimit: answers.some(answer => answer.status === 429),
    afterStatus: after.status, afterCacheStatus: after.headers['cache-status'] ?? null,
  };
}

// 10 (with --permalink), read only: a 200 means every deploy's permalink keeps a callable copy of the function, so add it
// to the kill switch's list of live hostnames.
async function permalinkCopy(run) {
  if (!run.permalink) return { step: '10', outcome: 'skipped', reason: 'no --permalink' };
  const answer = await run.client.get(scoresAt(run.permalink));
  return { step: '10', outcome: 'recorded', status: answer.status, callable: answer.status === 200 };
}

// P1: one cache-missing GET (a cached one runs no function and logs nothing), with the UTC time to find its log line by.
async function productionRead(run) {
  const sentAt = isoAt(run.clock.now());
  const answer = await run.client.get(scoresAt(run.production, missQuery()));
  return {
    step: 'P1', kpi: 'K13', outcome: passOrFail(answer.status === 200 && Array.isArray(answer.body?.scores)), status: answer.status, at: sentAt,
    next: 'P2: in Netlify -> Cloud compute -> Functions -> scores, the scores.read line at that time shows'
      + ' "scope":"site","context":"production","published":true. P3: do it today.',
  };
}

// ---- slice 01's steps (DEVOPS "Preview smoke test, extended") ----

// S2: the first session request, for a fresh seed, is the secret check. 200 { session, scores, listedAt }, the session
// for the seed sent, also proves the bundle; its time is a warm K25 sample. A 500 stops the run (SECRET_MISSING).
async function firstSession(run) {
  const seed = freshSeed();
  const answer = await askSession(run, seed);
  return { step: 'S2', kpi: 'K25 K12', outcome: passOrFail(sessionFor(answer, seed) !== null), status: answer.status, ms: answer.ms, headers: answer.headers };
}

const SECRET_MISSING = 'stopped: the first session request answered 500, so this deploy has no session secret, or one that'
  + ' isn\'t 32 bytes of canonical base64 (its log says sessions.error secret-missing). Set SCORES_SESSION_SECRET for this'
  + ' deploy context and deploy again: never roll back for it (the owner guide, "The session secret")';

// S4's 10 requests, in order, and the answer each must get (K20 items 1-3).
const FORGERIES = Object.freeze({
  noSession: [400, 'session-required'],         // the RCA's curl: { initials, score }
  sessionA: [200],
  issueTimeChanged: [400, 'invalid-session'],   // session A with its issuedAt moved by 1 ms
  signed: [200],                                // the same game, with session A: a refused attempt doesn't use it up
  signedAgain: [409, 'already-signed'],
  sessionB: [200],                              // for the same seed: the same game
  signedWithB: [409, 'already-signed'],
  sessionsRead: [405],                          // GET /api/sessions, with Allow: POST
  malformedSeed: [400, 'invalid-seed'],
  publicSecret: [400, 'invalid-session'],       // sealed with TEST_SECRET: a 200 means the deploy's secret is public
});
const answersAs = (answer, [status, error]) => answer.status === status && (error === undefined || answer.body?.error === error);
const PUBLIC_SECRET_FOUND = 'the deploy signed a session sealed with the public TEST_SECRET: its secret is the public value.'
  + ' Set a value of its own for this context (the owner guide, "The session secret") and deploy again';

// S4: each answer as FORGERIES says, each no-store, and one row in all: session B's listing, after A's signings, shows
// only A's game. tableIds are the ids of the table's last listing, which S4c is checked against.
async function forgeries(run) {
  const sign = body => run.client.post(scoresAt(run.target), body);
  const game = signature(1);
  const seed = freshSeed();
  const answers = {};
  answers.noSession = await sign(signature(0));
  answers.sessionA = await askSession(run, seed);
  const sessionA = sessionFor(answers.sessionA, seed);
  answers.issueTimeChanged = await sign(run.slice.signing(game, sessionA && { ...sessionA, issuedAt: sessionA.issuedAt - 1 }));
  answers.signed = await sign(run.slice.signing(game, sessionA));
  answers.signedAgain = await sign(run.slice.signing(game, sessionA));
  answers.sessionB = await askSession(run, seed);
  answers.signedWithB = await sign(run.slice.signing(game, sessionFor(answers.sessionB, seed)));
  answers.sessionsRead = await run.client.get(sessionsAt(run.target));
  answers.malformedSeed = await run.client.post(sessionsAt(run.target), { seed: MALFORMED_SEED });
  // Dated by the deploy's own clock (session A's issuedAt), so the probe is never refused for coming from the future.
  answers.publicSecret = await sign(run.slice.signing(signature(2), publicSession(freshSeed(), sessionA?.issuedAt ?? run.clock.now())));
  const id = answers.signed.body?.id ?? null;
  const checks = {
    answered: Object.entries(FORGERIES).every(([name, expected]) => answersAs(answers[name], expected)),
    issued: sessionA !== null && sessionFor(answers.sessionB, seed) !== null,
    allowsPost: answers.sessionsRead.headers.allow === 'POST',
    noStore: Object.values(answers).every(hasNoStore),
    oneRow: id !== null && isDeepStrictEqual(idsOf(answers.sessionB.body), [id]),
  };
  const publicSecret = answers.publicSecret.status === 200;
  const lastListing = Object.values(answers).findLast(answer => Array.isArray(answer.body?.scores));
  return {
    step: 'S4', kpi: 'K20', outcome: passOrFail(Object.values(checks).every(Boolean)), publicSecret, ...(publicSecret && { reason: PUBLIC_SECRET_FOUND }),
    ...checks, answers: Object.fromEntries(Object.entries(answers).map(([name, answer]) => [name, { status: answer.status, error: answer.body?.error ?? null }])),
    id, tableIds: lastListing ? idsOf(lastListing.body) : null,
  };
}

// S4c, its own step after a 61 s wait (1 request): POST /__test/rows with a test-board cookie. The route is the local
// server's, never the function's, so a 404 or 405 passes once the next listing (S4b's session) shows no row written.
async function testRoute(run) {
  const answer = await run.client.post(at(run.target, TEST_ROWS_PATH), signature(3), { headers: { cookie: 'test-board=smoke' } });
  return { step: 'S4c', kpi: 'K20', status: answer.status };
}

const ROUTE_ABSENT = Object.freeze([404, 405]);
// The listings on either side, as ids: unknown (null) when one never came, which leaves a 404 or 405 inconclusive.
function settleTestRoute(route, idsBefore, idsAfter) {
  const known = idsBefore !== null && idsAfter !== null;
  const noRowWritten = known ? isDeepStrictEqual(idsAfter, idsBefore) : null;
  const outcome = !ROUTE_ABSENT.includes(route.status) ? 'fail' : known ? passOrFail(noRowWritten) : 'inconclusive';
  return { ...route, outcome, noRowWritten };
}

// A record that names no rules: the envelope's from slice 02, which no check reads before the session's (row 9).
const NO_RECORD = Object.freeze({});

// A session, then blocked initials signed with it: 400 initials-not-allowed. The word filter (check 8) comes before the
// token (check 9), and only the bundled high-scores.js can give it. -> { asked, session, answer, refused }
async function blockedInitials(run) {
  const seed = freshSeed();
  const asked = await askSession(run, seed);
  const session = sessionFor(asked, seed);
  const answer = await run.client.post(scoresAt(run.target), run.slice.signing({ initials: BLOCKED, score: SCORE_STEP }, session, NO_RECORD));
  return { asked, session, answer, refused: answersAs(answer, [400, 'initials-not-allowed']) };
}

// S4b: the word filter after a session. Its session's listing settles S4c.
async function wordFilterAfterASession(run) {
  const { asked, session, answer, refused } = await blockedInitials(run);
  return { step: 'S4b', kpi: 'K12', outcome: passOrFail(session !== null && refused), statuses: [asked.status, answer.status], headers: answer.headers, tableIds: session && idsOf(asked.body) };
}

// S5: the session phase, 30 fresh seeds (K25 samples on a nearly empty table), then the pair phase on the same 13 s
// pace, 30 pairs each signing its own game with its session (K10).
async function sessionsThenPairs(run) {
  const start = run.clock.now();
  const asked = await sessionPhase(run, start, freshSeeds(PAIRS));
  const signings = asked.map(({ session }, i) => run.slice.signing(signature(i), session));
  const { passed, ...pairs } = await pairPhase(run, start + PAIRS * PACE_MS, signings);
  const issued = asked.every(({ session }) => session !== null);
  const sessionMs = asked.map(({ answer }) => answer.ms);
  return { step: 'S5', kpi: 'K10 K25', outcome: passOrFail(issued && passed), ...pairs, sessionP95Ms: p95Of(sessionMs), sessionMs };
}

// S3, after S5 (which leaves about 20 keys on the table, as production has): 30 session requests, one every 13 s. K25:
// each issued, and the p95 under 1000 ms.
async function sessionsOnAFullerTable(run) {
  const asked = await sessionPhase(run, run.clock.now(), freshSeeds(PAIRS));
  const p95Ms = p95Of(asked.map(({ answer }) => answer.ms));
  const issued = asked.every(({ session }) => session !== null);
  return { step: 'S3', kpi: 'K25', outcome: passOrFail(issued && p95Ms < P95_UNDER_MS), p95Ms, sessionMs: asked.map(({ answer }) => answer.ms), statuses: asked.map(({ answer }) => answer.status) };
}

// 8c (over-limit): a session request every 4 s for 120 s, faster than any player restarts. Pass: the first 429 comes
// once the accepted count reaches the limit plus the lag (K14: about 13), and a session request 61 s later is issued.
// The most accepted in a full 60 s window is recorded: D19's exposure.
async function sessionFlood(run) {
  const { answers, first429AfterMs } = await flood(run, { perSecond: 0.25, count: 30, request: () => askSession(run, freshSeed(), OVER_LIMIT) });
  const first429 = answers.findIndex(answer => answer.status === 429);
  const acceptedBefore429 = first429 < 0 ? null : answers.slice(0, first429).filter(answer => answer.status === 200).length;
  const mostAcceptedInAWindow = mostAcceptedInAFullWindow(answers);
  await coolDown(run);
  const seed = freshSeed();
  const after = await askSession(run, seed);
  const onTime = acceptedBefore429 !== null && acceptedBefore429 >= LIMIT && acceptedBefore429 <= LIMIT_WITH_LAG;
  const outcome = passOrFail(onTime && sessionFor(after, seed) !== null);
  return { step: '8c', kpi: 'K14', overLimit: true, outcome, acceptedBefore429, first429AfterMs, mostAcceptedInAWindow, afterStatus: after.status };
}

// 8d (over-limit): session requests and cache-missing GETs alternating at 2 a second for 20 s, on the shipped config.
// Pass: at most 18 accepted in all, and a 429 on both paths: one counter for both. Otherwise DDD-R1 reopens.
async function mixedFlood(run) {
  const request = i => (i % 2 === 0 ? askSession(run, freshSeed(), OVER_LIMIT) : run.client.get(scoresAt(run.target, missQuery()), OVER_LIMIT));
  const { answers, achievedPerSecond, accepted } = await flood(run, { perSecond: 2, count: 40, request });
  const limitedOn = path => answers.some((answer, i) => i % 2 === path && answer.status === 429);
  const oneCounter = limitedOn(0) && limitedOn(1);
  const outcome = achievedPerSecond < 2 ? 'inconclusive' : passOrFail(accepted <= MIXED_ACCEPTED_AT_MOST && oneCounter);
  return { step: '8d', kpi: 'K14', overLimit: true, outcome, achievedPerSecond, accepted, sessions429: limitedOn(0), reads429: limitedOn(1), ...(!oneCounter && { next: 'a counter per path: DDD-R1 reopens' }) };
}

// ---- slice 02's steps (DEVOPS "Preview smoke test, extended"): every signing carries its game's record ----

const LONG_SIGNING_UNDER_MS = 5000;     // K22: the long game's signing, on the client
const REPLAY_HOUR_UNDER_MS = 1000;      // K22: its replayMs, scaled to 60 minutes of game time
const D21_P95_UNDER_MS = 1250;          // K10 under D21: a pair whose POST carries a 10-minute record
const REPLAY_P95_UNDER_MS = 165;        // D21: a 10-minute record's replayMs, p95
const SIGNING_CAP_BYTES = 128 * 1024;   // the signing's body cap (DDD-R3)
const OVER_NETLIFY_BYTES = 7 * 1024 * 1024;   // above the 6 MB Netlify buffers for a function
const HUMAN_CHANGES_A_SECOND = 15;      // D20: a fast human's pace of key changes
const CONTROL_LETTERS = 'ABCDEFGH';     // record.js's letters: the controls held, 0 to 7
const RACERS = 3;

const signAt = run => body => run.client.post(scoresAt(run.target), body);

// `body` with a padding field that brings its JSON to exactly `bytes` bytes (ASCII: a character is a byte).
function paddedTo(body, bytes) {
  const bare = JSON.stringify({ ...body, padding: '' }).length;
  return { ...body, padding: 'x'.repeat(bytes - bare) };
}

// The record of a game's first `steps` steps: its changes before then, recorded again by the game's own recorder.
function firstStepsOf(record, steps) {
  const { changes } = readRecord(record);
  const recorder = createRecorder();
  for (let step = 0, next = 0, held = 0; step < steps; step++) {
    if (next < changes.length && changes[next][0] === step) held = changes[next++][1];
    recorder.step(held);
  }
  return recorder.record();
}

// A 60-minute record of the worst spacing a human's pace allows (DDD-R3): 15 changes a second for an hour, as many as
// fit 36 steps apart (a two-character delta) and the rest a step apart, the last at step MAX_GAME_STEPS - 1: 54,000
// changes, 10,800 of them far apart, about 119 KB. Its inputs are junk, so its game ends within minutes, and its replay
// with it: it measures the upload and the parsing, not an hour's replay.
function worstSpacedHour() {
  const changes = HUMAN_CHANGES_A_SECOND * 60 * 60;
  const far = Math.floor((MAX_GAME_STEPS - changes) / (36 - 1));
  const delta = i => (i === 0 ? 0 : i <= far ? 36 : 1);
  const keys = Array.from({ length: changes }, (_, i) => `${delta(i).toString(36)}${CONTROL_LETTERS[i % CONTROL_LETTERS.length]}`).join('');
  return Object.freeze({ rules: RULES_VERSION, steps: MAX_GAME_STEPS, keys });
}

// S7 (K22, K21): the corpus's longest game signed with a session for its seed, 200 within 5 s on the client; then the
// 60-minute body of the worst spacing, with a session of its own, refused as replay-mismatch, its time recorded. The
// first session request is the secret check (a 500 stops the run): then nothing more is sent.
async function longGameAndHour(run, game) {
  const asked = await askSession(run, game.seed);
  if (asked.status === 500) return { step: 'S7', kpi: 'K22 K21', outcome: 'fail', sessionStatus: 500 };
  const signed = await signAt(run)(run.slice.signing(claimOf(game, 0), sessionFor(asked, game.seed), game.record));
  const hourSeed = freshSeed();
  const hourSession = sessionFor(await askSession(run, hourSeed), hourSeed);
  const hourBody = run.slice.signing(signature(1), hourSession, worstSpacedHour());
  const hour = await signAt(run)(hourBody);
  const inTime = signed.status === 200 && typeof signed.body?.id === 'string' && signed.ms < LONG_SIGNING_UNDER_MS;
  const replayMsUnder = Math.floor((REPLAY_HOUR_UNDER_MS * game.steps) / MAX_GAME_STEPS);
  return {
    step: 'S7', kpi: 'K22 K21', outcome: passOrFail(inTime && hourSession !== null && answersAs(hour, [400, 'replay-mismatch'])),
    sessionStatus: asked.status, status: signed.status, ms: signed.ms, id: signed.body?.id ?? null, steps: game.steps, minutes: minutesOf(game),
    hour: { bytes: JSON.stringify(hourBody).length, status: hour.status, error: hour.body?.error ?? null, ms: hour.ms },
    next: `its scores.signed line's replayMs must be under ${replayMsUnder} (1 s for 60 minutes, scaled to its ${game.steps} steps)`,
  };
}

// S8 (K10 under D21, K21): the session phase for the 30 bot games' seeds, then the pair phase, each POST signing its
// game with its session and its record. Pass: every session issued, every pair 200, the p95 under 1,250 ms.
async function tenMinuteGames(run, games) {
  const start = run.clock.now();
  const asked = await sessionPhase(run, start, games.map(game => game.seed));
  const signings = games.map((game, i) => run.slice.signing(claimOf(game, i), asked[i].session, game.record));
  const { passed, ...pairs } = await pairPhase(run, start + games.length * PACE_MS, signings, D21_P95_UNDER_MS);
  const issued = asked.every(({ session }) => session !== null);
  return {
    step: 'S8', kpi: 'K10 K21', outcome: passOrFail(issued && passed), ...pairs, minutes: games.map(minutesOf),
    next: `netlify logs --function scores --json: the ${games.length} scores.signed lines' replayMs, p95 under ${REPLAY_P95_UNDER_MS} ms (D21)`,
  };
}

// S9's 7 signings, in order, all with one session for the game's seed (a refused attempt doesn't use it up), and the
// answer each must get (K20 items 5-8, 10 and 11). shape(claim, record) puts them in the slice's signing, with that
// session.
const REFUSED = Object.freeze({
  claimNotReplayed: [[400, 'replay-mismatch'], (game, shape) => shape(claimOf(game, 0, game.deposit + SCORE_STEP), game.record)],
  stopsBeforeGameOver: [[400, 'replay-mismatch'], (game, shape) => shape(claimOf(game, 0), firstStepsOf(game.record, game.steps - 1))],
  runsPastGameOver: [[400, 'replay-mismatch'], (game, shape) => shape(claimOf(game, 0), { ...game.record, steps: game.steps + 1 })],
  malformedRecord: [[400, 'invalid-record'], (game, shape) => shape(claimOf(game, 0), { ...game.record, keys: `${game.record.keys}0` })],
  overAnHour: [[400, 'game-too-long'], (game, shape) => shape(claimOf(game, 0), { ...game.record, steps: MAX_GAME_STEPS + 1 })],
  overTheCap: [[413, 'payload-too-large'], (game, shape) => paddedTo(shape(claimOf(game, 0), game.record), SIGNING_CAP_BYTES + 1)],
  overTheCeiling: [[400, 'implausible-score'], (game, shape) => shape(claimOf(game, 0, MAX_PLAUSIBLE_SCORE + SCORE_STEP), game.record)],
});

// S9 (K20, K12): one session, then the 7 refused signings with it. Nothing kept is settled by the next listing (S9b's
// session): tableIds are the ids its own session's listing showed.
async function refusedSignings(run, game) {
  const asked = await askSession(run, game.seed);
  const session = sessionFor(asked, game.seed);
  const shape = (claim, record) => run.slice.signing(claim, session, record);
  const answers = {};
  for (const [name, [, forge]] of Object.entries(REFUSED)) answers[name] = await signAt(run)(forge(game, shape));
  const answered = Object.entries(REFUSED).every(([name, [expected]]) => answersAs(answers[name], expected));
  return {
    step: 'S9', kpi: 'K20 K12', outcome: passOrFail(session !== null && answered),
    answers: Object.fromEntries(Object.entries(answers).map(([name, answer]) => [name, { status: answer.status, error: answer.body?.error ?? null }])),
    tableIds: session && idsOf(asked.body),
  };
}

// The listings on either side of S9, as ids: unchanged, or S9 kept something; unknown (null) when one never came,
// which leaves a pass inconclusive.
function settleNothingKept(refused, idsAfter) {
  const nothingKept = refused.tableIds !== null && idsAfter !== null ? isDeepStrictEqual(idsAfter, refused.tableIds) : null;
  const outcome = refused.outcome === 'fail' || nothingKept === false ? 'fail' : nothingKept === null ? 'inconclusive' : 'pass';
  return { ...refused, outcome, nothingKept };
}

// S9b (K12), after a 61 s wait: S4b again (the bundle with the rules), then a session sealed with the public test secret,
// sent with a record {}: invalid-session. An invalid-record means check 9 passed, so the deploy's secret is the public
// value, which fails the run. Dated by the deploy's own clock (S4b's session), so the probe never comes from the future.
async function bundleAndPublicSecret(run) {
  const { asked, session, answer, refused } = await blockedInitials(run);
  const sealed = publicSession(freshSeed(), session?.issuedAt ?? run.clock.now());
  const probe = await signAt(run)(run.slice.signing(signature(2), sealed, NO_RECORD));
  const publicSecret = probe.body?.error === 'invalid-record';
  return {
    step: 'S9b', kpi: 'K12', outcome: passOrFail(session !== null && refused && answersAs(probe, [400, 'invalid-session'])),
    publicSecret, ...(publicSecret && { reason: PUBLIC_SECRET_FOUND }), statuses: [asked.status, answer.status, probe.status],
    probe: { status: probe.status, error: probe.body?.error ?? null }, tableIds: session && idsOf(asked.body),
  };
}

// S9c (K20 item 10), its own step after a 61 s wait: a 7 MB body, which Netlify refuses before the function runs. Its
// status is recorded, with the time to look for no line of ours by.
async function overNetlifysLimit(run) {
  const at = isoAt(run.clock.now());
  const answer = await signAt(run)(paddedTo(signature(3), OVER_NETLIFY_BYTES));
  return {
    step: 'S9c', kpi: 'K20', outcome: 'recorded', status: answer.status, bytes: OVER_NETLIFY_BYTES, at,
    next: 'the function\'s log has no scores line at that time: the platform refused the body before the function ran',
  };
}

// S10.2 (burst run, over-limit): a session for each of 20 scripted games with distinct deposits, all at once, then the
// 20 signings at once (step 2's rule). A 429 is inconclusive, as in step 2.
async function sessionsThenBurst(run, games) {
  const asked = await Promise.all(games.map(game => askSession(run, game.seed, OVER_LIMIT)));
  const sessions = asked.map((answer, i) => sessionFor(answer, games[i].seed));
  const burst = await burstOfSignings(run, games.map((game, i) => run.slice.signing(claimOf(game, i), sessions[i], game.record)));
  const sessionStatuses = asked.map(answer => answer.status);
  const outcome = isRateLimited(sessionStatuses) ? 'inconclusive' : sessions.includes(null) ? 'fail' : burst.outcome;
  return { ...burst, kpi: 'K11', outcome, sessionStatuses };
}

// S10.4 (burst run, over-limit): 3 sessions for one game, then its 3 signings at once. Pass: at most one 200, the others
// 409 (or 503, a key written at the same moment). A 429 is inconclusive.
async function raceForOneGame(run, game) {
  const asked = await Promise.all(Array.from({ length: RACERS }, () => askSession(run, game.seed, OVER_LIMIT)));
  const sessions = asked.map(answer => sessionFor(answer, game.seed));
  const answers = await Promise.all(sessions.map((session, i) => run.client.post(scoresAt(run.target), run.slice.signing(claimOf(game, i), session, game.record), OVER_LIMIT)));
  const statuses = answers.map(answer => answer.status);
  const sessionStatuses = asked.map(answer => answer.status);
  const oneAtMost = statuses.filter(status => status === 200).length <= 1 && statuses.every(status => [200, 409, 503].includes(status));
  const outcome = isRateLimited([...sessionStatuses, ...statuses]) ? 'inconclusive' : passOrFail(!sessions.includes(null) && oneAtMost);
  return { step: 'S10.4', kpi: 'K20', overLimit: true, outcome, sessionStatuses, statuses, gameId: gameIdOf(game.seed) };
}

// S10.5, 61 s after the race: a cache miss shows at most one row for its game.
async function racedTable(run, race) {
  const answer = await run.client.get(scoresAt(run.target, missQuery()));
  const rows = rowsOf(answer.body).filter(row => row.id === race.gameId).length;
  return { step: 'S10.5', kpi: 'K20', outcome: passOrFail(answer.status === 200 && rows <= 1), status: answer.status, rowsOfTheGame: rows };
}

// ---- the runs ----

// The leaderboard's preview run, steps 1 and 4-10, for a deploy from before rightmove-invaders-replay-verified-scores.
async function leaderboardPreview(run, record) {
  record(await timed(run, firstRequest));
  record(await timed(run, wordFilter));
  record(await timed(run, sharedCache));
  await coolDown(run);
  const pairs = await timed(run, signingPairs);
  record(pairs);
  record(await timed(run, signed => productionUntouched(signed, pairs.ids)));
  for (const floodStep of [steadyFlood, fastFlood, cachedFlood]) {
    await coolDown(run);
    record(await timed(run, floodStep));
  }
  record(await timed(run, permalinkCopy));
}

// Slice 01's preview run, its gate: K25 (S2, S3, S5), K10 (S5), K14 (S6), K12 (S1, S2, S4b, S6b), K20 items 1-3 (S4) and
// the test route (S4c).
async function slice01Preview(run, record) {
  record(await timed(run, firstRequest, 'S1'));
  const secretCheck = await timed(run, firstSession);
  record(secretCheck);
  if (secretCheck.status === 500) throw new Error(SECRET_MISSING);
  const forged = await timed(run, forgeries);
  record(forged);
  await coolDown(run);
  const route = await timed(run, testRoute);
  const filtered = await timed(run, wordFilterAfterASession);
  record(settleTestRoute(route, forged.tableIds, filtered.tableIds));
  record(filtered);
  const signed = await timed(run, sessionsThenPairs);
  record(signed);
  record(await timed(run, sessionsOnAFullerTable));
  record(await timed(run, sharedCache, 'S6.5'));
  for (const [floodStep, step] of [[steadyFlood, 'S6.8a'], [fastFlood, 'S6.8b'], [sessionFlood, 'S6.8c'], [mixedFlood, 'S6.8d'], [cachedFlood, 'S6.9']]) {
    await coolDown(run);
    record(await timed(run, floodStep, step));
  }
  record(await timed(run, read => productionUntouched(read, [forged.id, ...signed.ids]), 'S6b.7'));
  record(await timed(run, permalinkCopy, 'S6b.10'));
}

// Slice 02's preview run, its gate: K22 (S7); K10 under D21 (S8); K20 items 5-8, 10 and 11 (S9, S9c); K12 (S9, S9b);
// K21 (S7, S8). Its games are made first, and S1 is the write guard's opening GET.
async function slice02Preview(run, record) {
  const long = await gamesMade(run.games.longest());
  const bots = await gamesMade(run.games.tenMinute(PAIRS));
  const [refusable] = await gamesMade(run.games.scripted(1));
  record(await timed(run, firstRequest, 'S1'));
  const signedLong = await timed(run, signing => longGameAndHour(signing, long));
  record(signedLong);
  if (signedLong.sessionStatus === 500) throw new Error(SECRET_MISSING);
  record(await timed(run, signing => tenMinuteGames(signing, bots)));
  const refused = await timed(run, signing => refusedSignings(signing, refusable));
  await coolDown(run);
  const bundle = await timed(run, bundleAndPublicSecret);
  record(settleNothingKept(refused, bundle.tableIds));
  record(bundle);
  await coolDown(run);
  record(await timed(run, overNetlifysLimit));
}

// The leaderboard's burst run, steps 1-3 (K11).
async function leaderboardBurst(run, record) {
  record(await timed(run, firstRequest));
  const burst = await timed(run, burstOfSignings);
  record(burst);
  await coolDown(run);
  record(await timed(run, read => burstTable(read, burst)));
}

// Slice 02's burst run, S10 (K11, K20 item 3): its 21 scripted games made first, then each over-limit step between 61 s
// waits: the burst of 20 and its table, then the race for the 21st game and its table.
async function slice02Burst(run, record) {
  const games = await gamesMade(run.games.scripted(BURST_SIZE + 1));
  record(await timed(run, firstRequest, 'S10.1'));
  await coolDown(run);
  const burst = await timed(run, signing => sessionsThenBurst(signing, games.slice(0, BURST_SIZE)), 'S10.2');
  record(burst);
  await coolDown(run);
  record(await timed(run, read => burstTable(read, burst), 'S10.3'));
  await coolDown(run);
  const race = await timed(run, signing => raceForOneGame(signing, games[BURST_SIZE]));
  record(race);
  await coolDown(run);
  record(await timed(run, read => racedTable(read, race)));
}

// How each run signs and what its preview and burst runs check: the leaderboard's, before this feature, and each
// slice's (--slice). signing(body, session, record) puts a signing in the slice's shape. 03-04 adds slice 03 (S11-S13).
const LEADERBOARD = Object.freeze({ sessions: false, signing: body => body, preview: leaderboardPreview, burst: leaderboardBurst });
const SLICES = Object.freeze({
  '01': Object.freeze({ sessions: true, signing: (body, session) => ({ ...body, session }), preview: slice01Preview, burst: null }),
  '02': Object.freeze({ sessions: true, signing: (body, session, record) => ({ ...body, session, record }), preview: slice02Preview, burst: slice02Burst }),
});

// U2's signing, as the permalink's code takes it: from slice 01 on, through a session from that same permalink, for a
// scripted game made in Node, whose record a slice-02 signing carries.
async function signOnce(run) {
  if (!run.slice.sessions) return run.client.post(scoresAt(run.target), signature(0));
  const [game] = await gamesMade(run.games.scripted(1));
  const session = sessionFor(await askSession(run, game.seed), game.seed);
  return run.client.post(scoresAt(run.target), run.slice.signing(claimOf(game, 0), session, game.record));
}

// Rule 2's published deploy ID, never from a flag: Netlify's API with the owner's token, or the owner typing it back.
// { token, siteId, fetch (the network port) } -> the published deploy's ID, or null, which refuses: a failed answer, a
// site with no published deploy, or an id that isn't a string of the deploy-ID shape.
export async function publishedIdFromApi({ token, siteId, fetch = globalThis.fetch }) {
  try {
    const headers = { authorization: `Bearer ${token}` };
    const response = await fetch(`${NETLIFY_SITES_API}${encodeURIComponent(siteId)}`, { headers, redirect: 'manual' });
    if (!response.ok) return null;
    const id = PUBLISHED_DEPLOY_ID_FIELD.reduce((value, key) => value?.[key], await response.json());
    return isDeployId(id) ? id : null;
  } catch {
    return null;
  }
}

// Input that ends without an answer is no answer, and refuses.
async function publishedIdFromOwner(permalink) {
  const targetId = new URL(permalink).hostname.split('--')[0];
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  const question = `The target permalink is deploy ${targetId}.\nType the published deploy's ID, from Netlify -> Deploys: `;
  try {
    const answer = await Promise.race([prompt.question(question).catch(() => null), once(prompt, 'close').then(() => null)]);
    return answer?.trim() ?? null;
  } finally {
    prompt.close();
  }
}

// -> { publishedId, from: 'api' | 'owner' }: the API with a token and a site ID, the owner otherwise.
async function publishedIdFor({ token, siteId }, permalink, fetch) {
  if (token && siteId) return { publishedId: await publishedIdFromApi({ token, siteId, fetch }), from: 'api' };
  return { publishedId: await publishedIdFromOwner(permalink), from: 'owner' };
}

// { client, clock, progress, games, slice, target URL, production, permalink }, with the guard's host rules checked
// before anything is sent.
function startRun(options, ports, target, unpublished = null) {
  refuseUnless(decidePost({ site: options.site, url: target, unpublished }), target, Refusal.NO_EMPTY_FIRST_GET);
  const client = createSmokeClient({ site: options.site, unpublished, fetch: ports.fetch, clock: ports.clock });
  const { clock, progress, games } = ports;
  return { client, clock, progress, games, slice: options.slice, target, production: options.production, permalink: options.permalink };
}

const RUNS = Object.freeze({
  async preview(options, ports, record) {
    const run = startRun(options, ports, options.preview);
    await run.slice.preview(run, record);
  },

  async burst(options, ports, record) {
    const run = startRun(options, ports, options.burst);
    await run.slice.burst(run, record);
  },

  async production(options, ports, record) {
    const client = createSmokeClient({ site: options.site, fetch: ports.fetch, clock: ports.clock });
    record(await timed({ client, clock: ports.clock, production: options.production }, productionRead));
  },

  // U1: the guard first, then an opening GET that finds an empty table. U2: one valid signing, 200 with an id; its log
  // line shows "scope":"deploy","context":"production","published":false. U3: a production GET without that id.
  async unpublished(options, ports, record) {
    const target = options.unpublished;
    const unknown = decidePost({ site: options.site, url: target, unpublished: { publishedId: null } });
    refuseUnless(unknown, target, Refusal.PUBLISHED_UNKNOWN, Refusal.NO_EMPTY_FIRST_GET);
    const { publishedId, from } = await publishedIdFor(options, target, ports.fetch);
    const run = startRun(options, ports, target, { publishedId });
    const opening = await run.client.get(scoresAt(target));
    const empty = opening.status === 200 && isEmptyList(opening.body);
    record({ step: 'U1', kpi: 'K13', outcome: passOrFail(empty), publishedIdFrom: from, status: opening.status });
    const signed = await signOnce(run);
    const id = signed.body?.id ?? null;
    const next = 'its scores.signed line shows "scope":"deploy","context":"production","published":false';
    record({ step: 'U2', kpi: 'K13', outcome: passOrFail(signed.status === 200 && typeof id === 'string'), status: signed.status, id, next });
    const production = await run.client.get(scoresAt(run.production, missQuery()));
    const untouched = production.status === 200 && !rowsOf(production.body).some(row => row.id === id);
    record({ step: 'U3', kpi: 'K13', outcome: passOrFail(untouched), status: production.status });
  },
});

// ---- the command line ----

const USAGE = 'node scripts/smoke-leaderboard.mjs --site <name> --preview <URL> [--slice 01|02] [--production <URL>] [--permalink <URL>]'
  + ' | --site <name> --burst <URL> [--slice 02] | --production <URL>'
  + ' | --site <name> --unpublished <permalink> --production <URL> [--slice 01|02] [--site-id <ID>] (with NETLIFY_AUTH_TOKEN for the API)';
const OPTIONS = Object.freeze(Object.fromEntries(['site', 'preview', 'production', 'permalink', 'burst', 'unpublished', 'site-id', 'slice']
  .map(name => [name, { type: 'string' }])));

function modeOf(values) {
  const modes = ['preview', 'burst', 'unpublished'].filter(mode => values[mode] !== undefined);
  if (modes.length > 1 || (modes[0] === 'unpublished' && !values.production)) return undefined;
  return modes[0] ?? (values.production ? 'production' : undefined);
}

// No --slice: the leaderboard's run. A slice the script doesn't know, or a burst run the slice has none of, is malformed.
const sliceOf = name => (name === undefined ? LEADERBOARD : Object.hasOwn(SLICES, name) ? SLICES[name] : undefined);

// Strict: an unknown flag (a typed published deploy ID, say) is a malformed command.
function optionsFrom(args, env) {
  const { values } = parseArgs({ args, options: OPTIONS });
  const mode = modeOf(values);
  const slice = sliceOf(values.slice);
  if (!mode || !slice || (mode === 'burst' && !slice.burst)) throw new Error(`usage: ${USAGE}`);
  return { ...values, mode, slice, sliceName: values.slice ?? null, siteId: values['site-id'], token: env.NETLIFY_AUTH_TOKEN };
}

const failedOrInconclusive = steps => steps.some(step => step.outcome === 'fail' || step.outcome === 'inconclusive');
const exitCodeOf = ({ refusal, error, steps }) => (refusal ? 2 : (error || failedOrInconclusive(steps)) ? 1 : 0);

// The run's entry point: the command line's arguments, and its ports (the network, the clock, the environment, where
// progress goes, and the games it signs, made in Node) -> the summary, its exitCode included. Nothing is sent for a
// malformed command, a refused target, or a game that doesn't replay to itself.
export async function runSmoke(args, { fetch = globalThis.fetch, clock = SYSTEM_CLOCK, env = {}, progress = toStderr, games = createNodeGames() } = {}) {
  const summary = { mode: null, slice: null, site: null, startedAt: isoAt(clock.now()), steps: [] };
  try {
    const options = optionsFrom(args, env);
    Object.assign(summary, { mode: options.mode, slice: options.sliceName, site: options.site ?? null });
    await RUNS[options.mode](options, { fetch, clock, progress, games }, step => { summary.steps.push(step); progress(`step ${step.step}: ${step.outcome}`); });
  } catch (error) {
    if (error instanceof GuardRefusal) summary.refusal = { reason: error.reason, host: error.host };
    else summary.error = error.message;
  }
  summary.finishedAt = isoAt(clock.now());
  summary.exitCode = exitCodeOf(summary);
  return summary;
}

async function main() {
  const summary = await runSmoke(process.argv.slice(2), { env: process.env });
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
