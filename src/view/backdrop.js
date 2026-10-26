import { W, H, GROUND, BANNER_TIME } from '../game/config.js';
import { COLORS, NEIGHBOURHOODS, neighbourhood } from '../theme/theme.js';

// Each rung's backdrop: its neighbourhood from above, faint, like a property search map, with a skyline of its homes on
// the ground line, all in the neighbourhood's palette (src/theme/theme.js). The recipes below take the drawing context b,
// the palette p and the rung's random generator r.

const SEED = 1000;   // + the rung

// mulberry32. A backdrop never calls Math.random: it comes out the same every time it is built, and the game's own
// random sequence is left alone.
const rng = seed => () => {
  seed = seed + 0x6d2b79f5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

const line = (b, color, w, points) => {
  b.strokeStyle = color; b.lineWidth = w;
  b.beginPath(); b.moveTo(...points[0]); for (const pt of points.slice(1)) b.lineTo(...pt); b.stroke();
};
const curve = (b, color, w, x0, y0, c1x, c1y, c2x, c2y, x1, y1) => {
  b.strokeStyle = color; b.lineWidth = w;
  b.beginPath(); b.moveTo(x0, y0); b.bezierCurveTo(c1x, c1y, c2x, c2y, x1, y1); b.stroke();
};
const polygon = (b, color, points) => {
  b.fillStyle = color;
  b.beginPath(); b.moveTo(...points[0]); for (const pt of points.slice(1)) b.lineTo(...pt); b.closePath(); b.fill();
};
const rect = (b, color, x, y, w, h) => { b.fillStyle = color; b.fillRect(x, y, w, h); };
const disc = (b, color, x, y, r) => { b.fillStyle = color; b.beginPath(); b.arc(x, y, r, 0, Math.PI * 2); b.fill(); };
const oval = (b, color, x, y, rx, ry, turn) => { b.fillStyle = color; b.beginPath(); b.ellipse(x, y, rx, ry, turn, 0, Math.PI * 2); b.fill(); };

// A road winding across the map: y0 its middle, a how far it swings, l how long its bends are, ph where they start.
const wave = (x, y0, a, l, ph) => y0 + a * Math.sin(x / l + ph);
function windingRoad(b, color, w, bends) {
  const points = [];
  for (let x = -10; x <= W + 10; x += 10) points.push([x, wave(x, ...bends)]);
  line(b, color, w, points);
}

// Neighbourhood maps, top-down.
const MAPS = {
  // Dense blocks, a ring road, the river and a dashed tube line with its stations.
  city: (b, p, r) => {
    for (let x = 0; x < W; x += 40) for (let y = 0; y < H; y += 40) {
      const n = 1 + (r() * 3 | 0);
      for (let i = 0; i < n; i++) rect(b, p.block, x + 5 + i * (30 / n), y + 5, 30 / n - 2, 30 - (r() * 8 | 0));
    }
    b.strokeStyle = p.road; b.lineWidth = 6; b.beginPath(); b.ellipse(480, 330, 330, 210, 0, 0, Math.PI * 2); b.stroke();
    line(b, p.road, 6, [[0, 120], [960, 520]]); line(b, p.road, 6, [[220, 0], [700, 720]]);
    curve(b, p.water, 22, -20, 460, 260, 360, 560, 560, 980, 420);
    b.setLineDash([10, 6]); line(b, p.accent, 4, [[80, 0], [80, 240], [400, 240], [400, 470], [960, 470]]); b.setLineDash([]);
    for (const [x, y] of [[80, 240], [400, 240], [400, 470], [720, 470]]) disc(b, p.light, x, y, 6);
  },
  // Long parallel streets lined with narrow plots, back alleys, cross streets, a park and a railway cutting across.
  terraces: (b, p) => {
    for (let y = 30; y < H; y += 60) {
      line(b, p.road, 5, [[0, y], [W, y]]);
      for (let x = 2; x < W; x += 12) { rect(b, p.block, x, y + 6, 10, 18); rect(b, p.block, x, y - 24, 10, 18); }
      line(b, p.grid, 2, [[0, y + 30], [W, y + 30]]);
    }
    for (let x = 0; x < W; x += 240) line(b, p.road, 5, [[x + 120, 0], [x + 120, H]]);
    rect(b, p.park, 600, 340, 120, 100);
    line(b, p.accent, 5, [[0, 690], [960, 60]]);
    for (let t = 0; t <= 1; t += 0.02) { const x = t * 960, y = 690 - t * 630; line(b, p.accent, 2, [[x - 5, y - 8], [x + 5, y + 8]]); }
  },
  // Curving roads lined with pairs of houses, the odd cul-de-sac, and a park.
  suburbs: (b, p, r) => {
    for (const bends of [[110, 30, 120, 0], [290, 40, 150, 1], [470, 35, 110, 2]]) {
      windingRoad(b, p.road, 6, bends);
      for (let x = 20; x < W; x += 70) {
        const y = wave(x, ...bends);
        for (const side of [-1, 1]) { rect(b, p.block, x - 12, y + side * 22 - 7, 11, 14); rect(b, p.block, x, y + side * 22 - 7, 11, 14); }
        if (r() < 0.35) {   // a cul-de-sac, up or down from the road
          const end = y + (r() < 0.5 ? -1 : 1) * 60;
          line(b, p.road, 5, [[x + 35, y], [x + 35, end]]); disc(b, p.road, x + 35, end, 11);
        }
      }
    }
    rect(b, p.park, 60, 560, 220, 110);
  },
  // Winding roads, big plots with a garden and trees round each house, and a park with a pond.
  leafy: (b, p, r) => {
    for (const bends of [[150, 60, 180, 0.5], [420, 70, 200, 2.5]]) {
      windingRoad(b, p.road, 6, bends);
      for (let x = 40; x < W; x += 110) for (const side of [-1, 1]) {
        const y = wave(x, ...bends) + side * 46;
        rect(b, p.park, x - 26, y - 22, 52, 44); rect(b, p.block, x - 10, y - 10, 20, 18);
        for (let i = 0; i < 3; i++) disc(b, p.grid, x - 20 + r() * 40, y - 16 + r() * 32, 4);
      }
    }
    oval(b, p.park, 700, 600, 200, 80, 0.1);
    oval(b, p.water, 720, 600, 70, 28, 0.2);
  },
  // Fields edged with dotted hedgerows, woods, a winding lane, a long drive up to the big house, and a lake.
  country: (b, p, r) => {
    const cols = 8, rows = 6, corners = [];   // the fields' corners: a grid, each nudged off it except at the map's edges
    const nudge = (i, n, spread) => (i % n ? (r() - 0.5) * spread : 0);
    for (let j = 0; j <= rows; j++) {
      corners.push([]);
      for (let i = 0; i <= cols; i++) corners[j].push([i * W / cols + nudge(i, cols, 60), j * H / rows + nudge(j, rows, 50)]);
    }
    const tints = [p.bg, p.block, p.park, p.grid];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      polygon(b, tints[r() * tints.length | 0], [corners[j][i], corners[j][i + 1], corners[j + 1][i + 1], corners[j + 1][i]]);
      b.setLineDash([3, 4]); b.strokeStyle = p.road; b.lineWidth = 2; b.stroke(); b.setLineDash([]);   // round the field just filled
    }
    for (let wood = 0; wood < 4; wood++) {
      const x = r() * W, y = r() * H * 0.7;
      for (let i = 0; i < 14; i++) disc(b, p.park, x + (r() - 0.5) * 90, y + (r() - 0.5) * 60, 7);
    }
    curve(b, p.road, 5, -10, 520, 300, 300, 600, 700, 970, 240);
    line(b, p.road, 4, [[600, 470], [600, 250]]);
    rect(b, p.light, 560, 200, 80, 34); rect(b, p.light, 560, 234, 24, 30);
    oval(b, p.water, 770, 300, 80, 34, -0.3);
  },
  // Streets on the land, the sea below a cliff edge and round a bay, the waves, a pier and a cliff path.
  coast: (b, p, r) => {
    for (let x = 0; x < 620; x += 80) for (let y = 0; y < H; y += 70) rect(b, (x + y) % 3 ? p.block : p.park, x + 4, y + 4, 72, 62);
    b.fillStyle = p.water; b.beginPath();   // the sea beyond the cliff edge
    b.moveTo(520, 0); b.bezierCurveTo(620, 200, 520, 380, 960, 560); b.lineTo(960, 0); b.closePath(); b.fill();
    curve(b, p.light, 12, 520, 0, 620, 200, 520, 380, 960, 560);
    b.fillStyle = p.water; b.beginPath();   // and the bay
    b.moveTo(400, 720); b.bezierCurveTo(600, 640, 760, 620, 960, 600); b.lineTo(960, 720); b.closePath(); b.fill();
    for (let i = 0; i < 40; i++) { const x = 620 + r() * 330, y = r() * 540; if (y < x - 520) line(b, p.grid, 2, [[x, y], [x + 14, y]]); }
    line(b, p.road, 5, [[0, 300], [560, 300]]); line(b, p.road, 4, [[300, 0], [300, 720]]);
    line(b, p.accent, 6, [[575, 300], [700, 300]]);
    b.setLineDash([4, 5]); curve(b, p.road, 3, 470, 0, 560, 220, 470, 380, 900, 590); b.setLineDash([]);
  },
};

