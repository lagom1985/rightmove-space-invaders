# Slice 03: The marching beat

**Story**: US-03 | **Job**: J-SOUND-TENSION | **Estimate**: ≤ 1 day (about 4 h) | **Order**: 3rd

## Goal
The formation marches to a four-note bass beat, one note per step, so it speeds up exactly as the formation does.

## IN scope
- One bass note per formation step, cycling four descending notes.
- Tempo comes from the formation's own steps: 0.53 s ± 10% with 55 hurdles, 0.12 s ± 10% with 10 left (first wave).
- Silent while paused (P, Esc, switching window, hiding the tab: at once), while the pin respawns, during the "Wave cleared!" banner and after game over.

## OUT of scope
- Background music (slice 06), other effects.

## Learning hypothesis
- **Disproves** "driving the beat from the fixed-step formation keeps it in time on 60, 100 and 120 Hz displays and under load" if notes drift, double up or stutter.
- **Confirms** the beat alone creates rising tension (playtest K2).

## Acceptance criteria
US-03 in [feature-delta.md](../feature-delta.md); scenarios in `milestone-3-marching-beat.feature`.

## Production data and dogfood
Real waves cleared from 55 down to 0 hurdles. Dogfood: clear a wave and listen to the speed-up; switch tab mid-wave; pause and resume.

## Dependencies
- Slice 01 (audio path); slice 02 (the beat respects mute).

## Reference class
Similar to the formation stepping in the probe, about half a day.
