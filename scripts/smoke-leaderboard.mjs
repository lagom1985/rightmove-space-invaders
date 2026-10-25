// Preview smoke test of the high-score table on Netlify (K10-K14): the DEVOPS spec "Preview smoke test" in
// docs/feature/rightmove-invaders-leaderboard/feature-delta.md, step for step. Node 22 fetch, no dependencies; the valid
// and blocked initials come from the rules the function bundles (src/game/high-scores.js).
//
//   --site <name> --preview <URL> [--production <URL>] [--permalink <URL>]     preview run, steps 1 and 4-10 (K10, K12, K14)
//   --site <name> --burst <URL>        burst run, steps 1-3 (K11), on a throwaway preview whose only change removes rateLimit
//   --production <URL>                 production mode, P1 (K13): one GET, never a POST
//   --site <name> --unpublished <permalink> --production <URL> [--site-id <ID>]    unpublished check, U1-U3 (K13): the
//       published deploy's ID comes from Netlify's API with NETLIFY_AUTH_TOKEN and --site-id, or the owner types it back
//
// It prints one JSON summary on stdout (progress goes to stderr) and exits 0 when every hard check passed; 1 when one
// failed or was inconclusive (an inconclusive step is never a pass), or the command was malformed; 2 when the write
// guard refused, and nothing was written. Every step stays within the rate limit's 10 requests per 60 s per host, except
// the over-limit runs (steps 2, 8a, 8b and 9), each followed by a 61 s wait.
// It needs a pushed deploy, so it runs only with the owner's OK to push (DEVOPS pre-requisite 9). The token stays in the
// owner's shell: it goes to api.netlify.com only, and is never printed or written.
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createInterface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { ALPHABET, BLOCKED_INITIALS, SCORE_STEP, TABLE_SIZE, isAllowedInitials } from '../src/game/high-scores.js';

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

// ---- the client: every POST passes the guard first, and the pacing holds outside the over-limit runs ----

const WINDOW_MS = 60_000;
const LIMIT = 10;   // config.rateLimit: 10 requests per 60 s per IP and domain

// One request and its answer, timed on the client with the body read. A redirect is an answer, never a request to a host
// the guard didn't decide on. No answer at all (the network failed) is status 0.
async function exchange(fetch, url, init) {
  const sentAt = Date.now();
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  try {
    const response = await fetch(url, { ...init, redirect: 'manual' });
    const body = await response.json().catch(() => null);
    return { status: response.status, headers: Object.fromEntries(response.headers), body, sentAt, ms: elapsed() };
  } catch {
    return { status: 0, headers: {}, body: null, sentAt, ms: elapsed() };
  }
}

// A request that would be the 11th to its host in the last 60 s waits for the oldest to age out.
async function withinTheLimit(sentTimes) {
  for (;;) {
    const recent = sentTimes.filter(time => time > Date.now() - WINDOW_MS);
    if (recent.length < LIMIT) return;
    await delay(recent[0] + WINDOW_MS - Date.now());
  }
}

// { site, unpublished (as decidePost takes it), fetch (the network port) } -> { get(url, { overLimit }),
// post(url, signature, { overLimit }) }, each resolving to { status, headers, body, sentAt, ms }; a refused POST rejects
// with the guard's reason and sends nothing.
export function createSmokeClient({ site, unpublished = null, fetch = globalThis.fetch }) {
  const firstAnswers = new Map();   // hostname -> the run's first answer from it (rule 3)
  const sentTimes = new Map();      // hostname -> send times, for the pacing

  async function send(url, init, overLimit) {
    const host = new URL(url).hostname;
    const isFirst = !sentTimes.has(host);   // the first sent, whichever answers first
    if (isFirst) sentTimes.set(host, []);
    if (!overLimit) await withinTheLimit(sentTimes.get(host));
    sentTimes.get(host).push(Date.now());
    const answer = await exchange(fetch, url, init);
    if (isFirst) firstAnswers.set(host, { method: init.method, status: answer.status, body: answer.body });
    return answer;
  }

  return Object.freeze({
    get: (url, { overLimit = false } = {}) => send(url, { method: 'GET' }, overLimit),
    async post(url, signature, { overLimit = false } = {}) {
      const firstAnswer = URL.canParse(url) ? firstAnswers.get(new URL(url).hostname) : undefined;
      const decision = decidePost({ site, url, unpublished, firstAnswer });
      if (!decision.allowed) throw new GuardRefusal(decision.reason, url);
      const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(signature) };
      return send(url, init, overLimit);
    },
  });
}