// Skylines: the rung's homes side on, standing on the ground line in the palette's sky colour, a few windows lit.
const SKYLINES = {
  // Tower blocks.
  city: (b, p, r) => {
    for (let x = 0; x < W;) {
      const w = 40 + r() * 34 | 0, h = 70 + r() * 110 | 0;
      rect(b, p.sky, x, GROUND - h, w, h);
      for (let wy = GROUND - h + 8; wy < GROUND - 8; wy += 11) {
        for (let wx = x + 6; wx < x + w - 6; wx += 9) if (r() < 0.28) rect(b, p.light, wx, wy, 4, 5);
      }
      x += w + 6 + (r() * 10 | 0);
    }
  },
  // A terraced row, a chimney on every house.
  terraces: (b, p, r) => {
    for (let x = 0; x < W; x += 30) {
      rect(b, p.sky, x, GROUND - 48, 30, 48);
      polygon(b, p.sky, [[x, GROUND - 48], [x + 15, GROUND - 64], [x + 30, GROUND - 48]]);
      rect(b, p.sky, x + 20, GROUND - 70, 6, 14);
      if (r() < 0.4) rect(b, p.light, x + 6, GROUND - 38, 6, 7);
    }
  },
  // Pairs of semis, a lamp post between each pair.
  suburbs: (b, p, r) => {
    for (let x = 6; x < W; x += 80) {
      rect(b, p.sky, x, GROUND - 44, 56, 44);
      polygon(b, p.sky, [[x - 4, GROUND - 44], [x + 10, GROUND - 62], [x + 46, GROUND - 62], [x + 60, GROUND - 44]]);
      if (r() < 0.5) rect(b, p.light, x + 10, GROUND - 32, 7, 8);
      rect(b, p.sky, x + 70, GROUND - 40, 2, 40);
    }
  },
  // Detached houses with a tree between each.
  leafy: (b, p, r) => {
    for (let x = 10; x < W; x += 130) {
      rect(b, p.sky, x, GROUND - 50, 58, 50);
      polygon(b, p.sky, [[x - 6, GROUND - 50], [x + 29, GROUND - 76], [x + 64, GROUND - 50]]);
      if (r() < 0.5) rect(b, p.light, x + 12, GROUND - 36, 8, 9);
      disc(b, p.sky, x + 95, GROUND - 40, 18); rect(b, p.sky, x + 93, GROUND - 26, 4, 26);
    }
  },
  // A manor with two wings on rolling hills, trees along the ridge.
  country: (b, p, r) => {
    b.fillStyle = p.sky; b.beginPath(); b.moveTo(0, GROUND);
    b.bezierCurveTo(200, GROUND - 120, 380, GROUND - 40, 560, GROUND - 90); b.bezierCurveTo(720, GROUND - 130, 860, GROUND - 50, 960, GROUND - 70);
    b.lineTo(960, GROUND); b.fill();
    rect(b, p.sky, 470, GROUND - 170, 150, 90); rect(b, p.sky, 460, GROUND - 200, 26, 120); rect(b, p.sky, 604, GROUND - 200, 26, 120);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 3; j++) if (r() < 0.4) rect(b, p.light, 495 + i * 15, GROUND - 160 + j * 24, 6, 9);
    for (let i = 0; i < 9; i++) disc(b, p.sky, 60 + i * 100 + r() * 30, GROUND - 90 - r() * 30, 14);
  },
  // A cottage and a lighthouse on the cliff, and the sea.
  coast: (b, p, r) => {
    polygon(b, p.sky, [[0, GROUND - 110], [380, GROUND - 90], [470, GROUND], [0, GROUND]]);
    rect(b, p.sky, 80, GROUND - 140, 60, 30); polygon(b, p.sky, [[74, GROUND - 140], [110, GROUND - 162], [146, GROUND - 140]]);
    rect(b, p.light, 96, GROUND - 132, 8, 9);
    rect(b, p.sky, 300, GROUND - 210, 20, 116); rect(b, p.light, 298, GROUND - 222, 24, 12);
    line(b, p.water, 3, [[470, GROUND - 30], [960, GROUND - 30]]);
    for (let i = 0; i < 12; i++) line(b, p.water, 2, [[480 + r() * 460, GROUND - 22 + r() * 18], [500 + r() * 460, GROUND - 22 + r() * 18]]);
  },
};

