import { createSynth } from '../../../src/synth.js';

// A recording stand-in for the slice of the browser's audio the synth drives (its one driven port, ADR-002).
// It keeps every node the synth creates, what was scheduled on each parameter and where each node was
// connected, so a unit property can read what the synth asked the audio graph to do, with no browser.

const CALLS = ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues'];
const SCHEDULED_VALUES = ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime'];

function createParam(value) {
  const param = { value, calls: [] };
  for (const name of CALLS) param[name] = (...args) => { param.calls.push({ name, args }); };
  return param;
}

// The highest level a gain parameter is told to reach: what it is scheduled to, else the value it was set to.
function peakOf(param) {
  const scheduled = param.calls.filter(call => SCHEDULED_VALUES.includes(call.name)).map(call => call.args[0]);
  return scheduled.length ? Math.max(...scheduled) : param.value;
}

const isFadedToSilence = node => node.kind === 'gain' && node.gain.calls.some(call => call.name === 'setTargetAtTime' && call.args[0] === 0);

export function createFakeAudio() {
  const nodes = [], listeners = [];
  const destination = { kind: 'destination' };
  let failing = false;

  function create(kind) {
    if (failing) throw new Error('the audio graph failed');
    const node = {
      kind, outputs: [], starts: [], stops: [],
      frequency: createParam(440), gain: createParam(1),
      connect(target) { node.outputs.push(target); return target; },
      start(at) { node.starts.push(at); },
      stop(at) { node.stops.push(at); },
    };
    nodes.push(node);
    return node;
  }

  const context = {
    state: 'running', currentTime: 0, sampleRate: 1000, destination,
    createOscillator: () => create('oscillator'),
    createGain: () => create('gain'),
    createBufferSource: () => create('bufferSource'),
    createBiquadFilter: () => create('filter'),
    createBuffer: (channels, length) => ({ getChannelData: () => new Float32Array(length) }),
    addEventListener: (type, listener) => { listeners.push(listener); },
    resume: () => { context.state = 'running'; return Promise.resolve(); },
  };

  // The nodes a node passes through on its way to the speakers, or null when its sound never gets there.
  function pathToSpeakers(node) {
    if (node === destination) return [];
    for (const next of node.outputs ?? []) {
      const rest = pathToSpeakers(next);
      if (rest) return [node, ...rest];
    }
    return null;
  }

  // Every source that was started and is heard, in the order it was started.
  function voices() {
    return nodes
      .filter(node => node.starts.length > 0)
      .map(source => ({ source, path: pathToSpeakers(source) }))
      .filter(({ path }) => path)
      .map(({ source, path }) => ({
        source,
        faded: path.some(isFadedToSilence),
        peak: path.filter(node => node.kind === 'gain').reduce((level, node) => level * peakOf(node.gain), 1),
        startPitch: source.frequency.calls.find(call => call.name === 'setValueAtTime')?.args[0],
      }));
  }

  return {
    context,
    nodes: () => nodes,
    voices,
    advanceClock(seconds) { context.currentTime += seconds; },
    // The context changes state by itself (a browser suspends it), and tells the synth.
    changeState(state) { context.state = state; listeners.forEach(listener => listener()); },
    breakGraph() { failing = true; },
  };
}

// Timers the test turns by hand.
export function createFakeTimers() {
  const callbacks = new Map();
  let next = 1;
  return {
    setInterval: callback => { callbacks.set(next, callback); return next++; },
    clearInterval: id => { callbacks.delete(id); },
    running: () => callbacks.size,
    tick: () => [...callbacks.values()].forEach(callback => callback()),
  };
}

// A synth on a fake audio graph, already unlocked: what the page has after the first key press.
export function unlockedSynth() {
  const audio = createFakeAudio(), timers = createFakeTimers();
  const synth = createSynth({ createContext: () => audio.context, now: () => 0, setInterval: timers.setInterval, clearInterval: timers.clearInterval });
  synth.unlock();
  return { synth, audio, timers };
}
