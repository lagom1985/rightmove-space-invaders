# Slice 02: Silence it with M

**Story**: US-02 | **Job**: J-SOUND-CONTROL | **Estimate**: ≤ 1 day (about 2–3 h) | **Order**: 2nd

## Goal
One key (M) turns all game sound off or on, the game shows and announces which, and remembers it next visit.

## IN scope
- M toggles sound on the title screen, during play, while paused and on game over.
- "SOUND ON" / "SOUND OFF" indicator in the HUD, and "M sound" in the title-screen controls line.
- Announcement in the status region ("Sound off. Press M to turn it on.").
- Setting saved in localStorage; defaults to on if storage is blocked.

## OUT of scope
- Separate music toggle (slice 07), volume slider.

## Learning hypothesis
- **Disproves** "a single remembered mute key is enough control for players who are sometimes in quiet places" if playtesters still reach for the system volume or ask for a slider.
- **Confirms** sound can safely default to on.

## Acceptance criteria
See US-02 in [feature-delta.md](../feature-delta.md).

## Production data and dogfood
Real page, real localStorage across a reload. Dogfood: mute mid-wave, reload, check the game starts muted.

## Dependencies
- Slice 01 (there must be sound to silence).

## Reference class
Like the best-score persistence in the walking skeleton (storage + status mirror), about 2 h.
