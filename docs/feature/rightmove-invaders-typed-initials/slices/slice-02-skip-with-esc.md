# Slice 02: Skip with Esc

**Story**: US-05 | **Job**: J-TABLE-SKIP | **Estimate**: ≤ 1 day (DELIVER about 2 h) | **Order**: 2nd, ideally in the same release as slice 01 (D18)

## Goal
A player whose deposit makes the table can pass on signing with one key. Nothing is sent, and Enter starts the next game.

## IN scope
- Esc closes the entry at any point (empty, partly typed or full) and sends nothing. The game says "Signing skipped. Press Enter to house-hunt again.", and the canvas shows "Signing skipped".
- The deposit stays off the table. Enter starts a new game.
- A skip isn't a signing: an earlier signing and its mark are kept, and the local best is saved as usual (D16).
- Esc in the first 0.6 s of game over does nothing (slice 01's guard, D11).
- The wording grows: the prompt ends with "Esc skips.", the canvas help line adds "Esc skip", and the hint becomes "Type 3 letters to sign, or press Esc to skip."

## OUT of scope
- Asking for confirmation, a way back into the entry after a skip, a timeout that skips by itself, and a sound for the skip.
- Esc on any other screen (it still pauses during play).

## Learning hypothesis
- **Disproves** "one key, Esc, shown on the help line, is enough for a player to pass on signing, and it is safe" if playtesters asked to move on don't find it within 10 s, or if anyone skips by accident.
- **Confirms** that a skip removes the "AAA" rows left by players who only wanted to get past the entry (K18, K19).

## Acceptance criteria
See US-05 in [feature-delta.md](../feature-delta.md#wave-discuss--ref-user-stories).

## Production data and dogfood
- The real page and keyboard, and the deploy preview's real table.
- Dogfood the same day: the deliverer signs once, then in the next qualifying game types two letters and presses Esc. They check that the table is unchanged, that the earlier row is still marked, and that Enter starts a new game.
- On release day, record K19's baseline: the `AAA` rows on the production top 10.

## Dependencies
- Slice 01: the entry's key handling and the 0.6 s guard.

## Reference class
Like the leaderboard's in-game refusal (one more branch in the entry, one more message in `messages.js`, one more line on the canvas): about 2 h.
