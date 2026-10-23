// Best score persists in the browser. Storage can be blocked (private windows, site settings),
// in which case the game simply starts from £0 each time.
const KEY = 'make-the-right-move:best';

export function loadBest() {
  try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; }
}

export function saveBest(score) {
  try { localStorage.setItem(KEY, String(score)); } catch { /* not persisted */ }
}
