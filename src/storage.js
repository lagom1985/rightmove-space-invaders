// Best score and settings persist in the browser. Storage can be blocked (private windows, site settings),
// in which case the game simply starts from £0 each time, with sound and music on.
const PREFIX = 'make-the-right-move:';

export function loadBest() {
  try { return Number(localStorage.getItem(PREFIX + 'best')) || 0; } catch { return 0; }
}

export function saveBest(score) {
  try { localStorage.setItem(PREFIX + 'best', String(score)); } catch { /* not persisted */ }
}

// Only a saved 'off' turns a setting off: nothing saved, anything else, or no storage at all means on.
const isOn = name => {
  try { return localStorage.getItem(PREFIX + name) !== 'off'; } catch { return true; }
};

export function loadSettings() {
  return { sound: isOn('sound'), music: isOn('music') };
}

export function saveSetting(name, on) {
  try { localStorage.setItem(PREFIX + name, on ? 'on' : 'off'); } catch { /* not persisted */ }
}
