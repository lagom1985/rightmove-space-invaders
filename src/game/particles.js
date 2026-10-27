// The sparks a hit, a shot or a lost home throws, and the floating texts, moved on with the game. Nothing in the gameplay
// reads them, so they are the one place in src/game/ on Math.random, Math.cos and Math.sin (layering rule 9, DDD-R6):
// every gameplay draw comes from the game's chance.
const MAX_PARTICLES = 2000;

// n sparks of `color` thrown from (x, y) into g.particles, at up to `speed` units a second.
export function burst(g, x, y, color, n, speed = 160) {
  for (let i = 0; i < n && g.particles.length < MAX_PARTICLES; i++) {
    const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random()), life = 0.4 + Math.random() * 0.4;
    g.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color });
  }
}

// The sparks and the floating texts, dt seconds on; the spent ones are gone.
export function updateParticles(g, dt) {
  const ps = g.particles;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.life -= dt;
    if (p.life <= 0) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.985; p.vy = p.vy * 0.985 + 120 * dt;
  }
  for (let i = g.texts.length - 1; i >= 0; i--) {
    const m = g.texts[i];
    m.life -= dt; m.y -= 24 * dt;
    if (m.life <= 0) g.texts.splice(i, 1);
  }
}
