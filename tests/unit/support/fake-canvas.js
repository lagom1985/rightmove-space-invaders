// Stand-ins for the canvas, for the backdrops (src/view/backdrop.js) in Node, which has none. They record what is drawn
// and in which colours, never pixels (waiver D10). Like fake-status-root.js, they offer only what the backdrops use and
// refuse anything else: a backdrop that reached for something else (getImageData, a filter, a DOM global...) fails here
// too. Every refusal is also kept, so a refusal swallowed by the backdrops' own fail-safe is still seen.

// What the map and skyline recipes draw with (paintBackdrop): rectangles, paths, arcs, ellipses and curves, solid or
// dashed, one fill or stroke colour at a time, in game units. They never set the scale: that is the store's.
export const PAINT_CALLS = Object.freeze({
  methods: ['fillRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'bezierCurveTo', 'arc', 'ellipse',
    'setLineDash'],
  styles: { fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1 },
});
// What a backdrop's own canvas is asked for while it is built: the store sets its scale, then the recipes paint.
export const RECIPE_CALLS = Object.freeze({ methods: ['setTransform', ...PAINT_CALLS.methods], styles: PAINT_CALLS.styles });
// What the shell (showBackdrop) is offered on the screen's own context: a built backdrop drawn whole, or a plain
// background filled, each at a strength (globalAlpha), with save and restore allowed for putting the strength back.
export const SCREEN_CALLS = Object.freeze({
  methods: ['drawImage', 'fillRect', 'save', 'restore'],
  styles: { fillStyle: '#000000', globalAlpha: 1 },
});
const DRAWS = new Set(['fillRect', 'fill', 'stroke', 'drawImage']);   // the calls that put paint on the surface

const copy = value => (Array.isArray(value) ? [...value] : value);

// A recording 2D context. calls() -> every call and style set, in order: ['fillRect', x, y, w, h], ['fillStyle', '#123456'];
// on the screen's context, a draw also records the strength and the fill colour it was made with:
// ['drawImage', canvas, 0, 0, 960, 720, { alpha: 0.5, fillStyle: '#000000' }].
// styles() -> the styles as they are now. failAfterDraws: the drawing surface is lost after that many draws (canvas
// memory limits, a lost GPU): the next draw throws.
export function createRecordingContext({ offers = RECIPE_CALLS, failAfterDraws = Infinity, refused = [] } = {}) {
  const calls = [];
  const methodNames = new Set(offers.methods);
  let styles = { ...offers.styles };
  const saved = [];
  let draws = 0;
  const refuse = what => {
    refused.push(what);
    throw new TypeError(`the recording context doesn't offer ${what}`);
  };
  const methods = Object.fromEntries(offers.methods.map(name => [name, (...args) => {
    if (DRAWS.has(name) && ++draws > failAfterDraws) throw new Error('the canvas has lost its drawing surface');
    if (name === 'save') saved.push({ ...styles });
    if (name === 'restore' && saved.length) styles = saved.pop();
    const call = [name, ...args.map(copy)];
    if (DRAWS.has(name) && 'globalAlpha' in styles) call.push({ alpha: styles.globalAlpha, fillStyle: styles.fillStyle });
    calls.push(call);
  }]));
  const context = new Proxy({}, {
    get(_, key) {
      if (typeof key === 'symbol' || key === 'then') return undefined;   // never a thenable, and printable
      if (methodNames.has(key)) return methods[key];
      if (key in styles) return styles[key];
      return refuse(`reading "${key}"`);
    },
    set(_, key, value) {
      if (!(key in styles)) return refuse(`setting "${String(key)}"`);
      styles[key] = value;
      calls.push([key, value]);
      return true;
    },
    has: (_, key) => methodNames.has(key) || key in styles,
    deleteProperty: (_, key) => refuse(`deleting "${String(key)}"`),
    defineProperty: (_, key) => refuse(`defining "${String(key)}"`),
  });
  return { context, calls: () => calls.map(call => [...call]), styles: () => ({ ...styles }) };
}

// The trouble a screen can be in when a backdrop asks it for a drawing surface.
export const CanvasTrouble = Object.freeze({
  NONE: 'none',                                   // every surface works
  NO_ROOM: 'no room',                             // getContext('2d') returns null for every surface made
  ALL_BUT_THE_FIRST: 'all but the first',         // null for the next surface made only, then every one works
  ROOM_FOR_ONE: 'room for one more only',         // the next surface made works, then every one is null
  LOSES_DRAWING: 'loses drawing',                 // every surface made loses its drawing after a few draws
});
const DRAWS_BEFORE_LOSS = 5;

// Makes stand-in canvases, as the backdrop store's injected factory: createCanvas() -> a canvas 300 by 150, like a new
// <canvas>, whose width and height can be set and whose getContext('2d') gives a recording context (or null, in
// trouble). made() -> every canvas made so far, in order, with its size and recording; refused() -> every refusal.
export function createFakeCanvasFactory() {
  const made = [];
  const refused = [];
  let trouble = CanvasTrouble.NONE;
  const refuse = what => {
    refused.push(what);
    throw new TypeError(`the stand-in canvas doesn't offer ${what}`);
  };

  function createCanvas(...args) {
    if (args.length) refuse(`arguments to createCanvas (${args.length})`);
    const noRoom = trouble === CanvasTrouble.NO_ROOM || trouble === CanvasTrouble.ALL_BUT_THE_FIRST;
    if (trouble === CanvasTrouble.ALL_BUT_THE_FIRST) trouble = CanvasTrouble.NONE;
    if (trouble === CanvasTrouble.ROOM_FOR_ONE) trouble = CanvasTrouble.NO_ROOM;
    const recording = createRecordingContext({ failAfterDraws: trouble === CanvasTrouble.LOSES_DRAWING ? DRAWS_BEFORE_LOSS : Infinity, refused });
    const size = { width: 300, height: 150 };
    const getContext = type => (type === '2d' ? (noRoom ? null : recording.context) : refuse(`getContext('${type}')`));
    const canvas = new Proxy({}, {
      get(_, key) {
        if (typeof key === 'symbol' || key === 'then') return undefined;
        if (key === 'width' || key === 'height') return size[key];
        if (key === 'getContext') return getContext;
        return refuse(`reading "${key}" of a canvas`);
      },
      set(_, key, value) {
        if (key !== 'width' && key !== 'height') return refuse(`setting "${String(key)}" of a canvas`);
        size[key] = value;
        return true;
      },
    });
    made.push({ canvas, size, recording, noRoom });
    return canvas;
  }

  return {
    createCanvas,
    made: () => [...made],
    refused: () => [...refused],
    setTrouble(next) { trouble = next; },
  };
}
