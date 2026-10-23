# ADR-001: Game rules publish events through an outbox they own

**Status**: Accepted (2026-10-23, revision 3) · **Feature**: rightmove-invaders-sound

## Context
Sound has to react to moments inside the simulation (shots, hits, formation steps, the Dream Home, wave and game outcomes), sometimes several in one frame, and needs details such as a hurdle's value. The game rules (`src/game.js`) should not depend on audio.

## Decision
- `src/game.js` keeps a private outbox. Rules call `emit({ type, t, ...detail })` at the point where they already handle each moment; `takeEvents()` returns the pending list and clears it. Only `game.js` mutates the outbox.
- Event types are declared once in `src/events.js` (`GameEvent`), which the rules, the sound director and the tests all import.
- `src/main.js` calls `takeEvents()` once per frame, after the simulation steps and before rendering, and hands the events to the sound director. On window `blur` or a hidden tab, it calls `pause()` and then `takeEvents()` straight away, because a hidden tab stops `requestAnimationFrame`.
- The rules' only new import is `src/events.js` (pure constants; accepted). Settings are loaded and saved in `main.js` and handed to the rules through `applySettings({ sound, music })`, so only `game.js` ever writes `g`.

## Alternatives considered
- **State diffing** (the way `src/status.js` mirrors the HUD): no changes to the rules. But it loses events that start and end between two frames, merges several hits into one score change, and can't tell which hurdle was hit.
- **Direct calls** (`audio.play('shot')` from the rules): the simplest, but it couples the rules to audio, and every rule test would need an audio stand-in.
- **An event emitter with subscribers inside `game.js`**: works, but adds subscriber management to the rules for one consumer.
- **`main.js` reading `g.events` directly**: rejected in revision 2, because it lets the wiring layer mutate rule state.

## Consequences
- Each new sound-worthy moment is one `emit` at an existing branch (the emit sites are listed in the feature delta).
- Events reach consumers within the frame they happened, or immediately on blur or hidden tab.
- `takeEvents()` must be called every frame, including while paused, so the outbox can't grow without bound.
- **Accepted exceptions** in the rules' imports: `storage.js` for the best score (pre-existing) and `events.js` (pure constants). New persistence goes through `main.js`.
