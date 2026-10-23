import { STEP, MAX_FRAME } from './config.js';
import { createKeyboard } from './input.js';
import { g, update, handlePresses, pause, takeEvents, applySettings } from './game.js';
import { createRenderer } from './render.js';
import { createStatus } from './status.js';
import { createSynth } from './synth.js';
import { createSoundDirector } from './sound.js';
import { loadSettings, saveSetting } from './storage.js';
import { GameEvent } from './events.js';

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
const director = createSoundDirector({ ...g.settings });
addEventListener('keydown', () => synth.unlock());
window.makeTheRightMove = Object.freeze({ audio: synth.diagnostics });

// A toggle is saved as it is taken, so the choice is there on the next visit.
function playSounds() {
  for (const event of takeEvents()) {
    if (event.type === GameEvent.SOUND_TOGGLED) saveSetting('sound', event.on);
    for (const cue of director.handle(event)) synth.perform(cue);
  }
}

// Desktop only: touch-first devices and narrow windows get a "needs a keyboard" screen.
function checkDevice() {
  const noKeyboard = matchMedia('(hover: none) and (pointer: coarse)').matches || innerWidth < 640;
  document.body.classList.toggle('no-keyboard', noKeyboard);
}

function onResize() { renderer.resize(); checkDevice(); }
addEventListener('resize', onResize);
addEventListener('blur', () => { keyboard.releaseAll(); pause(); });
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
  playSounds();
  renderer.draw();
  syncStatus(g);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
