import { W, H, PX, GROUND } from '../game/config.js';
import { COLORS, HURDLES, PIN_ART, DREAM_ART, ladderName, pounds } from '../theme/theme.js';
import { SW, SH, BRICK, WINDOW } from '../game/shields.js';
import { g, invaderX, invaderY, IW, SHOT_W, SHOT_H } from '../game/game.js';

const FONT = '"Press Start 2P", ui-monospace, monospace';
const OFF_LABELS = { sound: 'Sound off', music: 'Music off' };   // HUD indicators, stacked upwards from the bottom right
const MAP_BLOCK = 48;   // side of one block of the backdrop's grid
const ROADS = [[0, 180, 960, 260], [300, 0, 220, 720], [700, 0, 760, 720], [0, 600, 960, 560]];   // [x0, y0, x1, y1]
const ATTRACT_SECONDS = 5;   // the title screen takes turns showing the hurdles and the high-score table
const ROW_GAP = 26;          // between rows of the high-score table
// Game over: the classic screen, or a compact one when the initials or the high-score table need the room below.
const OVER_LAYOUTS = { classic: { top: 260, again: 500 }, compact: { top: 130, again: 640 } };

// Pixel art -> a tiny canvas at one canvas pixel per art pixel, scaled up when drawn.
function sprite(rows, color) {
  const c = document.createElement('canvas');
  c.width = rows[0].length; c.height = rows.length;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === 'X') ctx.fillRect(x, y, 1, 1); });
  return c;
}

// Each house is cached on a tiny canvas of its own and repainted only after it has been chipped (dirty).
function createShieldCache() {
  const canvases = new WeakMap();
  return function shieldCanvas(s) {
    let c = canvases.get(s);
    if (!c) { c = document.createElement('canvas'); c.width = SW; c.height = SH; canvases.set(s, c); }
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
  };
}

// A faint "map search" backdrop: block grid, roads and a river. Drawn once per resize, on a canvas of its own.
function drawBackground(canvas, k) {
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  const b = c.getContext('2d');
  b.setTransform(k, 0, 0, k, 0, 0);
  b.fillStyle = COLORS.bg; b.fillRect(0, 0, W, H);
  drawMapGrid(b);
  drawRoads(b);
  drawRiver(b);
  b.fillStyle = COLORS.green; b.fillRect(0, GROUND, W, 2);
  return c;
}

function drawMapGrid(b) {
  b.strokeStyle = COLORS.grid; b.lineWidth = 1;
  for (let x = 0; x <= W; x += MAP_BLOCK) { b.beginPath(); b.moveTo(x + 0.5, 0); b.lineTo(x + 0.5, H); b.stroke(); }
  for (let y = 0; y <= H; y += MAP_BLOCK) { b.beginPath(); b.moveTo(0, y + 0.5); b.lineTo(W, y + 0.5); b.stroke(); }
}

function drawRoads(b) {
  b.strokeStyle = COLORS.road; b.lineWidth = 6;
  for (const [x0, y0, x1, y1] of ROADS) { b.beginPath(); b.moveTo(x0, y0); b.lineTo(x1, y1); b.stroke(); }
}

function drawRiver(b) {
  b.strokeStyle = COLORS.river; b.lineWidth = 18;
  b.beginPath(); b.moveTo(-20, 420); b.bezierCurveTo(240, 340, 520, 520, 980, 380); b.stroke();
}

function blit(ctx, s, x, y, scale = PX) { ctx.drawImage(s, Math.round(x), Math.round(y), s.width * scale, s.height * scale); }

function text(ctx, s, x, y, size, color, align = 'left') {
  ctx.font = `${size}px ${FONT}`;
  ctx.fillStyle = color; ctx.textAlign = align;
  ctx.fillText(s.toUpperCase(), x, y);
}

const blink = () => (g.t * 2 | 0) % 2 === 0;

function drawShields(ctx, shieldCanvas) {
  for (const s of g.shields) ctx.drawImage(shieldCanvas(s), s.x, s.y, SW * PX, SH * PX);
}

function drawFormation(ctx, sprites) {
  for (const v of g.invaders) if (v.alive) blit(ctx, sprites.hurdles[v.type][g.formation.frame], invaderX(v), invaderY(v));
}

function drawDreamHome(ctx, sprites) {
  if (g.dream) blit(ctx, sprites.dream, g.dream.x, g.dream.y);
}

function drawPlayer(ctx, sprites) {
  if (g.state !== 'dead' && !(g.state === 'over' && g.lives === 0)) blit(ctx, sprites.pin, g.player.x, g.player.y);
}