// ---- the steps (the spec's table): each resolves to one entry of the summary ----

const SCORES_PATH = '/api/scores';
const COOL_DOWN_MS = 61_000;   // after each over-limit run, and before step 6
const CACHE_TTL_MS = 15_000;   // the GET cache at the CDN (DDD-6)
const BURST_SIZE = 20;
const PAIRS = 30;
const PAIR_EVERY_MS = 13_000;
const P95_UNDER_MS = 1000;
// Netlify's API: the site's published deploy is published_deploy.id in getSite, GET /api/v1/sites/{site_id} (DEVOPS
// write guard, rule 2). Checked against the OpenAPI reference (https://open-api.netlify.com/, operation getSite): the
// Site object's published_deploy is a Deploy object, and a Deploy's id is a string. The reference doesn't document the
// id's format: the 24 hex digits a permalink starts with (DEPLOY_ID) are this script's assumption, kept fail-closed, so
// an id of any other shape refuses.
const PUBLISHED_DEPLOY_ID_FIELD = Object.freeze(['published_deploy', 'id']);
const NETLIFY_SITES_API = 'https://api.netlify.com/api/v1/sites/';

// Valid initials for the smoke signatures, and initials on the word filter for step 4, from the bundled rules.
const SIGNERS = [...ALPHABET].map(letter => `SM${letter}`).filter(isAllowedInitials);
const BLOCKED = BLOCKED_INITIALS[0];
const signature = i => ({ initials: SIGNERS[i % SIGNERS.length], score: (i + 1) * SCORE_STEP });

const scoresAt = (base, query = '') => new URL(`${SCORES_PATH}${query}`, base).href;
const missQuery = () => `?table=${randomUUID()}`;   // a cache miss by design (Netlify-Vary: query=table)
const rowsOf = body => (Array.isArray(body?.scores) ? body.scores : []);
const isEmptyList = body => Array.isArray(body?.scores) && body.scores.length === 0 && Number.isFinite(body.listedAt);
const passOrFail = pass => (pass ? 'pass' : 'fail');
const progress = message => process.stderr.write(`${message}\n`);
const until = async time => { if (time > Date.now()) await delay(time - Date.now()); };
const coolDown = async () => { progress('waiting 61 s for the rate-limit window to clear'); await delay(COOL_DOWN_MS); };

// Cache-Status (RFC 9211): one member per cache, each with parameters; `hit` on any member means no function ran.
const isHit = (cacheStatus = '') => cacheStatus.split(',')
  .some(member => member.split(';').slice(1).some(parameter => parameter.trim() === 'hit'));

// 1: the deploy's first request. 200 with an empty table: the function loaded with its rules and opened an empty deploy
// store (and the guard's rule 3). Its time is the cold-start sample, kept out of step 6's p95.
async function firstRequest(run) {
  const answer = await run.client.get(scoresAt(run.target));
  const outcome = passOrFail(answer.status === 200 && isEmptyList(answer.body));
  return { step: '1', kpi: 'K10 K12', outcome, status: answer.status, coldStartMs: answer.ms, headers: answer.headers };
}

