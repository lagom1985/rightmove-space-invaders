import { defineParameterType } from 'playwright-bdd';
import { Sound, GameEvent, Key, Screen, Setting } from './domain-types.js';

// Business phrases in the .feature files -> typed domain values.
const SOUND_PHRASES = {
  'a shot': Sound.SHOT, 'a house being hit': Sound.SHIELD_HIT, 'a bolt being stopped': Sound.BOLT_STOPPED,
  'an explosion': Sound.HOME_LOST, 'a beat note': Sound.MARCH, 'the doorbell': Sound.DOORBELL,
  'ka-ching': Sound.KA_CHING, 'the wave-cleared fanfare': Sound.FANFARE, 'the game-over tune': Sound.GAME_OVER,
};

const GAME_EVENT_PHRASES = {
  'a new game': GameEvent.GAME_STARTED, 'a shot': GameEvent.SHOT_FIRED, 'a bolt being stopped': GameEvent.BOLT_STOPPED,
  'a home being lost': GameEvent.HOME_LOST, 'a formation step': GameEvent.FORMATION_STEPPED,
  'the Dream Home appearing': GameEvent.DREAM_APPEARED, 'the Dream Home leaving': GameEvent.DREAM_GONE,
  'the Dream Home being saved': GameEvent.DREAM_SAVED, 'a wave being cleared': GameEvent.WAVE_CLEARED,
  'game over': GameEvent.GAME_OVER, 'a pause': GameEvent.PAUSED, 'play resuming': GameEvent.RESUMED,
};

const KEY_PHRASES = { M: Key.M, N: Key.N, P: Key.P, Escape: Key.ESCAPE, Space: Key.SPACE };
const SCREEN_PHRASES = { title: Screen.TITLE, pause: Screen.PAUSE, 'game over': Screen.GAME_OVER };
const SETTING_PHRASES = { sound: Setting.SOUND, music: Setting.MUSIC };
const ORDINALS = { first: 0, second: 1, third: 2, fourth: 3 };   // houses, counted from the left

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const oneOf = phrases => new RegExp(Object.keys(phrases).sort((a, b) => b.length - a.length).map(escape).join('|'));
const phraseType = (name, phrases) => defineParameterType({ name, regexp: oneOf(phrases), transformer: s => phrases[s] });

phraseType('sound', SOUND_PHRASES);
phraseType('gameEvent', GAME_EVENT_PHRASES);
phraseType('key', KEY_PHRASES);
phraseType('screen', SCREEN_PHRASES);
phraseType('setting', SETTING_PHRASES);
phraseType('house', ORDINALS);
phraseType('onOff', { on: true, off: false });
phraseType('loopState', { looping: true, stopped: false });
phraseType('musicState', { playing: true, stopped: false });
defineParameterType({ name: 'pounds', regexp: /£[\d,]+/, transformer: s => Number(s.replace(/[£,]/g, '')) });
defineParameterType({ name: 'seconds', regexp: /\d+(?:\.\d+)?/, transformer: s => Number(s) * 1000 });   // -> ms