// A neighbourhood's backdrop on a canvas of its own, k device pixels to a unit: its palette's ground, its map, its
// skyline and the green ground line. Its details come from a generator seeded by its rung.
export function buildBackdrop(neighbourhood, k) {
  const { look, palette } = neighbourhood, r = rng(SEED + NEIGHBOURHOODS.indexOf(neighbourhood));
  const c = document.createElement('canvas');
  c.width = Math.round(W * k); c.height = Math.round(H * k);
  const b = c.getContext('2d');
  b.setTransform(k, 0, 0, k, 0, 0);
  rect(b, palette.bg, 0, 0, W, H);
  MAPS[look](b, palette, r);
  SKYLINES[look](b, palette, r);
  rect(b, COLORS.green, 0, GROUND, W, 2);
  return c;
}

// ---- RED scaffolds (DISTILL, 2026-10-26; revised after the Final Wave Review Gate) ----
// The four exports DESIGN added (ADR-010), named for DELIVER to build. Only the acceptance scenarios in
// tests/e2e/rightmove-invaders-level-backdrops/acceptance/ call them: render.js still uses buildBackdrop and its own
// cache, so the game runs exactly as before. DELIVER replaces each body, moves render.js onto them, and deletes this
// marker with the last one.
export const __SCAFFOLD__ = true;

