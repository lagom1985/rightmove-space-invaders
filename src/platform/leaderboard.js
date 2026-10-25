// The high-score table everyone shares, behind /api/scores (netlify/functions/scores.mjs; locally, scripts/serve.mjs).
// fetch and the timers are handed in by main.js, so a test's fake clock drives the timeout (DDD-13). Each call is one
// request, never retried, and nothing is kept between calls. Anything but an OK answer within TIMEOUT_MS rejects: a
// non-OK answer, a network error or the timeout, which aborts the request. main.js decides what a missing answer means.
const SCORES = '/api/scores';
const TIMEOUT_MS = 5000;

export function createLeaderboard({ fetch, setTimeout, clearTimeout }) {
  async function request(init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(SCORES, { ...init, signal: controller.signal });
      if (!response.ok) throw new Error(`The high-score table answered ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    // -> { scores: [{ initials, score, id }] best first, listedAt }, listedAt being when the server listed them
    load() { return request(); },
    // -> { scores, id, listedAt }, id being the new row's
    sign({ initials, score }) {
      return request({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initials, score }) });
    },
  };
}
