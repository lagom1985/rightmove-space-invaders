import { ladderName, pounds } from './theme.js';

const SETTING_MESSAGES = {
  sound: { on: 'Sound on.', off: 'Sound off. Press M to turn it on.' },
  music: { on: 'Music on.', off: 'Music off. Press N to turn it on.' },
};

// Mirrors the canvas HUD and big moments into the DOM, so screen readers (and tests, which
// can't read pixels) can follow the game. Only writes to the DOM when something changed.
export function createStatus(root) {
  const fields = {};
  for (const el of root.querySelectorAll('[data-hud]')) fields[el.dataset.hud] = el;
  const shown = {};
  let last = { state: null, paused: false, settings: null };

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
      case 'over':
        return `Game over: ${g.overReason.replace(/[^.!?]$/, '$&.')} Deposit saved ${pounds(g.score)}.` +
          (g.newBest ? ' New best!' : '') + ' Press Enter to house-hunt again.';
    }
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
    const changed = g.state !== last.state || g.paused !== last.paused;
    const message = [changed ? announcement(g) : '', ...settingAnnouncements(g)].filter(Boolean).join(' ');
    if (message) set('announcement', message);
    last = { state: g.state, paused: g.paused, settings: { ...g.settings } };
  };
}
