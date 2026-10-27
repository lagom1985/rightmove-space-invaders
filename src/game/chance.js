// The game's chance (ADR-013, DESIGN DDD-R6): every gameplay draw comes from the game's seed, so the function can replay
// the game and draw exactly what the browser drew. Pure: imports nothing, and uses only 32-bit integer operations and an
// exact division by 2^32, which every engine computes alike.
//
// createChance(seed) -> { next() -> a number in [0, 1) }: sfc32 over the 32-hex seed's four 32-bit words, warmed up 12
// draws. Each game creates its own; two chances never share a draw.
const WARM_UP = 12;
const TWO_TO_THE_32 = 4294967296;

export function createChance(seed) {
  let [a, b, c, d] = [0, 8, 16, 24].map(at => Number.parseInt(seed.slice(at, at + 8), 16) | 0);
  function next() {
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0;
    a = b ^ b >>> 9;
    b = c + (c << 3) | 0;
    c = (c << 21 | c >>> 11) + t | 0;
    return (t >>> 0) / TWO_TO_THE_32;
  }
  for (let draw = 0; draw < WARM_UP; draw++) next();
  return { next };
}