// 2 (burst run): 20 simultaneous POSTs with distinct scores. All 200, each with its own id, and each one in the true top 10
// finds its id in its answer. Only a 429 is inconclusive (the rule wasn't removed: fix the throwaway branch and rerun on a
// fresh throwaway preview); any other non-200 fails K11 for good.
async function burstOfSignings(run) {
  const signatures = Array.from({ length: BURST_SIZE }, (_, i) => signature(i));
  const answers = await Promise.all(signatures.map(s => run.client.post(scoresAt(run.target), s, { overLimit: true })));
  const statuses = answers.map(answer => answer.status);
  const rows = signatures.map((s, i) => ({ ...s, id: answers[i].body?.id }));
  const expected = [...rows].sort((a, b) => b.score - a.score).slice(0, TABLE_SIZE);
  const ownIds = new Set(rows.map(row => row.id)).size === rows.length && rows.every(row => typeof row.id === 'string');
  const findsOwn = expected.every(row => rowsOf(answers[rows.indexOf(row)].body).some(shown => shown.id === row.id));
  const outcome = statuses.some(status => status !== 200 && status !== 429) ? 'fail'
    : statuses.includes(429) ? 'inconclusive' : passOrFail(ownIds && findsOwn);
  const lastListedAt = Math.max(...answers.map(answer => answer.body?.listedAt ?? 0));
  return { step: '2', kpi: 'K11', outcome, statuses, expected, lastListedAt };
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
  const started = Date.now();
  const urls = [scoresAt(run.target), scoresAt(run.target), scoresAt(run.target, `?x=${randomUUID()}`), scoresAt(run.target, missQuery())];
  const answers = [];
  for (const url of urls) answers.push(await run.client.get(url));
  const withinMs = Date.now() - started;
  const [first, second, other, miss] = answers;
  const cacheStatus = answers.map(answer => answer.headers['cache-status'] ?? null);
  const shared = [second, other].every(answer => isHit(answer.headers['cache-status']) && answer.body?.listedAt === first.body?.listedAt);
  const missed = !isHit(miss.headers['cache-status']) && miss.body?.listedAt > first.body?.listedAt;
  const pass = answers.every(answer => answer.status === 200) && shared && missed;
  const outcome = !cacheStatus.every(Boolean) ? 'fail' : withinMs > CACHE_TTL_MS ? 'inconclusive' : passOrFail(pass);
  const listedAt = answers.map(answer => answer.body?.listedAt ?? null);
  return { step: '5', kpi: 'K14', outcome, withinMs, statuses: answers.map(answer => answer.status), cacheStatus, listedAt };
}

// 6: 30 pairs, one every 13 s: a POST, then a cache-missing GET, each pair timed on the client. K10: the p95 (the 29th of
// 30) under 1000 ms.
async function signingPairs(run) {
  const start = Date.now();
  const pairs = [];
  for (let i = 0; i < PAIRS; i++) {
    await until(start + i * PAIR_EVERY_MS);
    const started = performance.now();
    const post = await run.client.post(scoresAt(run.target), signature(i));
    const get = await run.client.get(scoresAt(run.target, missQuery()));
    pairs.push({ ms: Math.round(performance.now() - started), post, get });
  }
  const p95Ms = pairs.map(pair => pair.ms).sort((a, b) => a - b)[PAIRS - 2];
  const answered = pairs.every(pair => pair.post.status === 200 && pair.get.status === 200);
  return {
    step: '6', kpi: 'K10', outcome: passOrFail(answered && p95Ms < P95_UNDER_MS), p95Ms, pairMs: pairs.map(pair => pair.ms),
    statuses: pairs.map(pair => [pair.post.status, pair.get.status]), ids: pairs.map(pair => pair.post.body?.id ?? null),
    firstPostHeaders: pairs[0].post.headers,
  };
}

// 7 (with --production): the production table holds none of step 6's ids. A 404 means production has no function yet:
// skipped, and step 1's empty table plus the preview's log line are the evidence.
async function productionUntouched(run, ids) {
  if (!run.production) return { step: '7', kpi: 'K12', outcome: 'skipped', reason: 'no --production' };
  const answer = await run.client.get(scoresAt(run.production));
  if (answer.status === 404) return { step: '7', kpi: 'K12', outcome: 'skipped', status: 404, reason: 'production has no function yet' };
  const ours = new Set(ids.filter(Boolean));
  const leaked = rowsOf(answer.body).map(row => row.id).filter(id => ours.has(id));
  return { step: '7', kpi: 'K12', outcome: passOrFail(answer.status === 200 && leaked.length === 0), status: answer.status, leaked };
}