function drawShot(ctx) {
  if (g.shot) { ctx.fillStyle = COLORS.green; ctx.fillRect(g.shot.x, g.shot.y, SHOT_W, SHOT_H); }
}

// A bolt is four dashes that zig-zag from side to side.
function drawBolts(ctx) {
  const zig = (g.t * 16 | 0) % 2 ? 2 : -2;
  for (const b of g.bolts) {
    ctx.fillStyle = b.color;
    for (let i = 0; i < 4; i++) ctx.fillRect(b.x + (i % 2 ? zig : 0), b.y + i * 3, 3, 3);
  }
}

function drawParticles(ctx) {
  for (const p of g.particles) { ctx.globalAlpha = p.life / p.max; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 3, 3); }
}

function drawFloatingTexts(ctx) {
  for (const m of g.texts) { ctx.globalAlpha = Math.min(1, m.life); text(ctx, m.text, m.x, m.y, 8, m.color, 'center'); }
}

// One small pin per life left.
function drawLives(ctx, sprites) {
  for (let i = 0; i < g.lives; i++) blit(ctx, sprites.pin, 24 + i * 34, H - 28, 2);
}

function drawHud(ctx) {
  text(ctx, 'Deposit saved', 24, 28, 8, COLORS.dim); text(ctx, pounds(g.score), 24, 52, 16, COLORS.text);
  text(ctx, 'Property ladder', W / 2, 28, 8, COLORS.dim, 'center'); text(ctx, ladderName(g.level), W / 2, 52, 16, COLORS.green, 'center');
  text(ctx, 'Best', W - 24, 28, 8, COLORS.dim, 'right'); text(ctx, pounds(Math.max(g.best, g.score)), W - 24, 52, 16, COLORS.text, 'right');
  const switchedOff = Object.keys(OFF_LABELS).filter(name => !g.settings[name]);
  switchedOff.forEach((name, i) => text(ctx, OFF_LABELS[name], W - 24, H - 14 - i * 16, 8, COLORS.dim, 'right'));
}

const hasHighScores = () => g.table.status === 'available' && g.table.rows.length > 0;

// Arcade attract mode: while the table is available and has rows, every few seconds it takes the hurdles' place.
const attractShowsTable = () => hasHighScores() && (g.t / ATTRACT_SECONDS | 0) % 2 === 1;

function drawTitle(ctx, sprites) {
  text(ctx, 'Make the', W / 2, 150, 16, COLORS.text, 'center');
  text(ctx, 'Right Move', W / 2, 205, 40, COLORS.green, 'center');
  text(ctx, 'Defend your dream home from the hurdles', W / 2, 250, 8, COLORS.dim, 'center');
  if (attractShowsTable()) drawHighScores(ctx, 300); else drawHurdleLegend(ctx, sprites);
  if (blink()) text(ctx, 'Press Enter to start', W / 2, 620, 16, COLORS.green, 'center');
  text(ctx, 'Arrows / A D  move     Space  fire     P  pause     M  sound     N  music', W / 2, 660, 8, COLORS.dim, 'center');
}

function drawHurdleLegend(ctx, sprites) {
  HURDLES.forEach((h, i) => {
    const y = 290 + i * 44;
    blit(ctx, sprites.hurdles[i][(g.t * 2 | 0) % 2], 290, y);
    text(ctx, h.name, 350, y + 20, 16, h.color);
    text(ctx, pounds(h.value), 670, y + 20, 16, COLORS.text, 'right');
  });
  blit(ctx, sprites.dream, 290 + IW / 2 - sprites.dream.width * PX / 2, 508);
  text(ctx, 'Dream home', 350, 536, 16, COLORS.dream); text(ctx, '£???', 670, 536, 16, COLORS.text, 'right');
}

// Rank, initials and deposit, a row each. The confirmed current signing's row is picked out in green, in any later game
// too (its id is set once it is confirmed).
function drawHighScores(ctx, y) {
  text(ctx, 'High scores', W / 2, y, 16, COLORS.green, 'center');
  const mine = g.signing?.id ?? null;
  g.table.rows.forEach((row, i) => {
    const rowY = y + 40 + i * ROW_GAP, color = row.id === mine ? COLORS.green : COLORS.text;
    text(ctx, `${i + 1}.`, 350, rowY, 16, COLORS.dim, 'right');
    text(ctx, row.initials, 380, rowY, 16, color);
    text(ctx, pounds(row.score), 620, rowY, 16, color, 'right');
  });
}

