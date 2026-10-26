# Slice 02: The table replays the game

**Stories**: US-03, US-04 | **Job**: J-TABLE-TRUST, J-TABLE-SIGN | **Estimate**: about 2 days (over the 1-day target: Scope assessment) | **Order**: 2nd

## Goal
The function replays each signed game from its seed and its record, and saves the deposit the replay produces, only when it is the deposit claimed. A deposit changed in the console or claimed by `curl` never reaches the table.

## Precursor commits (inside the slice, before its value)
These ship no value on their own, so they are not a slice (the carpaccio hard gate, option b). Each keeps every existing test green.
1. **Seeded gameplay**: every gameplay draw comes from the game's seed, the particles get a source of their own, and the house erosion compares squared distances (D13). The probe showed the same games either way.
2. **A game the function can create afresh**: the rules stop being one module-level state, so the function can replay a fresh game for each check. The views and the test harnesses move with them (DESIGN).
3. **The record**: from the game's start to its game over, the three controls the rules read at each step (left, right, fire), kept as changes by step index, and handed to the signing.

## IN scope
- The signing carries its record and its claimed deposit. The function replays the record from the session's seed, and refuses it when the replay doesn't end at game over exactly at the record's last step, or ends at another deposit (D1).
- A malformed record is refused before any replay.
- The replayed deposit meets the old rules: a multiple of £50, at most £250,000 (D14).
- A record of up to 60 minutes of game time fits the request and is verified; a longer one is refused without replay (D9). The body cap grows to fit it.
- Layering rule 5 is amended so the function may import the rules it replays.
- The forgery catalogue's entries 4–7, 9 and 10 (K20), and the honest games of the acceptance suite, replayed (K21).

## OUT of scope
- The clock check and the rules version (slice 03). In this slice a forger who computes a high-scoring record offline can still sign it at once.
- Keeping records after the check, or showing replays.

## Learning hypothesis
- **Disproves** "the replay is the same game everywhere, and cheap" if any game played in Chromium, Firefox or WebKit replays on Netlify's Node to another deposit or step, or if a 60-minute record isn't verified within 1 s on a preview (K22).
- **Confirms** that the RCA's two forgeries, by `curl` and by console, are both refused, with no change an honest player can see.

## Acceptance criteria
See US-03 and US-04 in [feature-delta.md](../feature-delta.md#wave-discuss--ref-user-stories).

## Production data and dogfood
- The deploy preview's real function, Blobs and secret, with games played in real browsers.
- Dogfood the same day: the deliverer plays and signs in Chrome, Firefox and Safari, and every signing is saved with the deposit shown. The deliverer then repeats the RCA's console forgery (Vector B) on the preview and sees "Couldn't confirm", with `replay-mismatch` in the log. Finally the smoke test signs a 60-minute recorded game and records K22.

## Dependencies
- Slice 01 (the session that binds the seed).

## Reference class
The precursors are like the leaderboard's DELIVER refactors (the best-score store handed in from `main.js`, the synth split into four modules): mechanical, test-led, about a day. The replay itself is a loop over existing rules, as in the probe (about 60 lines).