// What the screen shows behind the game on a frame (DDD-B5), from that frame's { level, state, banner } and nothing
// else: { here, next, mix }, here and next being NEIGHBOURHOODS entries. While the wave is cleared below Forever home,
// next is the next rung's and mix is 1 - banner / BANNER_TIME, clamped to [0, 1]; otherwise next is null and mix 0.
// BANNER_TIME comes from ../game/config.js, never from the rules. A pause stops the banner, so it holds the fade too.
export function backdropPlan({ level, state, banner }) {
  const here = neighbourhood(level), next = neighbourhood(level + 1);   // the same place from Forever home on
  if (state !== 'clear' || next === here) return { here, next: null, mix: 0 };
  return { here, next, mix: Math.min(1, Math.max(0, 1 - banner / BANNER_TIME)) };
}

// Paints a neighbourhood's backdrop on the 2D context it is handed, in game units (DDD-B1, DDD-B2): its ground, its map,
// its skyline and the green ground line, with the rung's own generator (never Math.random), in its palette's colours and
// COLORS.green only, and with no transform. The same calls every time.
export function paintBackdrop(context, neighbourhood) {
  throw new Error('Not yet implemented -- RED scaffold');
}

// The store of built backdrops (DDD-B3, DDD-B4): { rescale(k), canvasFor(neighbourhood) }. createCanvas() makes an
// offscreen canvas. canvasFor returns the neighbourhood's own canvas, built the first time it is asked for at k device
// pixels to a unit (sized round(W * k) by round(H * k), the transform set, then paintBackdrop), keeping at most two, the
// least recently asked-for going first; or null once its build has failed (a null 2D context, or a draw that threw).
// Failed marks are kept apart from the two and never evicted. rescale(k) with a new scale drops every canvas and every
// failed mark; with the same scale it returns at once. Nothing is thrown or logged.
export function createBackdropCache(createCanvas) {
  throw new Error('Not yet implemented -- RED scaffold');
}

// The shell (DDD-B5): draws the plan on the screen's context. It is handed the store's canvasFor alone (a view of the
// store that can't rescale it), and asks it for here, then for next whenever the plan names one, even at a mix of 0. It draws here at full strength and next at globalAlpha = mix, each over the
// whole screen (0, 0, W, H); a null canvas is a fillRect in that palette's bg at the same strength, never drawImage(null)
// (the feature delta's composition table). It puts globalAlpha back to the value it found.
export function showBackdrop(context, plan, canvasFor) {
  throw new Error('Not yet implemented -- RED scaffold');
}
