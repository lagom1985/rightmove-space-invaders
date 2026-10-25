import { ladderName, pounds } from '../theme/theme.js';

const SETTING_MESSAGES = {
  sound: { on: 'Sound on.', off: 'Sound off. Press M to turn it on.' },
  music: { on: 'Music on.', off: 'Music off. Press N to turn it on.' },
};

const INITIALS_HELP = 'New high score! Enter your initials: Up and Down change the letter, Enter takes it.';
const NO_ROWS = Object.freeze([]);

// The letters spaced, so a screen reader spells them, and the one being chosen: 'F A A, letter 2 of 3'.
const initialsField = ({ letters, index }) => `${letters.join(' ')}, letter ${index + 1} of ${letters.length}`;

// While the initials are being entered, Enter takes a letter; once they're signed it starts a new game again.
function gameOverAnnouncement(g) {
  if (g.signed) return `Signed ${g.signed.initials}. Press Enter to house-hunt again.`;
  return `Game over: ${g.overReason.replace(/[^.!?]$/, '$&.')} Deposit saved ${pounds(g.score)}.` +
    (g.newBest ? ' New best!' : '') + (g.initials ? ` ${INITIALS_HELP}` : ' Press Enter to house-hunt again.');
}

// Mirrors the canvas HUD, the high-score table and big moments into the DOM, so screen readers (and tests, which
// can't read pixels) can follow the game. Only writes to the DOM when something changed.
export function createStatus(root) {
  const fields = {};
  for (const el of root.querySelectorAll('[data-hud]')) fields[el.dataset.hud] = el;
  const table = root.querySelector('[data-leaderboard]');
  const shown = {};
  let last = { state: null, paused: false, entering: false, settings: null, rows: NO_ROWS };

  function set(name, value) {
    if (shown[name] === value) return;
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

  // One item per row while the table is available, rewritten only when the rules have taken in a new table.
  function showHighScores(rows) {
    if (rows === last.rows) return;
    table.replaceChildren(...rows.map(({ initials, score }) => {
      const item = root.ownerDocument.createElement('li');
      item.textContent = `${initials} ${pounds(score)}`;
      return item;
    }));
  }

  // Only a change is announced: the settings loaded at page load are shown but not spoken.
  function settingAnnouncements(g) {
    if (!last.settings) return [];
    return Object.keys(SETTING_MESSAGES)
      .filter(name => g.settings[name] !== last.settings[name])
      .map(name => SETTING_MESSAGES[name][g.settings[name] ? 'on' : 'off']);
  }

  return function sync(g) {
    set('deposit', pounds(g.score));
    set('ladder', ladderName(g.level));
    set('best', pounds(Math.max(g.best, g.score)));
    set('homes', String(g.lives));
    set('sound', g.settings.sound ? 'On' : 'Off');
    set('music', g.settings.music ? 'On' : 'Off');
    const rows = g.table.status === 'available' ? g.table.rows : NO_ROWS;
    showHighScores(rows);
    set('initials', g.initials ? initialsField(g.initials) : '');
    const entering = g.initials !== null;
    const changed = g.state !== last.state || g.paused !== last.paused || entering !== last.entering;
    const message = [changed ? announcement(g) : '', ...settingAnnouncements(g)].filter(Boolean).join(' ');
    if (message) set('announcement', message);
    last = { state: g.state, paused: g.paused, entering, settings: { ...g.settings }, rows };
  };
}
