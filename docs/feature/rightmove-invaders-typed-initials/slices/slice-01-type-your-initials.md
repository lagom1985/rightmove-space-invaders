# Slice 01: Type your initials

**Stories**: US-01, US-02, US-03, US-04 | **Job**: J-TABLE-SIGN | **Estimate**: ≤ 1 day (DELIVER about 5–6 h) | **Order**: 1st

## Goal
A player whose deposit makes the table types their three initials, sees exactly those letters, and signs with Enter. No letter wheel is left.

## IN scope
- The entry opens empty (`_ _ _`). Letters fill the next slot in capitals; Backspace deletes the last letter; a 4th letter is ignored. Enter with 3 letters signs, and Enter with fewer gives the hint "Type 3 letters to sign.".
- Every press counts once, in order, however fast (D15). Holding a key down types once.
- Only A–Z letters type, as printed on the key, on any layout (QWERTY, AZERTY, QWERTZ), with lowercase shown in capitals. Arrows, digits, Space, punctuation, accented letters and Cmd/Ctrl shortcuts are ignored. No key starts a browser feature.
- During entry, M, N, P, A and D type letters (no toggle, no pause). After the entry, they work as before.
- The stray-key guard: no key acts on the entry for the first 0.6 s of game over (D11).
- Blocked initials: "Those initials aren't allowed. Type different ones.", and the entry empties.
- The new wording in the status mirror and on the canvas (feature delta, "Player-facing wording"), without "Esc skips" for now.
- DISTILL: the walking-skeleton step and the leaderboard's entry tests move to typing (feature delta, Pre-requisites).

## OUT of scope
- Esc to skip (slice 02).
- Editing a middle letter, names longer than 3 letters, on-screen or touch keyboards, and transliterating É to E.
- The server, the word list and the signing lifecycle (unchanged).
- Layout-aware game keys outside the entry.

## Learning hypothesis
- **Disproves** "casual players sign by typing without being told how, and get exactly the letters they meant" if a playtester reaches for Up/Down, takes more than 10 s, or ends up with a letter they didn't mean (a stray game key, an AZERTY/QWERTZ mismatch, or a fast repeated letter lost).
- **Confirms** the letter wheel can go without anyone missing it (K16, K17).

## Acceptance criteria
See US-01 to US-04 in [feature-delta.md](../feature-delta.md#wave-discuss--ref-user-stories).

## Production data and dogfood
- The real page and keyboard, and the real table on the pull request's deploy preview (its own store, starting empty).
- Dogfood the same day: the deliverer plays to game over and signs by typing. Then, with a real AZERTY keyboard (or a borrowed one), they sign CAM. Then they type a blocked word and sign something else.

## Dependencies
- `rightmove-invaders-leaderboard` in production (done).
- DESIGN's answer on how the printed character, and every press in order, reach the rules (today `input.js` records only `e.code`, and a frame's presses are a set).

## Pre-slice probe (30 min, in DESIGN or DISTILL)
- In Chromium, Firefox and WebKit, check that a test can send a key whose printed character differs from its position (AZERTY's A on `KeyQ`). Playwright's `keyboard.press` sends US-layout events only.
- On a real Mac, read what the browsers report for the É key and for an Option letter.

## Reference class
Like the leaderboard's step 05-02 (the initials field, its cadence and the in-game refusal): about half a day. This slice adds the layout check and the rewrite of the entry tests.
