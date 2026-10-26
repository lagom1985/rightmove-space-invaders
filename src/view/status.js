import { ladderName, pounds } from '../theme/theme.js';
import { INITIALS_REFUSED, PLAY_AGAIN_SENTENCE, SIGNING_MESSAGES, TABLE_UNAVAILABLE } from './messages.js';
import { INITIALS_LENGTH } from '../game/high-scores.js';

const SETTING_MESSAGES = {
  sound: { on: 'Sound on.', off: 'Sound off. Press M to turn it on.' },
  music: { on: 'Music on.', off: 'Music off. Press N to turn it on.' },
};

const INITIALS_HELP = 'New high score! Enter your initials: type 3 letters, then press Enter to sign.';
const NO_ROWS = Object.freeze([]);

// What game over says about the table (DISTILL, Messages): only that it can't be reached. While it is unknown (at most
// 5 s after a load starts) nothing at all, and while it is available its rows say it.
const tableLine = g => (g.state === 'over' && g.table.status === 'unavailable' ? TABLE_UNAVAILABLE : '');

// The letters typed, spaced so a screen reader spells them (no underscores: they are read inconsistently), and the next
// one to type, or Enter once all three are in: 'No letters yet, letter 1 of 3', 'A L, letter 3 of 3',
// 'A L X, press Enter to sign'.
function initialsField({ letters }) {
  if (!letters) return `No letters yet, letter 1 of ${INITIALS_LENGTH}`;
  const spelled = [...letters].join(' ');
  return letters.length < INITIALS_LENGTH ? `${spelled}, letter ${letters.length + 1} of ${INITIALS_LENGTH}` : `${spelled}, press Enter to sign`;
}

// While the initials are being entered, Enter signs them; once they're signed it starts a new game again. Only a
// signing made at this game over is described, and only while it is on its way: its outcome is announced on its own.
function gameOverAnnouncement(g) {
  if (g.signedThisGame) return g.signing.status === 'pending' ? `${SIGNING_MESSAGES.pending(g.signing)} ${PLAY_AGAIN_SENTENCE}` : PLAY_AGAIN_SENTENCE;
  return [`Game over: ${g.overReason.replace(/[^.!?]$/, '$&.')} Deposit saved ${pounds(g.score)}.`, g.newBest ? 'New best!' : '',
    tableLine(g), g.initials ? INITIALS_HELP : PLAY_AGAIN_SENTENCE].filter(Boolean).join(' ');
}

// Mirrors the canvas HUD, the high-score table and big moments into the DOM, so screen readers (and tests, which
// can't read pixels) can follow the game. Only writes to the DOM when something changed.
export function createStatus(root) {
  const fields = {};
  for (const el of root.querySelectorAll('[data-hud]')) fields[el.dataset.hud] = el;
  const table = root.querySelector('[data-leaderboard]');
  const shown = {};
  let last = { state: null, paused: false, entering: false, field: '', line: '', settings: null, rows: NO_ROWS, mine: null, settled: null };

  // `always` writes even the same words again: two outcomes can read alike, and each is announced.
  function set(name, value, always = false) {
    if (shown[name] === value && !always) return;
    shown[name] = value;
    fields[name].textContent = value;
  }

  function announcement(g) {
    if (g.paused) return 'Paused. Press P to resume.';
    switch (g.state) {
      case 'title': return 'Press Enter to start. Move with the arrow keys or A and D, fire with Space, pause with P.';
      case 'play':
        if (last.state === 'clear') return `Now on the property ladder at ${ladderName(g.level)}.`;
        return last.state === 'dead' || last.paused ? '' : 'Game started. Defend your dream home from the hurdles.';
      case 'dead': return g.lives ? `Home lost. ${g.lives} left.` : 'Home lost. No homes left.';
      case 'clear': return `Wave cleared! Moving up the ladder to ${ladderName(g.level + 1)}.`;
      case 'over': return gameOverAnnouncement(g);
    }
  }

  // One item per row while the table is available, the confirmed current signing's marked as mine; rewritten only when
  // the rules have taken in a new table or the mark has moved.
  function showHighScores(rows, mine) {
    if (rows === last.rows && mine === last.mine) return;
    table.replaceChildren(...rows.map(({ initials, score, id }) => {
      const item = root.ownerDocument.createElement('li');
      item.textContent = `${initials} ${pounds(score)}`;
      if (id === mine) item.setAttribute('aria-current', 'true');
      return item;
    }));
  }

  // Each change of the letters once, while the entry is open (the prompt announced its opening), the refusal first. The
  // rules take a frame's typed presses together, so letters typed within one frame are heard as the field they leave.
  const initialsAnnouncement = (g, field) => {
    if (!g.initials || !last.entering || field === last.field) return '';
    return g.initials.notice?.kind === 'refused' ? `${INITIALS_REFUSED} ${field}` : field;
  };

  // The table line on its own, once, when the table turns unavailable on the game-over screen; game over itself says it
  // when it is unavailable already.
  const tableAnnouncement = (line, changed) => (!changed && line !== last.line ? line : '');

  // Each settled outcome once, when it arrives, in any game state.
  const outcomeAnnouncement = settled => (settled && settled.n !== last.settled ? SIGNING_MESSAGES[settled.outcome](settled) : '');

  // Only a change is announced: the settings loaded at page load are shown but not spoken.
  function settingAnnouncements(g) {
    if (!last.settings) return [];
    return Object.keys(SETTING_MESSAGES)
      .filter(name => g.settings[name] !== last.settings[name])
      .map(name => SETTING_MESSAGES[name][g.settings[name] ? 'on' : 'off']);
  }

  // The canvas HUD's fields, as it shows them.
  function showHud(g) {
    set('deposit', pounds(g.score));
    set('ladder', ladderName(g.level));
    set('best', pounds(Math.max(g.best, g.score)));
    set('homes', String(g.lives));
    set('sound', g.settings.sound ? 'On' : 'Off');
    set('music', g.settings.music ? 'On' : 'Off');
  }

  return function sync(g) {
    showHud(g);
    const rows = g.table.status === 'available' ? g.table.rows : NO_ROWS;
    const mine = g.signing?.id ?? null;   // the current signing's row: its id is set once it is confirmed
    showHighScores(rows, mine);
    const field = g.initials ? initialsField(g.initials) : '';
    set('initials', field);
    const entering = g.initials !== null;
    const changed = g.state !== last.state || g.paused !== last.paused || entering !== last.entering;
    const line = tableLine(g);
    const spelled = initialsAnnouncement(g, field);
    const outcome = outcomeAnnouncement(g.settled);
    const message = [changed ? announcement(g) : '', tableAnnouncement(line, changed), spelled, outcome, ...settingAnnouncements(g)]
      .filter(Boolean).join(' ');
    if (message) set('announcement', message, Boolean(outcome));
    last = { state: g.state, paused: g.paused, entering, field, line, settings: { ...g.settings }, rows, mine, settled: g.settled?.n ?? null };
  };
}
