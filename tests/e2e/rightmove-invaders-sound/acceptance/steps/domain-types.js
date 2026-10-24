// The sound feature's test vocabulary. Event, cue and sound names come from the game's own
// single declaration (src/game/events.js); the rest are test-side domain values.
export { GameEvent, CueOp, Sound } from '../../../../../src/game/events.js';

export const Key = Object.freeze({ ENTER: 'Enter', SPACE: 'Space', M: 'KeyM', N: 'KeyN', P: 'KeyP', ESCAPE: 'Escape', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight' });

export const Screen = Object.freeze({ TITLE: 'title', PAUSE: 'pause', GAME_OVER: 'game over' });

export const Setting = Object.freeze({ SOUND: 'sound', MUSIC: 'music' });

export const AudioState = Object.freeze({ LOCKED: 'locked', RUNNING: 'running', UNAVAILABLE: 'unavailable', ABSENT: 'absent' });

export const Announcement = Object.freeze({ GAME_STARTED: 'Game started', HOME_LOST: 'Home lost', GAME_OVER: 'Game over' });
