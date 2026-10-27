import sys, os

root = sys.argv[1]
game = os.path.join(root, 'game.js')
shields = os.path.join(root, 'shields.js')

s = open(game).read()
s = s.replace("const SHOT_SPEED = 720, LIVES = 3,", "const SHOT_SPEED = 720, LIVES = globalThis.PROBE_LIVES ?? 3,")
s = s.replace("import { SW, makeShield, sweep, erode, clearRect } from './shields.js';",
              "import { SW, makeShield, sweep, erode, clearRect, setRandom } from './shields.js';")
s = s.replace("// Moments the sound system reacts to.", """// PROBE: a seeded gameplay source (sfc32), and particles that can be switched off.
let rand = Math.random, cosmetic = true;
function sfc32(a, b, c, d) {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0; a = b ^ b >>> 9; b = c + (c << 3) | 0; c = c << 21 | c >>> 11; c = c + t | 0;
    return (t >>> 0) / 4294967296;
  };
}
export function probeSeed(seed, { particles = true } = {}) {
  rand = sfc32(0x9e3779b9, 0x243f6a88, 0xb7e15162, seed >>> 0);
  for (let i = 0; i < 15; i++) rand();
  setRandom(rand);
  cosmetic = particles;
}

// Moments the sound system reacts to.""")
start = s.index('function startWave')
burst = s.index('function burst(')
head, mid, tail = s[:start], s[start:burst], s[burst:]
mid = mid.replace('Math.random()', 'rand()')
tail = tail.replace("function burst(x, y, color, n, speed = 160) {\n",
                    "function burst(x, y, color, n, speed = 160) {\n  if (!cosmetic) return;\n")
open(game, 'w').write(head + mid + tail)

s = open(shields).read()
s = s.replace("export const SW = 24", "let rand = Math.random;\nexport const setRandom = source => { rand = source; };\nexport const SW = 24")
old = """    const d = Math.hypot(dx, dy), x = cx + dx, y = cy + dy;
    if (d > r || x < 0 || y < 0 || x >= SW || y >= SH) continue;
    if (d > r - 1.2 && Math.random() < 0.5) continue;"""
new = """    const x = cx + dx, y = cy + dy;
    if (globalThis.PROBE_HYPOT) {
      const d = Math.hypot(dx, dy);
      if (d > r || x < 0 || y < 0 || x >= SW || y >= SH) continue;
      if (d > r - 1.2 && rand() < 0.5) continue;
    } else {
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r || x < 0 || y < 0 || x >= SW || y >= SH) continue;
      if (d2 > (r - 1.2) * (r - 1.2) && rand() < 0.5) continue;
    }"""
assert old in s
s = s.replace(old, new)
open(shields, 'w').write(s)
print('patched')
