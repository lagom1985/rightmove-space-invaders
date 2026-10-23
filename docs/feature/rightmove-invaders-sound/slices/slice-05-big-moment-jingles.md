# Slice 05: Big-moment jingles

**Story**: US-05 | **Job**: J-SOUND-CELEBRATION | **Estimate**: ≤ 1 day (about 4 h) | **Order**: 5th

## Goal
The game's big moments have their own short jingles: a doorbell to start, a siren while the Dream Home flies over, a "ka-ching" when it's saved, a fanfare for a cleared wave and a sad tune on game over.

## IN scope
- A "ding-dong" doorbell when a game starts.
- A warbling siren looping while the Dream Home is on screen; it stops when the Dream Home leaves, is saved, the wave is cleared or the game ends, and pauses and resumes with the game.
- A "ka-ching" arpeggio when the Dream Home is saved (in time with "+£1,500").
- A rising fanfare during the "Wave cleared!" banner (≤ 2.4 s).
- A descending tune on game over ("Offer rejected" and "Gazumped!").
- All of them respect mute and pause.

## OUT of scope
- Background music (slice 06), new on-screen content.

## Learning hypothesis
- **Disproves** "short jingles make big moments feel rewarding without slowing play" if playtesters find them long, can't name the outcome from the jingle (K8), or skip the Dream Home even when they hear it.

## Acceptance criteria
US-05 in [feature-delta.md](../feature-delta.md); scenarios in `milestone-5-jingles.feature`.

## Production data and dogfood
Real Dream Home flyovers and real wave clears. Dogfood: save a Dream Home and clear wave 1.

## Dependencies
- Slices 01, 02 (mute) and 03 (the fanfare and siren must sit well with the beat).

## Reference class
Slice 04's effects, but sequenced notes, about half a day.
