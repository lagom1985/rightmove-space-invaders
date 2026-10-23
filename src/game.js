import { W, H, PX, GROUND } from './config.js';
import { COLORS, HURDLES, PIN_ART, DREAM_ART, DREAM_BONUSES, pounds } from './theme.js';
import { SW, makeShield, sweep, erode, clearRect } from './shields.js';
import { loadBest, saveBest } from './storage.js';
import { GameEvent } from './events.js';

// Sizes in logical units, derived from the pixel art.
export const IW = HURDLES[0].frames[0][0].length * PX, IH = HURDLES[0].frames[0].length * PX;
export const PW = PIN_ART[0].length * PX, PH = PIN_ART.length * PX;
export const DW = DREAM_ART[0].length * PX, DH = DREAM_ART.length * PX;
export const GX = 50, GY = 40;   // formation column and row spacing
export const SHOT_W = 3, SHOT_H = 12, BOLT_H = 12;

const ROWS = HURDLES.length, COLS = 11;
const FORMATION_SIZE = ROWS * COLS;
const SHIELD_Y = H - 190;
export const PLAYER_SPEED = 330;
export const RESPAWN_TIME = 1.4;   // seconds the pin is gone after losing a home
const SHOT_SPEED = 720, LIVES = 3, MAX_PARTICLES = 2000;

// The whole game state. The renderer and the status mirror read it; only this module writes it.
// state: 'title' | 'play' | 'dead' (respawning) | 'clear' (wave banner) | 'over'
// settings: the player's sound choices, loaded by main.js (applySettings) and flipped by M.
export const g = {
  state: 'title', paused: false, t: 0, settings: { sound: true, music: true },
  score: 0, best: loadBest(), newBest: false, lives: LIVES, level: 0,
  player: { x: W / 2 - PW / 2, y: H - 80 },
  shot: null, bolts: [], particles: [], texts: [], shields: [], invaders: [],
  formation: { x: 0, y: 0, dir: 1, timer: 0, frame: 0 },
  dream: null, dreamTimer: 0, fireTimer: 0, respawn: 0, banner: 0, overT: 0, overReason: '',
};

// Moments the sound system reacts to. The rules publish them here; main.js takes them once per frame.
const outbox = [];
const emit = (type, detail) => outbox.push({ type, t: g.t, ...detail });
export const takeEvents = () => outbox.splice(0);

// The only way settings get in from outside: main.js applies what it loaded before the first frame.
export function applySettings({ sound, music }) {
  g.settings = { sound, music };
}

export const invaderX = v => g.formation.x + v.c * GX;
export const houseCentreX = i => W / 4 * (i + 0.5);   // four houses, i = 0..3 from the left
export const invaderY = v => g.formation.y + v.r * GY;
const overlap = (ax, ay, aw, ah, bx, by, bw, bh) => ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const isPausable = () => ['play', 'dead', 'clear'].includes(g.state);

// One-shot keys, handled once per frame.
export function handlePresses(pressed) {
  if (g.state === 'title' && (pressed.has('Enter') || pressed.has('Space'))) startGame();
  else if (g.state === 'over' && g.overT > 0.6 && pressed.has('Enter')) startGame();
  else if (isPausable() && (pressed.has('KeyP') || pressed.has('Escape'))) setPaused(!g.paused);
  if (pressed.has('KeyM')) toggleSound();   // on every screen, and never touches the game itself
}

function toggleSound() {
  g.settings.sound = !g.settings.sound;
  emit(GameEvent.SOUND_TOGGLED, { on: g.settings.sound });
}

export function pause() {
  if (isPausable()) setPaused(true);
}

// Publishes the change only when there is one, so the sound system never hears a pause twice.
function setPaused(paused) {
  if (g.paused === paused) return;
  g.paused = paused;
  emit(paused ? GameEvent.PAUSED : GameEvent.RESUMED);
}

function startGame() {
  g.score = 0; g.lives = LIVES; g.newBest = false;
  startWave(0);
  emit(GameEvent.GAME_STARTED);
}

function startWave(level) {
  g.level = level;
  g.invaders = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) g.invaders.push({ r, c, type: r, alive: true });
  g.formation = { x: (W - ((COLS - 1) * GX + IW)) / 2, y: 120 + Math.min(level, 4) * 18, dir: 1, timer: 0.6, frame: 0 };
  g.shields = [0, 1, 2, 3].map(i => makeShield(Math.round(houseCentreX(i) - SW * PX / 2), SHIELD_Y));
  g.player.x = W / 2 - PW / 2;
  g.shot = null; g.bolts = []; g.dream = null;
  g.dreamTimer = 12 + Math.random() * 10; g.fireTimer = 1;
  g.state = 'play';
}

