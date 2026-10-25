// The high-score table everyone shares, behind /api/scores (netlify/functions/scores.mjs; locally, scripts/serve.mjs).
// fetch is handed in by main.js. Anything but an OK answer rejects: main.js decides what a missing table means.
const SCORES = '/api/scores';

export function createLeaderboard(fetch) {
  async function request(init) {
    const response = await fetch(SCORES, init);
    if (!response.ok) throw new Error(`The high-score table answered ${response.status}`);
    return response.json();
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
