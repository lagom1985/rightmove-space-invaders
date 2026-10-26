# Slice 02: The table replays the game

**Stories**: US-03, US-04, with enabling tasks E2–E5 | **Jobs**: J-TABLE-TRUST, J-TABLE-SIGN | **Estimate**: about 3–3½ days (over the 1-day target: D17) | **Order**: 2nd

## Goal
The function replays each signed game from its seed and its record, and saves the deposit the replay produces, only when it is the deposit claimed. A deposit changed in the console or claimed by `curl` never reaches the table.

## Enabling tasks (precursor commits before the slice's value commits)
They ship no value on their own, so they are no slice; the carpaccio hard gate doesn't apply, because this slice carries value stories. Each is traced to US-03 and J-TABLE-TRUST, has its acceptance line under US-03, and keeps every existing test green.
- **E2, seeded gameplay**: every gameplay draw comes from the game's seed, the particles get a source of their own, and the house erosion compares squared distances (D13).
- **E3, a game the function can create afresh**: the rules stop being one module-level state, so the function can replay a fresh game for each check. The views and the test harnesses move with them.
- **E4, the record**: from the game's start to its game over, the three controls the rules read at each step (left, right, fire), kept as changes by step index, and handed to the signing; the layering rules that let the function import the replay.
- **E5, the recorded-games corpus**: bot games of 1 to over 15 minutes, made in Node with a test bot on the real rules, replayed in Node in the build gate and in Chromium, Firefox and WebKit (K21).

## IN scope
- The signing carries its record and its claimed deposit. The function replays the record from the session's seed, and refuses it when the replay doesn't end at game over exactly at the record's last step, or ends at another deposit (D1).
- A malformed record is refused before any replay.
- The ceiling rises to £500,000, in the same change that makes the function replay (D14), and is checked on the claim before any replay.
- A record of up to 60 minutes of game time fits the request and is verified; a longer one is refused without replay (D9). The body cap grows to fit it.
- The forgery catalogue's entries 5–8, 10 and 11 (K20), and the honest games of the acceptance suite, replayed (K21).

## OUT of scope
- The clock check and the rules version (slice 03). In this slice a forger who computes a high-scoring record offline can still sign it at once.
- Keeping records after the check, or showing replays.

## Learning hypothesis
- **Disproves** "the replay is the same game everywhere, and cheap" if any game played in Chromium, Firefox or WebKit replays on Netlify's Node to another deposit or step, or if the longest recorded game's replay, scaled to 60 minutes, takes over 1 s on a preview (K22).
- **Confirms** that the RCA's two forgeries, by `curl` and by console, are both refused, with no change an honest player can see.

## Acceptance criteria
See US-03 and US-04 in [feature-delta.md](../feature-delta.md#wave-discuss--ref-user-stories).

## Production data and dogfood
- The deploy preview's real function, Blobs and secret, with games played in real browsers.
- Dogfood the same day: the deliverer plays and signs in Chrome, Firefox and Safari, and every signing is saved with the deposit shown. The deliverer then repeats the RCA's console forgery (Vector B) on the preview and sees "Couldn't confirm", with `replay-mismatch` in the log. Finally the smoke test signs the corpus's longest game and records K22.

## Dependencies
- Slice 01 (the session that binds the seed).

## Reference class
The enabling tasks are like the leaderboard's DELIVER refactors (the best-score store handed in from `main.js`, the synth split into four modules): mechanical, test-led, about a day and a half with the corpus. The replay itself is a loop over existing rules, as in the probe (about 60 lines).