// Advance the game by one fixed step of dt seconds.
export function update(dt, keyboard) {
  g.t += dt;
  updateParticles(dt);
  switch (g.state) {
    case 'title': return;
    case 'over': g.overT += dt; return;
    case 'clear':
      g.banner -= dt;
      moveShot(dt); moveBolts(dt);
      if (g.banner <= 0) startWave(g.level + 1);
      return;
    case 'dead':
      g.respawn -= dt;
      if (g.respawn > 0) break;
      if (g.lives === 0) return gameOver('Offer rejected');
      g.state = 'play'; g.player.x = W / 2 - PW / 2;
  }
  if (g.state === 'play') movePlayer(dt, keyboard);
  moveShot(dt);
  moveBolts(dt);
  moveDream(dt);
  if (g.state === 'play') { stepFormation(dt); enemyFire(dt); }
}

function movePlayer(dt, keyboard) {
  const right = keyboard.isDown('ArrowRight') || keyboard.isDown('KeyD');
  const left = keyboard.isDown('ArrowLeft') || keyboard.isDown('KeyA');
  g.player.x = clamp(g.player.x + (right - left) * PLAYER_SPEED * dt, 16, W - 16 - PW);
  if (keyboard.isDown('Space') && !g.shot) {
    g.shot = { x: g.player.x + PW / 2 - SHOT_W / 2, y: g.player.y - 10 };
    emit(GameEvent.SHOT_FIRED);
  }
}

function formationInfo() {
  let minC = COLS, maxC = -1, maxR = -1, alive = 0;
  for (const v of g.invaders) if (v.alive) {
    alive++;
    minC = Math.min(minC, v.c); maxC = Math.max(maxC, v.c); maxR = Math.max(maxR, v.r);
  }
  return { minC, maxC, maxR, alive };
}

// Seconds between formation steps: shorter as hurdles fall, and shorter again with each wave.
export const formationStepInterval = (hurdlesLeft, level) => (0.03 + 0.5 * hurdlesLeft / FORMATION_SIZE) / (1 + level * 0.12);

// The formation moves in steps that get quicker as it thins out, dropping a row at each edge.
function stepFormation(dt) {
  const f = g.formation;
  f.timer -= dt;
  if (f.timer > 0) return;
  const { minC, maxC, maxR, alive } = formationInfo();
  if (!alive) return;
  f.timer = formationStepInterval(alive, g.level);
  f.frame ^= 1;
  const nx = f.x + f.dir * 9;
  if (nx + minC * GX < 16 || nx + maxC * GX + IW > W - 16) { f.y += 18; f.dir = -f.dir; } else f.x = nx;
  emit(GameEvent.FORMATION_STEPPED, { alive });
  if (f.y + maxR * GY + IH >= SHIELD_Y) {
    for (const v of g.invaders) if (v.alive) clearRect(g.shields, invaderX(v), invaderY(v), IW, IH);
  }
  if (f.y + maxR * GY + IH >= g.player.y) gameOver('Gazumped!');
}

function enemyFire(dt) {
  g.fireTimer -= dt;
  if (g.fireTimer > 0 || g.bolts.length >= Math.min(3 + g.level, 7)) return;
  g.fireTimer = Math.max(0.3, 1.0 - g.level * 0.12) * (0.5 + Math.random());
  const bottom = [];   // lowest living invader in each column
  for (const v of g.invaders) if (v.alive && (!bottom[v.c] || v.r > bottom[v.c].r)) bottom[v.c] = v;
  const shooters = bottom.filter(Boolean);
  if (!shooters.length) return;
  let v = shooters[(Math.random() * shooters.length) | 0];
  if (Math.random() < 0.4) {   // sometimes aim at the player
    const px = g.player.x + PW / 2;
    v = shooters.reduce((a, b) => Math.abs(invaderX(b) - px) < Math.abs(invaderX(a) - px) ? b : a);
  }
  g.bolts.push({ x: invaderX(v) + IW / 2 - 1.5, y: invaderY(v) + IH, vy: 240 + g.level * 20, color: HURDLES[v.type].color });
}

