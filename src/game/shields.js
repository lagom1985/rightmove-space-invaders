import { PX } from './config.js';

// A shield is a pair of terraced houses stored as one byte per PX x PX cell, so shots can
// chip away at it pixel by pixel. The renderer caches each one and repaints only when dirty.
export const SW = 24, SH = 18;
export const EMPTY = 0, BRICK = 1, WINDOW = 2, DOOR = 3;

export function makeShield(x, y) {
  const cells = new Uint8Array(SW * SH);
  for (let cy = 0; cy < SH; cy++) for (let cx = 0; cx < SW; cx++) {
    const lx = cx % 12;   // position within one of the two houses
    let v = cy >= 8 || Math.abs(lx - 5.5) < cy - 1 ? BRICK : EMPTY;   // walls and gable roof
    if (cy >= 1 && cy < 5 && (lx === 8 || lx === 9)) v = BRICK;       // chimney
    if (cy >= 10 && cy <= 12 && (lx === 2 || lx === 3 || lx === 8 || lx === 9)) v = WINDOW;
    if (cy >= 13 && (lx === 5 || lx === 6)) v = DOOR;
    if (cy >= 14 && cx >= 10 && cx <= 13) v = EMPTY;                  // ginnel between the houses
    cells[cy * SW + cx] = v;
  }
  return { x, y, cells, dirty: true };
}

function shieldAt(shields, px, py) {
  for (const s of shields) {
    const cx = Math.floor((px - s.x) / PX), cy = Math.floor((py - s.y) / PX);
    if (cx >= 0 && cy >= 0 && cx < SW && cy < SH && s.cells[cy * SW + cx]) return { s, cx, cy };
  }
  return null;
}

// First solid cell on the vertical path from y0 to y1, sampled every 2px so fast shots can't tunnel.
export function sweep(shields, px, y0, y1) {
  const dir = Math.sign(y1 - y0) || 1, n = Math.ceil(Math.abs(y1 - y0) / 2);
  for (let i = 0; i <= n; i++) {
    const hit = shieldAt(shields, px, i === n ? y1 : y0 + dir * i * 2);
    if (hit) return hit;
  }
  return null;
}

// Blast a ragged hole of radius r cells around a hit. Returns the hit point in screen units.
export function erode({ s, cx, cy }, r) {
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const d = Math.hypot(dx, dy), x = cx + dx, y = cy + dy;
    if (d > r || x < 0 || y < 0 || x >= SW || y >= SH) continue;
    if (d > r - 1.2 && Math.random() < 0.5) continue;
    s.cells[y * SW + x] = EMPTY;
  }
  s.dirty = true;
  return { x: s.x + cx * PX, y: s.y + cy * PX };
}

// Invaders marching through a shield wipe out whatever they overlap.
export function clearRect(shields, x, y, w, h) {
  for (const s of shields) {
    const x0 = Math.max(0, Math.floor((x - s.x) / PX)), x1 = Math.min(SW, Math.ceil((x + w - s.x) / PX));
    const y0 = Math.max(0, Math.floor((y - s.y) / PX)), y1 = Math.min(SH, Math.ceil((y + h - s.y) / PX));
    for (let cy = y0; cy < y1; cy++) for (let cx = x0; cx < x1; cx++) {
      if (s.cells[cy * SW + cx]) { s.cells[cy * SW + cx] = EMPTY; s.dirty = true; }
    }
  }
}
