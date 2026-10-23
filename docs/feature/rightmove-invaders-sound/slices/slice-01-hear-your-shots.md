# Slice 01: Hear your shots (feature walking skeleton)

**Story**: US-01 | **Job**: J-SOUND-FEEDBACK | **Estimate**: ≤ 1 day (about 4 h) | **Order**: 1st

## Goal
Pressing Space makes a "pew", and hitting a hurdle makes a "pop", through the real browser audio output.

## IN scope
- Shots and hurdle hits make sounds through the real browser audio output (DESIGN: the walking skeleton through the event outbox, sound director and synth).
- Unlock audio on the first key press (browser autoplay rules).
- Two effects: shot fired; hurdle hit (pitch rises with the hurdle's value: Damp £50 lowest, Gazumper £300 highest).
- A cap of 8 overlapping voices; a silent fallback when sound is unavailable.

## OUT of scope
- Mute key (slice 02), every other sound (slices 03–07), volume control.

## Learning hypothesis
- **Disproves** "synthesised Web Audio can sound on every shot in the same frame, with no clicks or errors, in Chrome, Firefox and Safari, unlocked by the first key press" if any engine lags, clicks or stays silent.
- **Confirms** the end-to-end path keyboard → rules → director → synth → speakers that every later slice reuses.

## Acceptance criteria
US-01 in [feature-delta.md](../feature-delta.md); scenarios in `walking-skeleton.feature` and `milestone-1-shots-and-hits.feature`.

## Production data and dogfood
Real gameplay, real page, real speakers. Dogfood: play one full wave in each browser with sound on, the same day.

## Dependencies
- The game walking skeleton (commit 57d9c21).

## Reference class
Same size as the walking skeleton's split into modules, about half a day.
