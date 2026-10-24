import { STEP, MAX_FRAME } from './game/config.js';
import { createKeyboard } from './platform/input.js';
import { g, update, handlePresses, pause, takeEvents, applySettings, applyBestStore, applyLeaderboard } from './game/game.js';
import { createRenderer } from './view/render.js';
import { createStatus } from './view/status.js';
import { createSynth } from './sound/synth.js';
import { createSoundDirector } from './sound/director.js';
import { loadSettings, saveSetting, loadBest, saveBest } from './platform/storage.js';
import { createLeaderboard } from './platform/leaderboard.js';
import { GameEvent } from './game/events.js';

const keyboard = createKeyboard(window);
const renderer = createRenderer(document.getElementById('game'));
const syncStatus = createStatus(document.getElementById('status'));

// Sound: the rules publish events, the director turns them into cues, the synth plays them.
// Browsers only allow audio after a key press, so the first keydown unlocks it.
const synth = createSynth({
  createContext: () => new (window.AudioContext || window.webkitAudioContext)(),
  now: () => performance.now(),
  setInterval: (callback, ms) => window.setInterval(callback, ms),
  clearInterval: id => window.clearInterval(id),
});
applySettings(loadSettings());   // before the first frame; g.settings is the one authority from here on
applyBestStore({ load: loadBest, save: saveBest });   // the best score is read now and written when a game ends on a new best
const director = createSoundDirector({ ...g.settings });

// The shared high-score table. If it can't be reached the game plays exactly as it does without one: the rules
// keep it unknown, so nobody is asked for initials, and a signing that doesn't arrive is simply not shown.
const leaderboard = createLeaderboard(fetch);
const ignore = () => {};
leaderboard.load().then(scores => applyLeaderboard(scores), ignore);
const signTable = ({ initials, score }) =>
  leaderboard.sign({ initials, score }).then(({ scores, id }) => applyLeaderboard(scores, id), ignore);
addEventListener('keydown', () => synth.unlock());
window.makeTheRightMove = Object.freeze({ audio: synth.diagnostics });

// A toggle is saved as it is taken, so the choice is there on the next visit.
const SAVED_WHEN_TOGGLED = { [GameEvent.SOUND_TOGGLED]: 'sound', [GameEvent.MUSIC_TOGGLED]: 'music' };

function handleEvents() {
  for (const event of takeEvents()) {
    const setting = SAVED_WHEN_TOGGLED[event.type];
    if (setting) saveSetting(setting, event.on);
    if (event.type === GameEvent.INITIALS_ENTERED) signTable(event);
    for (const cue of director.handle(event)) synth.perform(cue);
  }
}

// Pausing a hidden or unfocused game must be heard at once: a hidden tab gets no more frames to carry the cues.
function leaveGame() {
  keyboard.releaseAll();   // keyups never arrive while the window is unfocused or hidden
  pause();
  handleEvents();
}

const MIN_DESKTOP_WIDTH = 640;   // px

// Desktop only: touch-first devices and narrow windows get a "needs a keyboard" screen.
function checkDevice() {
  const noKeyboard = matchMedia('(hover: none) and (pointer: coarse)').matches || innerWidth < MIN_DESKTOP_WIDTH;
  document.body.classList.toggle('no-keyboard', noKeyboard);
}

function onResize() { renderer.resize(); checkDevice(); }
addEventListener('resize', onResize);
addEventListener('blur', leaveGame);
document.addEventListener('visibilitychange', () => { if (document.hidden) leaveGame(); });
onResize();

// Fixed-step simulation, render once per display frame.
let last = 0, acc = 0;
function frame(now) {
  const dt = last ? Math.min((now - last) / 1000, MAX_FRAME) : 0;
  last = now;
  handlePresses(keyboard.takePressed());
  if (!g.paused) {
    acc += dt;
    while (acc >= STEP) { update(STEP, keyboard); keyboard.endStep(); acc -= STEP; }
  }
  handleEvents();
  renderer.draw();
  syncStatus(g);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
