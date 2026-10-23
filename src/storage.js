// Best score and settings persist in the browser. Storage can be blocked (private windows, site settings),
// in which case the game simply starts from £0 each time, with sound and music on.
const PREFIX = 'make-the-right-move:';

// A blocked storage throws: a read then gives `fallback` and a write is dropped.
function read(name, fallback) {
  try { return localStorage.getItem(PREFIX + name); } catch { return fallback; }
}

function write(name, value) {
  try { localStorage.setItem(PREFIX + name, value); } catch { /* not persisted */ }
}

export function loadBest() {
  return Number(read('best', null)) || 0;
}

export function saveBest(score) {
  write('best', String(score));
}

// Only a saved 'off' turns a setting off: nothing saved, anything else, or no storage at all means on.
function isOn(name) {
  return read(name, 'on') !== 'off';
}

export function loadSettings() {
  return { sound: isOn('sound'), music: isOn('music') };
}

export function saveSetting(name, on) {
  write(name, on ? 'on' : 'off');
}
