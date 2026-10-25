// The high-score table everyone shares, behind /api/scores (netlify/functions/scores.mjs; locally, scripts/serve.mjs).
// fetch and the timers are handed in by main.js, so a test's fake clock drives the timeout (DDD-13). Each call is one
// request, never retried, and nothing is kept between calls. Anything but an OK answer of the promised shape within
// TIMEOUT_MS rejects: a non-OK answer, a body of any other shape, a network error or the timeout, which aborts the
// request. main.js decides what a missing answer means.
const SCORES = '/api/scores';
const TIMEOUT_MS = 5000;

// The shapes the rules and the views read. A 200 can carry anything (a proxy's page, another version of the function),
// and anything else stops here, as a failure (ADR-008, DDD-9), before a promise callback or a frame can trip on it.
const isRow = row => typeof row?.initials === 'string' && Number.isFinite(row.score) && typeof row.id === 'string';
const isTable = answer => Array.isArray(answer?.scores) && answer.scores.every(isRow) && Number.isFinite(answer.listedAt);
const isSigning = answer => isTable(answer) && typeof answer.id === 'string';

export function createLeaderboard({ fetch, setTimeout, clearTimeout }) {
  async function request(isPromised, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(SCORES, { ...init, signal: controller.signal });
      if (!response.ok) throw new Error(`The high-score table answered ${response.status}`);
      const answer = await response.json();
      if (!isPromised(answer)) throw new Error('The high-score table answered something other than a table');
      return answer;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    // -> { scores: [{ initials, score, id }] best first, listedAt }, listedAt being when the server listed them
    load() { return request(isTable); },
    // -> { scores, id, listedAt }, id being the new row's
    sign({ initials, score }) {
      return request(isSigning, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initials, score }) });
    },
  };
}
