const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);

// Keyboard state for a fixed-step game loop. A tap shorter than one frame (keydown and keyup
// both before the next simulation step) stays held until a step has seen it; otherwise quick
// taps of Space or an arrow would be lost.
export function createKeyboard(target = window) {
  const held = new Set(), pressed = new Set(), unseen = new Set(), releaseAfterStep = new Set();

  target.addEventListener('keydown', e => {
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
    endStep() {
      unseen.clear();
      for (const code of releaseAfterStep) held.delete(code);
      releaseAfterStep.clear();
    },
    // Keyups never arrive while the window is unfocused, so forget everything on blur.
    releaseAll() { held.clear(); unseen.clear(); releaseAfterStep.clear(); },
  };
}
