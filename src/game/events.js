// The sound feature's vocabulary, declared once (ADR-001, ADR-003):
// GameEvent: what the rules publish through the outbox.
// CueOp / Sound: what the sound director asks the synth to do, and the names the synth's journal uses.

export const GameEvent = Object.freeze({
  GAME_STARTED: 'gameStarted', SHOT_FIRED: 'shotFired', HURDLE_HIT: 'hurdleHit', SHIELD_HIT: 'shieldHit',
  BOLT_STOPPED: 'boltStopped', HOME_LOST: 'homeLost', FORMATION_STEPPED: 'formationStepped',
  DREAM_APPEARED: 'dreamAppeared', DREAM_GONE: 'dreamGone', DREAM_SAVED: 'dreamSaved',
  WAVE_CLEARED: 'waveCleared', GAME_OVER: 'gameOver', PAUSED: 'paused', RESUMED: 'resumed',
  SOUND_TOGGLED: 'soundToggled', MUSIC_TOGGLED: 'musicToggled',
});

export const CueOp = Object.freeze({
  PLAY: 'play', START_LOOP: 'startLoop', STOP_LOOP: 'stopLoop',
  START_MUSIC: 'startMusic', STOP_MUSIC: 'stopMusic', SILENCE: 'silence',
});

export const Sound = Object.freeze({
  SHOT: 'shot', HURDLE_HIT: 'hurdle-hit', SHIELD_HIT: 'shield-hit', BOLT_STOPPED: 'bolt-stopped',
  HOME_LOST: 'home-lost', MARCH: 'march', DOORBELL: 'doorbell', SIREN: 'siren',
  KA_CHING: 'ka-ching', FANFARE: 'fanfare', GAME_OVER: 'game-over',
});