function moveShot(dt) {
  const s = g.shot;
  if (!s) return;
  const y0 = s.y;
  s.y -= SHOT_SPEED * dt;
  const hit = sweep(g.shields, s.x + 1, y0, s.y);
  if (hit) { const p = erode(hit, 2.2); burst(p.x, p.y, COLORS.brick, 6, 90); g.shot = null; return; }
  const b = g.bolts.findIndex(b => overlap(s.x, s.y, SHOT_W, SHOT_H, b.x - 2, b.y, 7, BOLT_H));
  if (b >= 0) { burst(g.bolts[b].x, g.bolts[b].y, COLORS.green, 8); g.bolts.splice(b, 1); g.shot = null; return; }
  for (const v of g.invaders) {
    if (v.alive && overlap(s.x, s.y, SHOT_W, SHOT_H, invaderX(v), invaderY(v), IW, IH)) { killInvader(v); g.shot = null; return; }
  }
  if (g.dream && overlap(s.x, s.y, SHOT_W, SHOT_H, g.dream.x, g.dream.y, DW, DH)) { saveDream(); g.shot = null; return; }
  if (s.y < 64) { burst(s.x, 64, COLORS.green, 4, 60); g.shot = null; }
}

function killInvader(v) {
  v.alive = false;
  g.score += HURDLES[v.type].value;
  emit(GameEvent.HURDLE_HIT, { value: HURDLES[v.type].value });
  burst(invaderX(v) + IW / 2, invaderY(v) + IH / 2, HURDLES[v.type].color, 14);
  if (!g.invaders.some(v => v.alive)) { g.state = 'clear'; g.banner = 2.4; g.bolts = []; g.dream = null; }
}

function saveDream() {
  const d = g.dream, bonus = DREAM_BONUSES[(Math.random() * DREAM_BONUSES.length) | 0];
  g.score += bonus;
  burst(d.x + DW / 2, d.y + DH / 2, COLORS.dream, 40, 220);
  g.texts.push({ text: 'Dream home saved +' + pounds(bonus), x: clamp(d.x + DW / 2, 150, W - 150), y: d.y + DH + 18, life: 1.8, color: COLORS.dream });
  g.dream = null; g.dreamTimer = 18 + Math.random() * 10;
}

function moveBolts(dt) {
  for (let i = g.bolts.length - 1; i >= 0; i--) {
    const b = g.bolts[i], y0 = b.y + BOLT_H;
    b.y += b.vy * dt;
    const hit = sweep(g.shields, b.x + 1, y0, b.y + BOLT_H);
    if (hit) { const p = erode(hit, 2.8); burst(p.x, p.y, COLORS.brick, 6, 90); g.bolts.splice(i, 1); continue; }
    if (g.state === 'play' && overlap(b.x, b.y, 3, BOLT_H, g.player.x + 4, g.player.y + 2, PW - 8, PH - 8)) { killPlayer(); return; }
    if (b.y + BOLT_H >= GROUND) { burst(b.x, GROUND, b.color, 5, 60); g.bolts.splice(i, 1); }
  }
}

function killPlayer() {
  g.lives--; g.state = 'dead'; g.respawn = RESPAWN_TIME; g.shot = null; g.bolts = [];
  emit(GameEvent.HOME_LOST, { livesLeft: g.lives });
  burst(g.player.x + PW / 2, g.player.y + PH / 2, COLORS.green, 50, 240);
}

function moveDream(dt) {
  if (g.state !== 'play') return;
  if (!g.dream) {
    g.dreamTimer -= dt;
    if (g.dreamTimer <= 0 && formationInfo().alive > 6) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      g.dream = { x: dir > 0 ? -DW : W, y: 66, vx: dir * 150 };
    }
    return;
  }
  g.dream.x += g.dream.vx * dt;
  if (g.dream.x < -DW - 4 || g.dream.x > W + 4) { g.dream = null; g.dreamTimer = 18 + Math.random() * 10; }
}

function gameOver(reason) {
  g.state = 'over'; g.overReason = reason; g.overT = 0;
  g.newBest = g.score > g.best;
  if (g.newBest) { g.best = g.score; saveBest(g.best); }
}

function burst(x, y, color, n, speed = 160) {
  for (let i = 0; i < n && g.particles.length < MAX_PARTICLES; i++) {
    const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random()), life = 0.4 + Math.random() * 0.4;
    g.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color });
  }
}

function updateParticles(dt) {
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
