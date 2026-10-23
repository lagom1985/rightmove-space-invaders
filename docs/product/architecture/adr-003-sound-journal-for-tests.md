# ADR-003: Tests observe sound through the synth's read-only journal

**Status**: Accepted (2026-10-23, revision 3) · **Feature**: rightmove-invaders-sound

## Context
Acceptance tests can't hear. The feature's walking skeleton must still run the real Web Audio path (no mock of the audio output). Assertions must survive sound tuning: "a hurdle-hit for £300 started", not "an 880 Hz square wave started".

## Decision
- After `src/synth.js` has successfully started the nodes for a `play` or `startLoop` cue, it appends `{ seq, sound, detail, t, at }` to a bounded journal (the last 100 entries). `seq` increases by one per entry and never repeats, so readers use it, not the array index, as a cursor. `detail` is the semantic payload (for example `value` for a hurdle hit, `note` 0–3 for the march), `t` is the cue's simulation time and `at` is `performance.now()`.
- `synth.diagnostics` is **data only**: getters that return frozen copies, with no functions:
  - `state`: `'locked'` | `'running'` | `'suspended'` | `'unavailable'`
  - `journal`
  - `music`: `'playing'` | `'stopped'`
  - `voices` (now) and `peakVoices` (highest so far)
- `src/main.js` exposes it as a frozen `window.makeTheRightMove = { audio: diagnostics }`. The game never exposes the synth's write side (`perform`, `unlock`).
- Muted or paused sounds are never started, so they never reach the journal; neither does anything performed while the synth is `locked`, `suspended` or `unavailable`.
- That the handle can't be written through is checked by a DELIVER contract test (a developer contract, not a player scenario).

## Alternatives considered
- **Spying on Web Audio from the test** (an init script wrapping `AudioScheduledSourceNode.start`): no code in the game, but sounds could only be recognised by frequency or waveform, which breaks on every retune.
- **Sound captions in the accessible status region**: testable and accessible, but out of scope in DISCUSS and far too chatty for screen-reader users (dozens of shots per wave).
- **Measuring output energy** (`AnalyserNode`): proves *something* is audible, not *which* sound, and the audio clock runs on real time while tests fast-forward the fake clock. The same reason rules it out for checking loudness or clipping in tests (D10 makes those manual).

## Consequences
- Tests assert on meaning (`shot`, `hurdle-hit` with `value: 300`, `march` with `note: 2`) and on absence (nothing logged before the first key, while muted, or while paused). They first check that the handle exists, so a page with no sound system can't pass a silence check.
- An entry exists only if the real Web Audio calls succeeded, so the walking skeleton proves the real path.
- K5 is measurable: `at` versus the key-press time, both on the page clock (injected `now`), must be ≤ 17 ms; under the fake clock this is a bounded ordering check.
- **Negative**: the journal proves a sound *started*, not that it was *audible* (gain, clipping, a silent output device). Audibility is covered by manual checks and the playtest (D10).
- One small, deliberate, read-only public surface. The synth-only test page (`tests/.../fixtures/synth-host.html`) exposes `window.synth` as a test-only hook; the game never does.
