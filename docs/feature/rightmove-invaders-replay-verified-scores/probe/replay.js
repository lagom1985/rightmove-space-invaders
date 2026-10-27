// PROBE ONLY (not production code): a bot that plays a seeded game and records its held keys by step index, a replayer
// that plays the log back, and a fingerprint of the gameplay state to compare engines.
const STEP = 1 / 120;
const LEFT = 1, RIGHT = 2, FIRE = 4;
const CHECK_EVERY = 1200;   // a fingerprint every 10 simulated seconds

function fnv(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

export function fingerprint(m) {
  const g = m.g;
  const shields = g.shields.map(s => Array.from(s.cells).join('')).join('|');
  return fnv(JSON.stringify([g.state, g.score, g.lives, g.level, g.player.x, g.formation, g.shot, g.bolts, g.dream,
    g.dreamTimer, g.fireTimer, g.respawn, g.banner, g.invaders.map(v => (v.alive ? 1 : 0)).join(''), shields]));
}

const keysFor = bits => ({ isDown: code =>
  ((code === 'ArrowLeft') && (bits & LEFT) !== 0) || ((code === 'ArrowRight') && (bits & RIGHT) !== 0) || ((code === 'Space') && (bits & FIRE) !== 0) });

// A greedy bot: walk under the nearest living hurdle's column, keep Space held, and step aside from a bolt about to land.
function botBits(m) {
  const g = m.g, cx = g.player.x + m.PW / 2;
  let target = null, best = Infinity;
  for (const v of g.invaders) if (v.alive) {
    const x = m.invaderX(v) + m.IW / 2, d = Math.abs(x - cx);
    if (d < best) { best = d; target = x; }
  }
  if (g.dream && g.dream.x > 0 && g.dream.x < 960) target = g.dream.x + m.DW / 2;
  let bits = FIRE;
  const danger = g.bolts.find(b => b.y > g.player.y - 140 && b.y < g.player.y + 20 && Math.abs(b.x - cx) < m.PW);
  if (danger) bits |= danger.x < cx ? RIGHT : LEFT;
  else if (target !== null && Math.abs(target - cx) > 3) bits |= target > cx ? RIGHT : LEFT;
  return bits;
}

function start(m, seed, particles) {
  m.probeSeed(seed, { particles });
  m.handlePresses(new Set(['Enter']));
  m.takeEvents();
}

export function playBot(m, seed, { particles = true, maxSteps = 2_000_000, decideEvery = 1 } = {}) {
  start(m, seed, particles);
  const log = [], checks = [];
  let bits = -1, step = 0;
  while (m.g.state !== 'over' && step < maxSteps) {
    const next = step % decideEvery === 0 ? botBits(m) : bits;
    if (next !== bits) { log.push([step, next]); bits = next; }
    m.update(STEP, keysFor(bits));
    m.takeEvents();
    step++;
    if (step % CHECK_EVERY === 0) checks.push(fingerprint(m));
  }
  checks.push(fingerprint(m));
  return { log, steps: step, score: m.g.score, level: m.g.level, checks };
}

export function replay(m, seed, log, steps, { particles = false } = {}) {
  start(m, seed, particles);
  const checks = [];
  let bits = 0, next = 0, step = 0;
  for (; step < steps && m.g.state !== 'over'; step++) {
    while (next < log.length && log[next][0] === step) bits = log[next++][1];
    m.update(STEP, keysFor(bits));
    m.takeEvents();
    if ((step + 1) % CHECK_EVERY === 0) checks.push(fingerprint(m));
  }
  checks.push(fingerprint(m));
  return { steps: step, over: m.g.state === 'over', score: m.g.score, level: m.g.level, checks };
}
