const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);

// A key pressed with Cmd, Ctrl or Alt/Option held belongs to the browser and the OS: it never types (DDD-T4).
const isChord = e => e.metaKey || e.ctrlKey || e.altKey;

// Keyboard state for a fixed-step game loop, on two channels (ADR-009).
// - Positions (e.code), for the game keys: a tap shorter than one frame (keydown and keyup both before the next simulation
//   step) stays held until a step has seen it; otherwise quick taps of Space or an arrow would be lost.
// - Typed presses (e.key), for the initials: every keydown in the order it arrived, so two presses of one key within a
//   frame are two letters. A held key's repeats and chords are left out.
export function createKeyboard(target = window) {
  const held = new Set(), pressed = new Set(), unseen = new Set(), releaseAfterStep = new Set();
  const typed = [];

  target.addEventListener('keydown', e => {
    if (!e.repeat && !isChord(e)) typed.push({ key: e.key });
    if (e.metaKey || e.ctrlKey) return;               // leave browser shortcuts alone
    if (GAME_KEYS.has(e.code)) e.preventDefault();    // Space and arrows would scroll the page
    if (!e.repeat) { pressed.add(e.code); unseen.add(e.code); }
    held.add(e.code);
  });
  target.addEventListener('keyup', e => {
    if (unseen.has(e.code)) releaseAfterStep.add(e.code); else held.delete(e.code);
  });

  return {
    isDown: code => held.has(code),
    // Keys pressed since the last call, for one-shot actions such as Enter or P.
    takePressed() { const p = new Set(pressed); pressed.clear(); return p; },
    // Keys typed since the last call, in order, as [{ key }], for the initials.
    takeTyped: () => typed.splice(0),
    endStep() {
      unseen.clear();
      for (const code of releaseAfterStep) held.delete(code);
      releaseAfterStep.clear();
    },
    // Keyups never arrive while the window is unfocused, so forget everything on blur.
    releaseAll() { held.clear(); unseen.clear(); releaseAfterStep.clear(); },
  };
}
