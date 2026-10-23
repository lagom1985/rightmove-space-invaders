# Slice 06: Background music

**Story**: US-06 | **Job**: J-SOUND-ATMOSPHERE | **Estimate**: ≤ 1 day (≤ 5 h including tuning) | **Order**: 6th (droppable with slice 07)

## Goal
A quiet chiptune loop plays under the effects during a game.

## IN scope
- One seamless chiptune loop (16–32 bars), set at least 6 dB below the effects, in a key that fits the beat's notes.
- Starts with the game; pauses and resumes with it; stops on game over.

## OUT of scope
- The N toggle (slice 07), more than one track, music on the title screen (that would be a new story), a settings menu.

## Learning hypothesis
- **Disproves** "background music adds to the fun without masking the marching beat" if K4 fails: below 40% keeping it on drops the music; 40–60% means re-tune once and repeat the playtest (D12).

## Acceptance criteria
US-06 in [feature-delta.md](../feature-delta.md); scenarios in `milestone-6-music.feature`. The loop seam is a manual check (D10).

## Production data and dogfood
Real sessions of 5+ minutes. Dogfood: play three waves with music.

## Dependencies
- Slices 01–03 (audio path, mute, beat to mix against).

## Reference class
New musical content, the most taste-driven slice: about 3 h of building plus up to 2 h of tuning.
