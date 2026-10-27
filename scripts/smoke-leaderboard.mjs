// Preview smoke test of the high-score table on Netlify: the DEVOPS spec "Preview smoke test" in
// docs/feature/rightmove-invaders-leaderboard/feature-delta.md (K10-K14), and with --slice its extension for that slice of
// rightmove-invaders-replay-verified-scores (its feature-delta.md, DEVOPS "Preview smoke test, extended", Slice gates),
// step for step. Node 22 fetch, no dependencies; the valid and blocked initials come from the rules the function bundles
// (src/game/high-scores.js), and the public test secret's probe is sealed as a root seals a session
// (netlify/scores/sessions.mjs, tests/common/session-secret.js).
//
//   --site <name> --preview <URL> [--slice 01] [--production <URL>] [--permalink <URL>]    preview run: the leaderboard's
//       steps 1 and 4-10 (K10, K12, K14); with --slice, that slice's gate steps, signing in its shape (01: S1, S2, S4, S4c,
//       S4b, S5, S3, S6 and S6b)
//   --site <name> --burst <URL>        burst run, steps 1-3 (K11), on a throwaway preview whose only change removes rateLimit
//   --production <URL>                 production mode, P1 (K13): one GET, never a POST
//   --site <name> --unpublished <permalink> --production <URL> [--slice 01] [--site-id <ID>]    unpublished check, U1-U3
//       (K13), U2 signing as the permalink's code does (with --slice 01, through a session from that permalink): the
//       published deploy's ID comes from Netlify's API with NETLIFY_AUTH_TOKEN and --site-id, or the owner types it back
//
// It prints one JSON summary on stdout (progress goes to stderr) and exits 0 when every hard check passed; 1 when one
// failed or was inconclusive (an inconclusive step is never a pass), the run was stopped, or the command was malformed;
// 2 when the write guard refused, and nothing was written. One limiter holds every request to at most 10 per 60 s per
// host, counted across steps; only the over-limit steps (2, 8a, 8b, 8c, 8d and 9) bypass it, each with a 61 s wait before
// and after.
// It needs a pushed deploy, so it runs only with the owner's OK to push (DEVOPS pre-requisite 9). The token stays in the
// owner's shell: it goes to api.netlify.com only, and is never printed or written.
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createInterface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { ALPHABET, BLOCKED_INITIALS, SCORE_STEP, TABLE_SIZE, isAllowedInitials } from '../src/game/high-scores.js';
import { createSessionSigner, readSessionSecret } from '../netlify/scores/sessions.mjs';
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
const signature = i => ({ initials: SIGNERS[i % SIGNERS.length], score: (i + 1) * SCORE_STEP });
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

// The session phase of a signing step: one session request every 13 s from `from`, each for a fresh seed.
// -> [{ answer, session }], session null when none came back for its seed.
async function sessionPhase(run, from, count) {
  const asked = [];
  for (let i = 0; i < count; i++) {
    await until(run, from + i * PACE_MS);
    const seed = freshSeed();
    const answer = await askSession(run, seed);
    asked.push({ answer, session: sessionFor(answer, seed) });
  }
  return asked;
}

