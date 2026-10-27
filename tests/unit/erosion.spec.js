import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { assertStateDelta, setTo } from '../common/state-delta.js';
import { SW, SH, BRICK, EMPTY, makeShield, erode } from '../../src/game/shields.js';
import { PX } from '../../src/game/config.js';

// A shot (radius 2.2 cells) or a bolt (2.8) blasts a ragged hole in a house: erode(hit, r, chance) empties every cell of
// the 7 x 7 neighbourhood within r of the hit, and leaves each one further out than r - 1.2 to the game's chance, one
// draw per such cell, row by row, emptying it on a draw of 0.5 or more (DDD-R6). It compares squared distances, so it
// must decide every cell as Math.hypot did (D13): the replay plays the houses the same in every engine.

const RADII = [2.2, 2.8];
const NEIGHBOURHOOD = [-3, -2, -1, 0, 1, 2, 3].flatMap(dy => [-3, -2, -1, 0, 1, 2, 3].map(dx => ({ dx, dy })));

// A chance that answers `draws` in turn, and counts what it handed.
function scripted(draws) {
  let taken = 0;
  return { next: () => draws[taken++], taken: () => taken };
}

// What Math.hypot made of a cell: 'out' of the blast, on its 'edge' (the chance decides) or 'in' it.
function byHypot({ dx, dy }, r) {
  const d = Math.hypot(dx, dy);
  if (d > r) return 'out';
  return d > r - 1.2 ? 'edge' : 'in';
}

// bypass: an exhaustive loop over a closed domain (all 49 cells, both radii), stronger than any sample of it.
test('squared distances decide all 49 cells as Math.hypot did, for radii 2.2 and 2.8', () => {
  const CX = 12, CY = 9;   // the whole neighbourhood inside the house
  for (const r of RADII) {
    const blast = draw => {
      const s = makeShield(0, 0);
      s.cells.fill(BRICK);
      const chance = scripted(Array(49).fill(draw));
      erode({ s, cx: CX, cy: CY }, r, chance);
      return { emptied: ({ dx, dy }) => s.cells[(CY + dy) * SW + CX + dx] === EMPTY, taken: chance.taken() };
    };
    const kept = blast(0), lost = blast(0.5);   // every edge cell kept, then every edge cell emptied
    const decided = NEIGHBOURHOOD.map(cell => (kept.emptied(cell) ? 'in' : lost.emptied(cell) ? 'edge' : 'out'));
    const expected = NEIGHBOURHOOD.map(cell => byHypot(cell, r));
    expect(decided, `radius ${r}`).toEqual(expected);
    const edges = expected.filter(kind => kind === 'edge').length;
    expect([kept.taken, lost.taken], `radius ${r}: one draw per edge cell`).toEqual([edges, edges]);
  }
});

// The hole Math.hypot's rule makes, the k-th draw deciding the k-th edge cell inside the house: -> { cells, taken }.
function holeByHypot(cells, { cx, cy }, r, draws) {
  const after = [...cells];
  let taken = 0;
  for (const cell of NEIGHBOURHOOD) {
    const x = cx + cell.dx, y = cy + cell.dy, kind = byHypot(cell, r);
    if (kind === 'out' || x < 0 || y < 0 || x >= SW || y >= SH) continue;
    if (kind === 'edge' && draws[taken++] < 0.5) continue;
    after[y * SW + x] = EMPTY;
  }
  return { cells: after, taken };
}

// Universe: the house's cells, whether it must be repainted and where it stands, the draws the chance handed, and the
// point erode answers.
const UNIVERSE = ['cells', 'dirty', 'x', 'y', 'draws taken', 'point'];
const house = fc.record({
  x: fc.integer({ min: 0, max: 900 }), y: fc.integer({ min: 0, max: 600 }), dirty: fc.boolean(),
  cells: fc.array(fc.integer({ min: 0, max: 3 }), { minLength: SW * SH, maxLength: SW * SH }),
});
const hit = fc.record({ cx: fc.nat({ max: SW - 1 }), cy: fc.nat({ max: SH - 1 }) });
const draw = fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true });

test("erode empties the cells Math.hypot's rule names, each edge cell on the chance's next draw, and changes nothing else", () => {
  fc.assert(fc.property(house, hit, fc.constantFrom(...RADII), fc.array(draw, { minLength: 49, maxLength: 49 }), (given, at, r, draws) => {
    const s = makeShield(given.x, given.y);
    s.cells.set(given.cells);
    s.dirty = given.dirty;
    const chance = scripted(draws);
    const observe = point => ({ cells: [...s.cells], dirty: s.dirty, x: s.x, y: s.y, 'draws taken': chance.taken(), point });
    const before = observe(null);
    const point = erode({ s, ...at }, r, chance);
    const hole = holeByHypot(given.cells, at, r, draws);
    assertStateDelta(before, observe(point), {
      universe: UNIVERSE,
      expected: {
        cells: setTo(hole.cells),
        dirty: setTo(true),
        'draws taken': setTo(hole.taken),
        point: setTo({ x: given.x + at.cx * PX, y: given.y + at.cy * PX }),
      },
    });
  }));
});
