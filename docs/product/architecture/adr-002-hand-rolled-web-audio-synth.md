# ADR-002: A small hand-rolled Web Audio synth with data recipes

**Status**: Accepted (2026-10-23, revision 3) · **Feature**: rightmove-invaders-sound

## Context
DISCUSS locked synthesised chiptune (D1) and no new runtime dependencies (DoD 9). The feature needs five effects (shot, hurdle hit, house hit, bolt stopped, home lost), a four-note march, five jingles including the Dream Home siren, and one music loop, all tuned by ear, so they must be easy to read and tweak.

## Decision
`src/synth.js` is an adapter that performs **resource operations only**. It never decides *when* to play; that is the sound director's job (DDD-4).
- `createSynth({ recipes?, createContext, now, setInterval, clearInterval })` → `{ unlock(), perform(cue), diagnostics }`. Platform capabilities are **injected** and wired in `main.js`: no ambient globals in the adapter. A cue is one of `play`, `startLoop`, `stopLoop`, `startMusic`, `stopMusic`, `silence` (vocabulary in `src/events.js`). Each operation's delta, its idempotence (stop when stopped and start when started are no-ops) and the state transitions are in the feature delta's synth operation table.
- Recipes are plain data in `src/theme.js`: waveform, start and end pitch, envelope, duration, optional noise. Jingles and music are note sequences.
- Each sound is a set of short-lived oscillator and gain nodes; noise comes from **one shared noise buffer**. Effects and music each have a bus, with music at least 6 dB below effects. There is no master mute: muting is the director sending `silence` (DDD-8).
- A **voice cap of 8** (oldest cut first) is an adapter resource limit.
- A named loop (the Dream Home siren) can be started and stopped. The music runs on a look-ahead scheduler: a 25 ms timer schedules notes up to 100 ms ahead of the audio clock, and never before its current time. In tests the timer is fast-forwarded by Playwright's clock while the audio clock runs on real time (verified), so no backlog can build up.
- The AudioContext is created and resumed only inside a keydown handler (`unlock()`, idempotent). If the browser suspends it later, it is resumed on the next keydown (window focus is not a user gesture). Without Web Audio, or if creating it throws, the state is `unavailable`. While `locked`, `suspended` or `unavailable`, `perform()` changes nothing and writes no journal entry.
- Budget: the whole sound path stays ≤ 0.5 ms per frame: p95 in Chromium, mean in Firefox and WebKit, whose timers round to 1 ms (DDD-12, K6).

## Alternatives considered
- **ZzFX / ZzFXM** (very small, MIT; size not measured, roughly 1 KB): great 8-bit results, but sounds are opaque 20-number arrays and it adds a dependency even if vendored.
- **Tone.js** (a full music framework; size not measured, hundreds of KB): far beyond this game's needs.
- **Audio files**: rejected in DISCUSS (D1).

## Consequences
- A small module we own (an estimate, not a measurement: a few hundred lines). Sound design lives next to the other theme data.
- We own the quality risks: clicks (avoided with short attack and release ramps), voice limits, scheduling. Slice 01's learning hypothesis checks them in all three engines; listening under stress is a manual check (D10).

## Amendment (DELIVER, 2026-10-24)
- While `suspended`, the stop operations (`stopLoop`, `stopMusic`, `silence`) now act as they do when running; `play`, `startLoop` and `startMusic` still do nothing. Dropping stops while suspended left a stale siren or music to return on resume, because the director had already forgotten them. Nothing acts while `locked` or `unavailable`.
- If the audio graph throws inside `perform()` or the music timer, the synth stops what it can and goes `unavailable` for good, silently, so the failure never reaches the game loop.
- See `docs/feature/rightmove-invaders-sound/feature-delta.md`, "Wave: DELIVER / [REF] Changed assumptions".
