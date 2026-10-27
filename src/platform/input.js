const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);

// Cmd or Ctrl held (AltGr, Ctrl+Alt on Windows, included): a browser shortcut, which the positions leave alone too.
const isShortcut = e => e.metaKey || e.ctrlKey;
// A key pressed with Cmd, Ctrl or Alt/Option held belongs to the browser and the OS: it never types (DDD-T4).
const isChord = e => isShortcut(e) || e.altKey;
// One code point (a letter, a digit, /, ', é, å…), not a key name such as Enter, F5 or Dead.
const isOneCharacter = key => [...key].length === 1;
// A key event dispatched by a script on the page, such as an autopilot pasted in the console (isTrusted false): no person
// pressed it, so it never plays (ADR-009, 2026-10-27).
const isScripted = e => !e.isTrusted;

// The default policy (DDD-T8), the same on every screen: true when the game keeps the keydown from the browser, so
// Space and the arrows don't scroll the page, / and ' don't open Firefox's quick find and Backspace doesn't leave the
// page. Shortcuts keep their default, and so do Enter, Esc, Tab and the other named keys. With Alt/Option alone,
// printable keys and Backspace are the OS's, but Space and the arrows stay prevented, as they always were. A repeat
// gets the same answer as its first press, so a held / can't open quick find either.
export function preventsDefault(keydown) {
  if (isShortcut(keydown)) return false;
  if (GAME_KEYS.has(keydown.code)) return true;
  if (keydown.altKey) return false;
  return isOneCharacter(keydown.key) || keydown.key === 'Backspace';
}

// Keyboard state for a fixed-step game loop, on two channels (ADR-009).
// - Positions (e.code), for the game keys: a tap shorter than one frame (keydown and keyup both before the next simulation
//   step) stays held until a step has seen it; otherwise quick taps of Space or an arrow would be lost. Only a person's
//   keys count: a script's keydowns and keyups are left out, so a script can't move, fire, start or pause.
// - Typed presses (e.key), for the initials: every keydown in the order it arrived, so two presses of one key within a
//   frame are two letters. A held key's repeats and chords are left out. A script's keydowns type: initials are all they
//   can enter, and the tests stand in for other layouts with them (DDD-T11).
export function createKeyboard(target = window) {
  const held = new Set(), pressed = new Set(), unseen = new Set(), releaseAfterStep = new Set();
  const typed = [];

  target.addEventListener('keydown', e => {
    if (preventsDefault(e)) e.preventDefault();
    if (!e.repeat && !isChord(e)) typed.push({ key: e.key });
    if (isScripted(e) || isShortcut(e)) return;       // the positions leave a script's keys and browser shortcuts alone
    if (!e.repeat) { pressed.add(e.code); unseen.add(e.code); }
    held.add(e.code);
  });
  target.addEventListener('keyup', e => {
    if (isScripted(e)) return;                        // nor can a script release a key a person holds
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
    // Keyups never arrive while the window is unfocused, so forget everything on blur, and drop the presses not yet taken:
    // one typed as the window was left never turns up when the player comes back (DDD-T1).
    releaseAll() { held.clear(); unseen.clear(); releaseAfterStep.clear(); typed.length = 0; },
  };
}
