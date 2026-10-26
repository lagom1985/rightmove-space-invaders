# Slice 03: No faster than the clock

**Stories**: US-05, US-06, with enabling task E6 | **Jobs**: J-TABLE-TRUST, J-TABLE-SIGN | **Estimate**: about 1 day | **Order**: 3rd

## Goal
A game can't be signed sooner than it could have been played, and a game played on other rules is refused cleanly, never mistaken for a forgery.

## IN scope
- The record's game time can't exceed the time since its session was issued, plus the allowance DESIGN sets (10 s, at least the session's 5 s timeout). A longer one is refused as `too-fast` (D8). Only the session's issue time and the function's clock count.
- **E6**: the local server lets the fake-clock browser tests through the clock check, without weakening production.
- The record names its rules version. A record from another version is refused as `rules-changed`, without replay (D10).
- The recorded-games corpus (E5) fails the build when a recorded game replays differently and the version wasn't raised.
- The forgery catalogue's entry 9 (K20).

## OUT of scope
- Anti-bot measures (D16).
- Replaying older rules versions.

## Learning hypothesis
- **Disproves** "an honest game is never too fast" if any honest signing on the preview, or in the first 30 days of production, is refused as `too-fast` (K23): from the session's latency, a slow first answer after a deploy, or clock skew between function instances.
- **Confirms** that a game computed offline must still wait its own length before it can be signed.

## Acceptance criteria
See US-05 and US-06 in [feature-delta.md](../feature-delta.md#wave-discuss--ref-user-stories).

## Production data and dogfood
- The deploy preview's real function and clock.
- Dogfood the same day: the deliverer signs a short game at once after game over, and a game with a long pause, and both are saved. Then the deliverer posts a recorded 5-minute game one minute after asking for its session, and sees it refused as `too-fast`.

## Dependencies
- Slice 02 (the record, its game time trusted through the replay, and the corpus).

## Reference class
Like the leaderboard's `listedAt` rule: one comparison against the function's clock, plus a constant and its check, and one cookie on the local server. About a day with the tests.