// The three letters, the one being chosen blinking, like on an arcade cabinet. Initials on the word filter are refused
// in red under the help line until the next key (DISTILL, Messages).
function drawInitialsEntry(ctx, y) {
  const { letters, index, refused } = g.initials;
  text(ctx, 'New high score!', W / 2, y, 24, COLORS.green, 'center');
  letters.forEach((letter, i) => {
    if (i !== index || blink()) text(ctx, letter, W / 2 + (i - 1) * 64, y + 80, 40, i === index ? COLORS.green : COLORS.text, 'center');
  });
  text(ctx, 'Up / Down  change the letter     Enter  take it', W / 2, y + 130, 8, COLORS.dim, 'center');
  if (refused) text(ctx, 'Those initials aren\'t allowed. Change a letter.', W / 2, y + 160, 8, COLORS.danger, 'center');
}

// What became of the signing made at this game over (DISTILL, Messages); an earlier one shows only as its green row.
const SIGNING_LINES = {
  pending: ({ initials }) => [`Signing ${initials}…`, COLORS.dim],
  confirmed: ({ initials, rank }) => [`Signed ${initials}, #${rank}.`, COLORS.green],
  'off-table': ({ initials }) => [`The table filled up before ${initials} arrived.`, COLORS.text],
  unconfirmed: ({ initials }) => [`Couldn't confirm ${initials}'s signing.`, COLORS.danger],
};

function drawSigning(ctx, y) {
  const [line, color] = SIGNING_LINES[g.signing.status](g.signing);
  text(ctx, line, W / 2, y, 8, color, 'center');
}

function drawWaveCleared(ctx) {
  text(ctx, 'Wave cleared!', W / 2, 300, 24, COLORS.green, 'center');
  text(ctx, 'Moving up the ladder to', W / 2, 345, 8, COLORS.dim, 'center');
  text(ctx, ladderName(g.level + 1), W / 2, 385, 24, COLORS.text, 'center');
}

function drawGameOver(ctx) {
  ctx.fillStyle = 'rgba(20,20,32,0.78)'; ctx.fillRect(0, 0, W, H);
  const { top, again } = OVER_LAYOUTS[g.initials || hasHighScores() ? 'compact' : 'classic'];
  text(ctx, g.overReason, W / 2, top, 40, COLORS.danger, 'center');
  text(ctx, 'Deposit saved  ' + pounds(g.score), W / 2, top + 70, 16, COLORS.text, 'center');
  text(ctx, 'Reached  ' + ladderName(g.level), W / 2, top + 110, 16, COLORS.green, 'center');
  if (g.newBest) text(ctx, 'New best!', W / 2, top + 160, 16, COLORS.dream, 'center');
  if (g.initials) { drawInitialsEntry(ctx, top + 230); return; }   // Enter takes a letter until all three are in
  if (g.signedThisGame) drawSigning(ctx, top + 182);   // between "New best!" and the list
  if (hasHighScores()) drawHighScores(ctx, top + 200);
  // Only a table that can't be reached is mentioned; while it is unknown, nothing is (DISTILL, Messages).
  if (g.table.status === 'unavailable') text(ctx, 'High-score table unavailable.', W / 2, top + 200, 8, COLORS.dim, 'center');
  if (g.overT > 0.6 && blink()) text(ctx, 'Press Enter to house-hunt again', W / 2, again, 16, COLORS.green, 'center');
}

function drawPaused(ctx) {
  ctx.fillStyle = 'rgba(20,20,32,0.6)'; ctx.fillRect(0, 0, W, H);
  text(ctx, 'Paused', W / 2, 340, 40, COLORS.text, 'center');
  text(ctx, 'Press P to resume', W / 2, 390, 16, COLORS.dim, 'center');
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const sprites = {
    hurdles: HURDLES.map(h => h.frames.map(f => sprite(f, h.color))),
    pin: sprite(PIN_ART, COLORS.green), dream: sprite(DREAM_ART, COLORS.dream),
  };
  const shieldCanvas = createShieldCache();
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
    background = drawBackground(canvas, k);
  }

  function draw() {
    ctx.drawImage(background, 0, 0, W, H);
    if (g.state === 'title') { drawTitle(ctx, sprites); drawHud(ctx); return; }

    drawShields(ctx, shieldCanvas);
    drawFormation(ctx, sprites);
    drawDreamHome(ctx, sprites);
    drawPlayer(ctx, sprites);
    drawShot(ctx);
    drawBolts(ctx);
    drawParticles(ctx);
    drawFloatingTexts(ctx);
    ctx.globalAlpha = 1;   // particles and floating texts fade by alpha: everything after draws solid
    drawLives(ctx, sprites);
    drawHud(ctx);

    if (g.state === 'clear') drawWaveCleared(ctx);
    if (g.state === 'over') drawGameOver(ctx);
    if (g.paused) drawPaused(ctx);
  }

  return { resize, draw };
}