// An over-limit run: `count` GETs at `perSecond`, sent on schedule without waiting for the answers.
async function flood(run, { perSecond, count, query = missQuery }) {
  const start = Date.now();
  const inFlight = [];
  for (let i = 0; i < count; i++) {
    await until(start + (i * 1000) / perSecond);
    inFlight.push(run.client.get(scoresAt(run.target, query()), { overLimit: true }));
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

// 8a: 2 a second for 125 s. Pass: a 429 within 16 s of the first request, and at most 30 accepted in each full 60 s window
// (the limit plus the documented 10 s lag at this rate). Above 20 in a window isn't a fail: it asks for the abuse table's
// recompute before the merge.
async function steadyFlood(run) {
  const { achievedPerSecond, first429AfterMs, answers } = await flood(run, { perSecond: 2, count: 250 });
  const mostAccepted = mostAcceptedInAFullWindow(answers);
  const outcome = achievedPerSecond < 2 ? 'inconclusive' : passOrFail(isWithin(first429AfterMs, 16_000) && mostAccepted <= 30);
  return { step: '8a', kpi: 'K14', outcome, achievedPerSecond, first429AfterMs, mostAcceptedInAWindow: mostAccepted, recompute: mostAccepted > 20 };
}

// 8b: 20 a second for 60 s, then 61 s later one GET. Pass: a 429 within 11 s, and the last GET is 200. The accepted count
// is one fast IP's real per-minute cap; above 210 (10 + 10 s x 20 a second) it asks for the abuse table's recompute.
async function fastFlood(run) {
  const { achievedPerSecond, first429AfterMs, accepted } = await flood(run, { perSecond: 20, count: 1200 });
  await coolDown();
  const after = await run.client.get(scoresAt(run.target, missQuery()));
  const outcome = achievedPerSecond < 20 ? 'inconclusive' : passOrFail(isWithin(first429AfterMs, 11_000) && after.status === 200);
  return { step: '8b', kpi: 'K14', outcome, achievedPerSecond, first429AfterMs, accepted, afterStatus: after.status, recompute: accepted > 210 };
}

// 9: 25 plain GETs, one a second (over the limit by design): whether cache hits count toward the limit is recorded, either
// way. Pass needs positive evidence: the plain GET 61 s later is 200 with a Cache-Status (a cached 429 would answer 429
// there). A 429 whose Cache-Status shows a hit fails.
async function cachedFlood(run) {
  const { answers } = await flood(run, { perSecond: 1, count: 25, query: () => '' });
  await coolDown();
  const after = await run.client.get(scoresAt(run.target));
  const cached429 = answers.some(answer => answer.status === 429 && isHit(answer.headers['cache-status']));
  const pass = !cached429 && after.status === 200 && Boolean(after.headers['cache-status']);
  return {
    step: '9', kpi: 'K14', outcome: passOrFail(pass), cacheHitsCountTowardTheLimit: answers.some(answer => answer.status === 429),
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
  const at = new Date().toISOString();
  const answer = await run.client.get(scoresAt(run.production, missQuery()));
  return {
    step: 'P1', kpi: 'K13', outcome: passOrFail(answer.status === 200 && Array.isArray(answer.body?.scores)), status: answer.status, at,
    next: 'P2: in Netlify -> Cloud compute -> Functions -> scores, the scores.read line at that time shows'
      + ' "scope":"site","context":"production","published":true. P3: do it today.',
  };
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
async function publishedIdFor({ token, siteId }, permalink) {
  if (token && siteId) return { publishedId: await publishedIdFromApi({ token, siteId }), from: 'api' };
  return { publishedId: await publishedIdFromOwner(permalink), from: 'owner' };
}

// { site, target URL, production, permalink }, with the guard's host rules checked before anything is sent.
function startRun(options, target, unpublished = null) {
  refuseUnless(decidePost({ site: options.site, url: target, unpublished }), target, Refusal.NO_EMPTY_FIRST_GET);
  return { client: createSmokeClient({ site: options.site, unpublished }), target, production: options.production, permalink: options.permalink };
}

const RUNS = Object.freeze({
  async preview(options, record) {
    const run = startRun(options, options.preview);
    record(await firstRequest(run));
    record(await wordFilter(run));
    record(await sharedCache(run));
    await coolDown();
    const pairs = await signingPairs(run);
    record(pairs);
    record(await productionUntouched(run, pairs.ids));
    await coolDown();
    record(await steadyFlood(run));
    await coolDown();
    record(await fastFlood(run));
    await coolDown();
    record(await cachedFlood(run));
    record(await permalinkCopy(run));
  },

  async burst(options, record) {
    const run = startRun(options, options.burst);
    record(await firstRequest(run));
    const burst = await burstOfSignings(run);
    record(burst);
    await coolDown();
    record(await burstTable(run, burst));
  },

  async production(options, record) {
    record(await productionRead({ client: createSmokeClient({ site: options.site }), production: options.production }));
  },

  // U1: the guard first, then an opening GET that finds an empty table. U2: one valid signature, 200 with an id; its log
  // line shows "scope":"deploy","context":"production","published":false. U3: a production GET without that id.
  async unpublished(options, record) {
    const target = options.unpublished;
    const unknown = decidePost({ site: options.site, url: target, unpublished: { publishedId: null } });
    refuseUnless(unknown, target, Refusal.PUBLISHED_UNKNOWN, Refusal.NO_EMPTY_FIRST_GET);
    const { publishedId, from } = await publishedIdFor(options, target);
    const run = startRun(options, target, { publishedId });
    const opening = await run.client.get(scoresAt(target));
    const empty = opening.status === 200 && isEmptyList(opening.body);
    record({ step: 'U1', kpi: 'K13', outcome: passOrFail(empty), publishedIdFrom: from, status: opening.status });
    const signed = await run.client.post(scoresAt(target), signature(0));
    const id = signed.body?.id ?? null;
    const next = 'its scores.signed line shows "scope":"deploy","context":"production","published":false';
    record({ step: 'U2', kpi: 'K13', outcome: passOrFail(signed.status === 200 && typeof id === 'string'), status: signed.status, id, next });
    const production = await run.client.get(scoresAt(run.production, missQuery()));
    const untouched = production.status === 200 && !rowsOf(production.body).some(row => row.id === id);
    record({ step: 'U3', kpi: 'K13', outcome: passOrFail(untouched), status: production.status });
  },
});

// ---- the command line ----

const USAGE = 'node scripts/smoke-leaderboard.mjs --site <name> --preview <URL> [--production <URL>] [--permalink <URL>]'
  + ' | --site <name> --burst <URL> | --production <URL>'
  + ' | --site <name> --unpublished <permalink> --production <URL> [--site-id <ID>] (with NETLIFY_AUTH_TOKEN for the API)';
const OPTIONS = Object.freeze(Object.fromEntries(['site', 'preview', 'production', 'permalink', 'burst', 'unpublished', 'site-id']
  .map(name => [name, { type: 'string' }])));

function modeOf(values) {
  const modes = ['preview', 'burst', 'unpublished'].filter(mode => values[mode] !== undefined);
  if (modes.length > 1 || (modes[0] === 'unpublished' && !values.production)) return undefined;
  return modes[0] ?? (values.production ? 'production' : undefined);
}

// Strict: an unknown flag (a typed published deploy ID, say) is a malformed command.
function optionsFrom(args, env) {
  const { values } = parseArgs({ args, options: OPTIONS });
  const mode = modeOf(values);
  if (!mode) throw new Error(`usage: ${USAGE}`);
  return { ...values, mode, siteId: values['site-id'], token: env.NETLIFY_AUTH_TOKEN };
}

const failedOrInconclusive = steps => steps.some(step => step.outcome === 'fail' || step.outcome === 'inconclusive');
const exitCodeOf = ({ refusal, error, steps }) => (refusal ? 2 : (error || failedOrInconclusive(steps)) ? 1 : 0);

async function main() {
  const summary = { mode: null, site: null, startedAt: new Date().toISOString(), steps: [] };
  try {
    const options = optionsFrom(process.argv.slice(2), process.env);
    Object.assign(summary, { mode: options.mode, site: options.site ?? null });
    await RUNS[options.mode](options, step => { summary.steps.push(step); progress(`step ${step.step}: ${step.outcome}`); });
  } catch (error) {
    if (error instanceof GuardRefusal) summary.refusal = { reason: error.reason, host: error.host };
    else summary.error = error.message;
  }
  summary.finishedAt = new Date().toISOString();
  summary.exitCode = exitCodeOf(summary);
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
