# Slice 07: Turn just the music off with N

**Story**: US-07 | **Job**: J-SOUND-CONTROL | **Estimate**: ≤ 1 day (about 2 h) | **Order**: 7th (dropped with slice 06)

## Goal
N turns only the music off or on, the game shows and announces it, and remembers it next visit.

## IN scope
- N toggles music on every screen; "MUSIC OFF" in the HUD; "N music" in the controls line; announcement "Music off. Press N to turn it on."
- Saved across visits; defaults to on, including when saved settings are unavailable.
- M still silences everything; unmuting brings music back only if it is on.

## OUT of scope
- Volume control, per-sound toggles.

## Learning hypothesis
- **Disproves** "a separate music switch is enough for players who don't like the music" if playtesters who turn music off also mute everything with M.

## Acceptance criteria
US-07 in [feature-delta.md](../feature-delta.md); scenarios in `milestone-7-music-toggle.feature`.

## Production data and dogfood
Real page and real localStorage across a reload. Dogfood: turn the music off, reload, check it stays off and effects still play.

## Dependencies
- Slice 06 (music), slice 02 (same toggle pattern).

## Reference class
Like slice 02, about 2 h.