// The pair phase: one pair every 13 s from `from`, the i-th signing then a cache-missing GET. A pair is timed by its two
// exchanges, so a wait for the limit is never counted. K10: every pair answered 200, and the p95 under 1000 ms.
async function pairPhase(run, from, signings) {
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
    passed: answered && p95Ms < P95_UNDER_MS, p95Ms, pairMs: pairs.map(pair => pair.ms),
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

// 2 (burst run, over-limit): 20 simultaneous POSTs with distinct scores. All 200, each with its own id, and each one in
// the true top 10 finds its id in its answer. Only a 429 is inconclusive (the rule wasn't removed: fix the throwaway
// branch and rerun on a fresh throwaway preview); any other non-200 fails K11 for good.
async function burstOfSignings(run) {
  const signatures = Array.from({ length: BURST_SIZE }, (_, i) => signature(i));
  const answers = await Promise.all(signatures.map(s => run.client.post(scoresAt(run.target), s, OVER_LIMIT)));
  const statuses = answers.map(answer => answer.status);
  const rows = signatures.map((s, i) => ({ ...s, id: answers[i].body?.id }));
  const expected = [...rows].sort((a, b) => b.score - a.score).slice(0, TABLE_SIZE);
  const ownIds = new Set(rows.map(row => row.id)).size === rows.length && rows.every(row => typeof row.id === 'string');
  const findsOwn = expected.every(row => rowsOf(answers[rows.indexOf(row)].body).some(shown => shown.id === row.id));
  const outcome = statuses.some(status => status !== 200 && status !== 429) ? 'fail'
    : statuses.includes(429) ? 'inconclusive' : passOrFail(ownIds && findsOwn);
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

// S4b: a session, then blocked initials signed with it: 400 initials-not-allowed. The word filter (check 8) comes before
// the token (check 9), and only the bundled high-scores.js can give it. Its session's listing settles S4c.
async function wordFilterAfterASession(run) {
  const seed = freshSeed();
  const asked = await askSession(run, seed);
  const session = sessionFor(asked, seed);
  const answer = await run.client.post(scoresAt(run.target), run.slice.signing({ initials: BLOCKED, score: SCORE_STEP }, session));
  const refused = answer.status === 400 && answer.body?.error === 'initials-not-allowed';
  return { step: 'S4b', kpi: 'K12', outcome: passOrFail(session !== null && refused), statuses: [asked.status, answer.status], headers: answer.headers, tableIds: session && idsOf(asked.body) };
}

// S5: the session phase, 30 fresh seeds (K25 samples on a nearly empty table), then the pair phase on the same 13 s
// pace, 30 pairs each signing its own game with its session (K10).
async function sessionsThenPairs(run) {
  const start = run.clock.now();
  const asked = await sessionPhase(run, start, PAIRS);
  const signings = asked.map(({ session }, i) => run.slice.signing(signature(i), session));
  const { passed, ...pairs } = await pairPhase(run, start + PAIRS * PACE_MS, signings);
  const issued = asked.every(({ session }) => session !== null);
  const sessionMs = asked.map(({ answer }) => answer.ms);
  return { step: 'S5', kpi: 'K10 K25', outcome: passOrFail(issued && passed), ...pairs, sessionP95Ms: p95Of(sessionMs), sessionMs };
}

// S3, after S5 (which leaves about 20 keys on the table, as production has): 30 session requests, one every 13 s. K25:
// each issued, and the p95 under 1000 ms.
async function sessionsOnAFullerTable(run) {
  const asked = await sessionPhase(run, run.clock.now(), PAIRS);
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

// How each run signs and what its preview run checks: the leaderboard's, before this feature, and each slice's (--slice).
// 02-09 adds slice 02 (S7-S10, signings with records, and its burst run) and 03-04 slice 03 (S11-S13).
const LEADERBOARD = Object.freeze({ sessions: false, signing: body => body, preview: leaderboardPreview, burst: true });
const SLICES = Object.freeze({
  '01': Object.freeze({ sessions: true, signing: (body, session) => ({ ...body, session }), preview: slice01Preview, burst: false }),
});

// U2's signing, as the permalink's code takes it: from slice 01 on, through a session from that same permalink.
async function signOnce(run) {
  if (!run.slice.sessions) return run.client.post(scoresAt(run.target), signature(0));
  const seed = freshSeed();
  const session = sessionFor(await askSession(run, seed), seed);
  return run.client.post(scoresAt(run.target), run.slice.signing(signature(0), session));
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

// { client, clock, progress, slice, target URL, production, permalink }, with the guard's host rules checked before
// anything is sent.
function startRun(options, ports, target, unpublished = null) {
  refuseUnless(decidePost({ site: options.site, url: target, unpublished }), target, Refusal.NO_EMPTY_FIRST_GET);
  const client = createSmokeClient({ site: options.site, unpublished, fetch: ports.fetch, clock: ports.clock });
  return { client, clock: ports.clock, progress: ports.progress, slice: options.slice, target, production: options.production, permalink: options.permalink };
}

const RUNS = Object.freeze({
  async preview(options, ports, record) {
    const run = startRun(options, ports, options.preview);
    await run.slice.preview(run, record);
  },

  async burst(options, ports, record) {
    const run = startRun(options, ports, options.burst);
    record(await timed(run, firstRequest));
    const burst = await timed(run, burstOfSignings);
    record(burst);
    await coolDown(run);
    record(await timed(run, read => burstTable(read, burst)));
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

const USAGE = 'node scripts/smoke-leaderboard.mjs --site <name> --preview <URL> [--slice 01] [--production <URL>] [--permalink <URL>]'
  + ' | --site <name> --burst <URL> | --production <URL>'
  + ' | --site <name> --unpublished <permalink> --production <URL> [--slice 01] [--site-id <ID>] (with NETLIFY_AUTH_TOKEN for the API)';
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

// The run's entry point: the command line's arguments, and its ports (the network, the clock, the environment and where
// progress goes) -> the summary, its exitCode included. Nothing is sent for a malformed command or a refused target.
export async function runSmoke(args, { fetch = globalThis.fetch, clock = SYSTEM_CLOCK, env = {}, progress = toStderr } = {}) {
  const summary = { mode: null, slice: null, site: null, startedAt: isoAt(clock.now()), steps: [] };
  try {
    const options = optionsFrom(args, env);
    Object.assign(summary, { mode: options.mode, slice: options.sliceName, site: options.site ?? null });
    await RUNS[options.mode](options, { fetch, clock, progress }, step => { summary.steps.push(step); progress(`step ${step.step}: ${step.outcome}`); });
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
