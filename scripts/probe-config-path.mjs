// PROBE ONLY (branch probe/config-path, never merged): does Netlify route two paths of one function, and count both
// against the function's one rate-limit rule? rightmove-invaders-replay-verified-scores, DEVOPS (DESIGN Open question 5).
//
//   node scripts/probe-config-path.mjs --site <name> --preview https://deploy-preview-<n>--<name>.netlify.app
//
// It only reads: GETs of /api/scores (a cache miss each, ?table=<random>) and requests to the probe's /api/sessions,
// which answers a fixed body and opens no store. Nothing is written to Blobs. About 50 requests in about 3 minutes.
// Prints one JSON summary on stdout; progress on stderr.
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { site: { type: 'string' }, preview: { type: 'string' } } });
const site = values.site ?? '';
const base = new URL(values.preview ?? 'http://invalid');
if (!/^[a-z0-9-]+$/.test(site) || !new RegExp(`^deploy-preview-\\d+--${site}\\.netlify\\.app$`).test(base.hostname)) {
  console.error('Refused: --preview must be https://deploy-preview-<n>--<site>.netlify.app, with --site <site>');
  process.exit(2);
}

const log = message => console.error(`[probe] ${message}`);
const started = Date.now();
const scoresUrl = () => new URL(`/api/scores?table=${randomUUID()}`, base);
const sessionsUrl = path => new URL(path, base);

async function send(path, method) {
  const url = path === 'scores' ? scoresUrl() : sessionsUrl(path);
  const init = method === 'POST' ? { method, headers: { 'content-type': 'application/json' }, body: '{}' } : { method };
  const t0 = performance.now();
  try {
    const response = await fetch(url, init);
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { path, method, status: response.status, ms: Math.round(performance.now() - t0), at: Date.now() - started, body };
  } catch (error) {
    return { path, method, status: 'network-error', error: String(error?.cause?.code ?? error?.message) };
  }
}

// R1: both paths are routed to the function; a third path is not.
log('R1: routing');
const routing = {
  scores: await send('scores', 'GET'),
  sessionsPost: await send('/api/sessions', 'POST'),
  sessionsGet: await send('/api/sessions', 'GET'),
  notRouted: await send('/api/sessionsx', 'GET'),
};
const routed = routing.scores.status === 200 && Array.isArray(routing.scores.body?.scores)
  && routing.sessionsPost.status === 200 && routing.sessionsPost.body?.probe === 'sessions'
  && routing.sessionsGet.status === 200 && routing.sessionsGet.body?.probe === 'sessions'
  && routing.notRouted.status === 404;

// R2: one rate-limit counter for both paths? 40 requests at 2 a second, alternating the paths.
log('R2: waiting 61 s for a fresh rate-limit window');
await delay(61_000);
log('R2: 40 requests at 2 a second, alternating /api/sessions (POST) and /api/scores (GET)');
const pending = [];
for (let i = 0; i < 40; i++) {
  pending.push(send(i % 2 === 0 ? '/api/sessions' : 'scores', i % 2 === 0 ? 'POST' : 'GET'));
  await delay(500);
}
const burst = await Promise.all(pending);
const accepted = path => burst.filter(r => r.path === path && r.status === 200).length;
const limited = path => burst.filter(r => r.path === path && r.status === 429).length;
const firstLimited = burst.findIndex(r => r.status === 429);
const counts = {
  sessions: { accepted: accepted('/api/sessions'), limited: limited('/api/sessions') },
  scores: { accepted: accepted('scores'), limited: limited('scores') },
  other: burst.filter(r => r.status !== 200 && r.status !== 429).map(r => r.status),
  firstLimitedAtRequest: firstLimited < 0 ? null : firstLimited + 1,
};
const total = counts.sessions.accepted + counts.scores.accepted;
const shared = total <= 18 && counts.sessions.limited > 0 && counts.scores.limited > 0;
const perPath = counts.sessions.accepted >= 11 && counts.scores.accepted >= 11;

// R3: both paths answer again once the window has passed.
log('R3: waiting 61 s, then one request on each path');
await delay(61_000);
const recovered = { sessions: await send('/api/sessions', 'POST'), scores: await send('scores', 'GET') };

const verdict = !routed ? 'routing-failed' : counts.other.length ? 'inconclusive' : shared ? 'shared-counter' : perPath ? 'counter-per-path' : 'inconclusive';
console.log(JSON.stringify({
  preview: base.origin, verdict, routed,
  routing: Object.fromEntries(Object.entries(routing).map(([k, r]) => [k, { status: r.status, ms: r.ms }])),
  burst: { ...counts, totalAccepted: total, statuses: burst.map(r => `${r.path === 'scores' ? 'S' : 'X'}${r.status}`).join(' ') },
  recovered: { sessions: recovered.sessions.status, scores: recovered.scores.status },
}, null, 2));
process.exit(verdict === 'shared-counter' ? 0 : 1);
