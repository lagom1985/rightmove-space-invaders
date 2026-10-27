import { test } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { createRecordingContext } from './support/fake-canvas.js';
import { arrange } from './support/fresh-game.js';
import { assertStateDelta, satisfying, setTo } from '../common/state-delta.js';
import * as rules from '../../src/game/game.js';
import { STEP } from '../../src/game/config.js';
import { pounds } from '../../src/theme/theme.js';
import { createRenderer } from '../../src/view/render.js';

// The renderer is handed a read-only view of the game, { g, canPlayAgain, invaderX, invaderY }, which main.js builds,
// and reads nothing else of it: no control method reaches it (DDD-R7, the user, 2026-10-27). Handed the whole instance
// here, behind a proxy that notes every key asked of it, it still reads only those four, writes none, and draws the
// game it was handed: the HUD's deposit is that game's. What it draws is checked by hand (the canvas waiver, D10).

const VIEW = ['g', 'canPlayAgain', 'invaderX', 'invaderY'];
const HUD_DEPOSIT_AT = [24, 52];

// The browser's canvases, in Node: recording contexts offering what the renderer, its sprites, its houses and the
// backdrops draw with (tests/unit/support/fake-canvas.js).
const DRAWING = Object.freeze({
  methods: ['fillRect', 'clearRect', 'drawImage', 'fillText', 'strokeText', 'setTransform', 'save', 'restore', 'beginPath',
    'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'bezierCurveTo', 'arc', 'ellipse', 'setLineDash'],
  styles: { fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, lineJoin: 'miter', font: '10px sans-serif', textAlign: 'start', globalAlpha: 1, imageSmoothingEnabled: true },
});
function standInCanvas() {
  const recording = createRecordingContext({ offers: DRAWING });
  return { width: 300, height: 150, recording, getContext: type => (type === '2d' ? recording.context : null) };
}
const standInDocument = Object.freeze({
  createElement(tag) {
    if (tag !== 'canvas') throw new TypeError(`the stand-in document makes only canvases, not ${tag}`);
    return standInCanvas();
  },
});

// The instance behind a proxy that notes every key asked of it, every write and every listing of its keys.
function watched(game) {
  const reads = new Set(), writes = [];
  const note = (list, what) => { list.push(String(what)); return true; };
  const view = new Proxy({ ...game }, {
    get(target, key) { reads.add(String(key)); return target[key]; },
    has(target, key) { reads.add(`in ${String(key)}`); return key in target; },
    ownKeys(target) { reads.add('its keys'); return Reflect.ownKeys(target); },
    set: (_, key) => note(writes, key),
    defineProperty: (_, key) => note(writes, key),
    deleteProperty: (_, key) => note(writes, key),
  });
  return { view, reads, writes };
}

// Moments of a game, reached through its ports (a game over and a cleared wave through fresh-game.js's checked writes).
const rows = fc.array(fc.record({ initials: fc.constantFrom('ABC', 'XYZ'), score: fc.constantFrom(10, 1000), id: fc.constantFrom('r1', 'r2') }), { maxLength: 3 });
const MOMENTS = {
  enter: game => game.handlePresses(new Set(['Enter'])),
  play: (game, { steps, held }) => { for (let i = 0; i < steps; i++) game.update(STEP, { isDown: code => held.includes(code) }); },
  over: (game, { deposit }) => {
    if (game.g.state !== 'play') return;
    arrange.deposit(game, deposit);
    arrange.formationOnPin(game);
    game.update(STEP, { isDown: () => false });
  },
  cleared: game => {
    if (game.g.state !== 'play') return;
    arrange.lastHurdleShot({ ...rules, ...game });
    game.update(STEP, { isDown: () => false });
  },
  table: (game, { scores }) => game.tableAnswered({ scores, listedAt: 0 }),
  type: (game, { keys }) => game.handlePresses(new Set(), keys.map(key => ({ key }))),
  wait: game => game.update(1, { isDown: () => false }),
  pause: game => game.pause(),
};
const moment = fc.oneof(
  fc.constantFrom('enter', 'cleared', 'wait', 'pause').map(kind => ({ kind })),
  fc.record({ kind: fc.constant('play'), steps: fc.integer({ min: 1, max: 120 }), held: fc.subarray(['ArrowLeft', 'ArrowRight', 'Space']) }),
  fc.record({ kind: fc.constant('over'), deposit: fc.constantFrom(50, 1500) }),
  fc.record({ kind: fc.constant('table'), scores: rows }),
  fc.record({ kind: fc.constant('type'), keys: fc.array(fc.constantFrom('a', 'b', 'c', 'Enter', 'Escape'), { minLength: 1, maxLength: 4 }) }),
);

const seed = fc.stringMatching(/^[0-9a-f]{32}$/);

// Universe of one frame drawn: the view's keys read and written, and the deposit the HUD drew.
test('the renderer reads only g, canPlayAgain, invaderX and invaderY of the view it is handed, and draws that game', () => {
  const realDocument = globalThis.document;
  globalThis.document = standInDocument;
  try {
    fc.assert(fc.property(seed, fc.array(moment, { maxLength: 12 }), (given, moments) => {
      const game = rules.createGame({ newSeed: () => given });
      const { view, reads, writes } = watched(game);
      const screen = standInCanvas();
      const renderer = createRenderer(screen, view);
      for (const { kind, ...detail } of [{ kind: 'wait' }, ...moments]) {
        MOMENTS[kind](game, detail);
        reads.clear();
        const drawnBefore = screen.recording.calls().length;
        const look = () => ({
          'view keys read': [...reads], 'view keys written': [...writes],
          'deposit drawn': screen.recording.calls().slice(drawnBefore)
            .findLast(([name, , x, y]) => name === 'fillText' && x === HUD_DEPOSIT_AT[0] && y === HUD_DEPOSIT_AT[1])?.[1] ?? null,
        });
        const before = look();
        renderer.draw();
        assertStateDelta(before, look(), {
          universe: ['view keys read', 'view keys written', 'deposit drawn'],
          expected: {
            'view keys read': satisfying(`g, and only from ${VIEW.join(', ')}`, (_, read) => read.includes('g') && read.every(key => VIEW.includes(key))),
            'deposit drawn': setTo(pounds(game.g.score).toUpperCase()),
          },
        });
      }
    }), { numRuns: 40 });
  } finally {
    if (realDocument === undefined) delete globalThis.document;
    else globalThis.document = realDocument;
  }
});
