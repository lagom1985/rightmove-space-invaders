// The high-score table everyone shares, behind /api/scores and /api/sessions (netlify/functions/scores.mjs; locally,
// scripts/serve.mjs). fetch and the timers are handed in by main.js, so a test's fake clock drives the timeout (DDD-13).
// Each call is one request, never retried, and nothing is kept between calls. Anything but an OK answer of the promised
// shape within TIMEOUT_MS rejects: a non-OK answer, a body of any other shape, a network error or the timeout, which
// aborts the request. main.js decides what a missing answer means.
const SCORES = '/api/scores';
const SESSIONS = '/api/sessions';
const TIMEOUT_MS = 5000;
const JSON_TYPE = Object.freeze({ 'content-type': 'application/json' });

// The shapes the rules and the views read. A 200 can carry anything (a proxy's page, another version of the function),
// and anything else stops here, as a failure (ADR-008, DDD-9), before a promise callback or a frame can trip on it.
const isRow = row => typeof row?.initials === 'string' && Number.isFinite(row.score) && typeof row.id === 'string';
const isTable = answer => Array.isArray(answer?.scores) && answer.scores.every(isRow) && Number.isFinite(answer.listedAt);
const isSigning = answer => isTable(answer) && typeof answer.id === 'string';
// A session is the table's business: only that it is for the seed sent is checked here (DDD-R10).
const isSessionFor = seed => answer => isTable(answer) && answer.session?.seed === seed
  && Number.isSafeInteger(answer.session.issuedAt) && typeof answer.session.token === 'string';

export function createLeaderboard({ fetch, setTimeout, clearTimeout }) {
  async function request(path, isPromised, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(path, { ...init, signal: controller.signal });
      if (!response.ok) throw new Error(`The high-score table answered ${response.status}`);
      const answer = await response.json();
      if (!isPromised(answer)) throw new Error('The high-score table answered something other than a table');
      return answer;
    } finally {
      clearTimeout(timer);
    }
  }

  const posting = body => ({ method: 'POST', headers: JSON_TYPE, body: JSON.stringify(body) });

  return {
    // -> { scores: [{ initials, score, id }] best first, listedAt }, listedAt being when the server listed them
    load() { return request(SCORES, isTable); },
    // seed (32 lowercase hex) -> { session: { seed, issuedAt, token }, scores, listedAt }: a game's session, with the
    // table as the server listed it (DDD-R1)
    startSession(seed) { return request(SESSIONS, isSessionFor(seed), posting({ seed })); },
    // -> { scores, id, listedAt }, id being the new row's. pendingSession is the promise startSession returned for the
    // game being signed: nothing is sent until it resolves, and the timeout starts when the signing is sent. If it
    // rejects, the signing fails at once, unsent (DDD-R10).
    async sign({ initials, score, session: pendingSession }) {
      const { session } = await pendingSession;
      return request(SCORES, isSigning, posting({ initials, score, session }));
    },
  };
}
