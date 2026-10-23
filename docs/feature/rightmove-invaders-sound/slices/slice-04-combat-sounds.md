# Slice 04: Combat sounds

**Story**: US-04 | **Job**: J-SOUND-FEEDBACK | **Estimate**: ≤ 1 day (about 3 h) | **Order**: 4th

## Goal
The player can tell by ear when a house is hit, when they lose a home, and when their shot stops a bolt.

## IN scope
- A thud when a house is hit, by the player's shot or by a bolt, at most one every 50 ms of game time (7 hits 20 ms apart → 3 thuds at 0, 60, 120 ms; the others are dropped, not queued).
- A falling explosion (about 1 s) when a home is lost.
- A "tink" when a shot destroys an enemy bolt.
- All of them respect mute.

## OUT of scope
- Jingles (slice 05), music (slice 06).

## Learning hypothesis
- **Disproves** "distinct short effects plus the rate limit and voice cap keep a busy screen readable by ear" if playtesters describe the stress scene as noise or can't name what happened.

## Acceptance criteria
US-04 in [feature-delta.md](../feature-delta.md); scenarios in `milestone-4-combat-sounds.feature`. Listening under the stress load (40 bolts, about 3,000 particles) is a manual check (D10).

## Production data and dogfood
Real waves at Country pile, where up to 7 bolts fall at once; the spike's stress mode as the load case. Dogfood: survive a Country pile wave with sound on.

## Dependencies
- Slices 01, 02 (mute) and 03 (the beat stops while respawning).

## Reference class
Slice 01's effects, three more recipes, about 3 h.
