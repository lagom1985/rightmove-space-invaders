import { W, H, PX, GROUND } from '../game/config.js';
import { COLORS, HURDLES, PIN_ART, DREAM_ART, ladderName, pounds } from '../theme/theme.js';
import { SW, SH, BRICK, WINDOW } from '../game/shields.js';
import { g, invaderX, invaderY, IW, SHOT_W, SHOT_H } from '../game/game.js';

const FONT = '"Press Start 2P", ui-monospace, monospace';
const OFF_LABELS = { sound: 'Sound off', music: 'Music off' };   // HUD indicators, stacked upwards from the bottom right

// Pixel art -> a tiny canvas at one canvas pixel per art pixel, scaled up when drawn.
function sprite(rows, color) {
  const c = document.createElement('canvas');
  c.width = rows[0].length; c.height = rows.length;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === 'X') ctx.fillRect(x, y, 1, 1); });
  return c;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const hurdleSprites = HURDLES.map(h => h.frames.map(f => sprite(f, h.color)));
  const pin = sprite(PIN_ART, COLORS.green), dream = sprite(DREAM_ART, COLORS.dream);
  const shieldCanvases = new WeakMap();
  let background;

  // Size the backing store to the window at device resolution and keep drawing in logical units.
  function resize() {
    const footer = document.querySelector('.site-footer')?.offsetHeight ?? 0;   // the canvas fits above the footer
    const dpr = devicePixelRatio || 1, scale = Math.min(innerWidth / W, (innerHeight - footer) / H);
    const cssW = Math.floor(W * scale), cssH = Math.floor(H * scale);
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    const k = canvas.width / W;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.imageSmoothingEnabled = false;
    background = drawBackground(k);
  }

  // A faint "map search" backdrop: block grid, roads and a river. Drawn once per resize.
  function drawBackground(k) {
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const b = c.getContext('2d');
    b.setTransform(k, 0, 0, k, 0, 0);
    b.fillStyle = COLORS.bg; b.fillRect(0, 0, W, H);
    b.strokeStyle = COLORS.grid; b.lineWidth = 1;
    for (let x = 0; x <= W; x += 48) { b.beginPath(); b.moveTo(x + 0.5, 0); b.lineTo(x + 0.5, H); b.stroke(); }
    for (let y = 0; y <= H; y += 48) { b.beginPath(); b.moveTo(0, y + 0.5); b.lineTo(W, y + 0.5); b.stroke(); }
    b.strokeStyle = COLORS.road; b.lineWidth = 6;
    for (const [x0, y0, x1, y1] of [[0, 180, 960, 260], [300, 0, 220, 720], [700, 0, 760, 720], [0, 600, 960, 560]]) {
      b.beginPath(); b.moveTo(x0, y0); b.lineTo(x1, y1); b.stroke();
    }
    b.strokeStyle = COLORS.river; b.lineWidth = 18;
    b.beginPath(); b.moveTo(-20, 420); b.bezierCurveTo(240, 340, 520, 520, 980, 380); b.stroke();
    b.fillStyle = COLORS.green; b.fillRect(0, GROUND, W, 2);
    return c;
  }

  function shieldCanvas(s) {
    let c = shieldCanvases.get(s);
    if (!c) { c = document.createElement('canvas'); c.width = SW; c.height = SH; shieldCanvases.set(s, c); }
    if (s.dirty) {
      const sc = c.getContext('2d');
      sc.clearRect(0, 0, SW, SH);
      for (let i = 0; i < s.cells.length; i++) {
        const v = s.cells[i];
        if (!v) continue;
        sc.fillStyle = v === BRICK ? COLORS.brick : v === WINDOW ? COLORS.window : COLORS.door;
        sc.fillRect(i % SW, (i / SW) | 0, 1, 1);
      }
      s.dirty = false;
    }
    return c;
  }

  function blit(s, x, y, scale = PX) { ctx.drawImage(s, Math.round(x), Math.round(y), s.width * scale, s.height * scale); }
  function text(s, x, y, size, color, align = 'left') {
    ctx.font = `${size}px ${FONT}`;
    ctx.fillStyle = color; ctx.textAlign = align;
    ctx.fillText(s.toUpperCase(), x, y);
  }
  const blink = () => (g.t * 2 | 0) % 2 === 0;

  function draw() {
    ctx.drawImage(background, 0, 0, W, H);
    if (g.state === 'title') { drawTitle(); drawHud(); return; }

    for (const s of g.shields) ctx.drawImage(shieldCanvas(s), s.x, s.y, SW * PX, SH * PX);
    for (const v of g.invaders) if (v.alive) blit(hurdleSprites[v.type][g.formation.frame], invaderX(v), invaderY(v));
    if (g.dream) blit(dream, g.dream.x, g.dream.y);
    if (g.state !== 'dead' && !(g.state === 'over' && g.lives === 0)) blit(pin, g.player.x, g.player.y);
    if (g.shot) { ctx.fillStyle = COLORS.green; ctx.fillRect(g.shot.x, g.shot.y, SHOT_W, SHOT_H); }
    const zig = (g.t * 16 | 0) % 2 ? 2 : -2;
    for (const b of g.bolts) {
      ctx.fillStyle = b.color;
      for (let i = 0; i < 4; i++) ctx.fillRect(b.x + (i % 2 ? zig : 0), b.y + i * 3, 3, 3);
    }
    for (const p of g.particles) { ctx.globalAlpha = p.life / p.max; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 3, 3); }
    for (const m of g.texts) { ctx.globalAlpha = Math.min(1, m.life); text(m.text, m.x, m.y, 8, m.color, 'center'); }
    ctx.globalAlpha = 1;
    for (let i = 0; i < g.lives; i++) blit(pin, 24 + i * 34, H - 28, 2);
    drawHud();

    if (g.state === 'clear') {
      text('Wave cleared!', W / 2, 300, 24, COLORS.green, 'center');
      text('Moving up the ladder to', W / 2, 345, 8, COLORS.dim, 'center');
      text(ladderName(g.level + 1), W / 2, 385, 24, COLORS.text, 'center');
    }
    if (g.state === 'over') drawGameOver();
    if (g.paused) {
      ctx.fillStyle = 'rgba(20,20,32,0.6)'; ctx.fillRect(0, 0, W, H);
      text('Paused', W / 2, 340, 40, COLORS.text, 'center');
      text('Press P to resume', W / 2, 390, 16, COLORS.dim, 'center');
    }
  }

  function drawHud() {
    text('Deposit saved', 24, 28, 8, COLORS.dim); text(pounds(g.score), 24, 52, 16, COLORS.text);
    text('Property ladder', W / 2, 28, 8, COLORS.dim, 'center'); text(ladderName(g.level), W / 2, 52, 16, COLORS.green, 'center');
    text('Best', W - 24, 28, 8, COLORS.dim, 'right'); text(pounds(Math.max(g.best, g.score)), W - 24, 52, 16, COLORS.text, 'right');
    const switchedOff = Object.keys(OFF_LABELS).filter(name => !g.settings[name]);
    switchedOff.forEach((name, i) => text(OFF_LABELS[name], W - 24, H - 14 - i * 16, 8, COLORS.dim, 'right'));
  }

  function drawTitle() {
    text('Make the', W / 2, 150, 16, COLORS.text, 'center');
    text('Right Move', W / 2, 205, 40, COLORS.green, 'center');
    text('Defend your dream home from the hurdles', W / 2, 250, 8, COLORS.dim, 'center');
    HURDLES.forEach((h, i) => {
      const y = 290 + i * 44;
      blit(hurdleSprites[i][(g.t * 2 | 0) % 2], 290, y);
      text(h.name, 350, y + 20, 16, h.color);
      text(pounds(h.value), 670, y + 20, 16, COLORS.text, 'right');
    });
    blit(dream, 290 + IW / 2 - dream.width * PX / 2, 508);
    text('Dream home', 350, 536, 16, COLORS.dream); text('£???', 670, 536, 16, COLORS.text, 'right');
    if (blink()) text('Press Enter to start', W / 2, 620, 16, COLORS.green, 'center');
    text('Arrows / A D  move     Space  fire     P  pause     M  sound     N  music', W / 2, 660, 8, COLORS.dim, 'center');
  }

  function drawGameOver() {
    ctx.fillStyle = 'rgba(20,20,32,0.78)'; ctx.fillRect(0, 0, W, H);
    text(g.overReason, W / 2, 260, 40, COLORS.danger, 'center');
    text('Deposit saved  ' + pounds(g.score), W / 2, 330, 16, COLORS.text, 'center');
    text('Reached  ' + ladderName(g.level), W / 2, 370, 16, COLORS.green, 'center');
    if (g.newBest) text('New best!', W / 2, 420, 16, COLORS.dream, 'center');
    if (g.overT > 0.6 && blink()) text('Press Enter to house-hunt again', W / 2, 500, 16, COLORS.green, 'center');
  }

  return { resize, draw };
}
