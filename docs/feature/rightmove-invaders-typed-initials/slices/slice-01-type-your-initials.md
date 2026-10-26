# Slice 01: Type your initials

**Stories**: US-01, US-02, US-03, US-04 | **Job**: J-TABLE-SIGN | **Estimate**: about 1.5–2 days of DELIVER, over the 1-day carpaccio target (see "Why one slice") | **Order**: 1st

## Goal
A player whose deposit makes the table types their three initials, sees exactly those letters, and signs with Enter. No letter wheel is left.

## IN scope
- The entry opens empty (`_ _ _`). Letters fill the next slot in capitals; Backspace deletes the last letter; a 4th letter is ignored. Enter with 3 letters signs, and Enter with fewer gives the hint "Type 3 letters to sign.".
- Every press counts once, in order, however fast (D15). Holding a key down types once. Presses after the Enter that signs, in the same frame, are dropped (D15, DESIGN DDD-T2).
- Only A–Z letters type, as printed on the key, on any layout (QWERTY, AZERTY, QWERTZ), with lowercase shown in capitals. Arrows, digits, Space, punctuation, letters outside A–Z (é, ü, ß, å) and shortcuts with Cmd, Ctrl or Alt/Option are ignored.
- Printable keys and Backspace never start a browser feature, on any screen of the game page (D19). With Cmd, Ctrl or Alt/Option held they keep their browser default, so Alt+F on Windows still opens the browser's menu (D17, D19; Alt/Option confirmed by the user on 2026-10-26).
- During entry, M, N, P, A and D type letters (no toggle, no pause). After the entry, they work as before.
- The stray-key guard: no key acts on the entry for the first 0.6 s of game over (D11).
- Losing focus or hiding the tab mid-entry leaves the entry open: the letters already typed stay, and nothing is typed while the window lacks focus (D20, locked by the user on 2026-10-26).
- Blocked initials: "Those initials aren't allowed. Type different ones.", and the entry empties.
- The new wording in the status mirror and on the canvas (feature delta, "Player-facing wording"), without "Esc skips" for now.
- The leaderboard's entry tests move to typing: DISTILL's switch and Retirement list, done in roadmap step 01-01 (feature delta, DISTILL).

## OUT of scope
- Esc to skip (slice 02).
- Editing a middle letter, names longer than 3 letters, on-screen or touch keyboards, and transliterating É to E.
- The server, the word list and the signing lifecycle (unchanged).
- Layout-aware game keys outside the entry.

## Why one slice
Typed entry must replace the letter wheel in one release, so the four stories can't ship apart:
- US-02 must ship with US-01, or M mutes mid-signature.
- US-04 must ship with US-01, or the wheel's "Change a letter." refusal is left on a typed entry.
- US-03 is the same `e.key` read that US-01 types with; only its checks are extra.

That puts the slice over the 1-day carpaccio target. The exception is accepted and recorded (feature delta, Scope assessment).

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
- DESIGN's answer on how the printed character, and every press in order, reach the rules (today `input.js` records only `e.code`, and a frame's presses are a set). Answered by ADR-009.

## Pre-slice probe (30 min, in DESIGN or DISTILL)
- In Chromium, Firefox and WebKit, check that a test can send a key whose printed character differs from its position (AZERTY's A on `KeyQ`). Playwright's `keyboard.press` sends US-layout events only.
- On a real Mac, read what the browsers report for the é key and for an Option letter.
- **Outcome** (DISTILL ran it on 2026-10-25): synthetic events work in all three engines. A keydown and its keyup dispatched on `window` reach the page's keyboard with `key`, `code`, `repeat` and the modifier flags as given, and `defaultPrevented` reads back, so CDP isn't needed. What a real Mac reports for the é key and for an Option letter can't be probed headless, and stays a manual check (DoD 5). Details: feature delta, DISTILL, Probe results.

## Reference class
Like the leaderboard's step 05-02 (the initials field, its cadence and the in-game refusal): about half a day, for the entry alone. This slice is DISTILL's eight roadmap steps, 01-01 to 01-08: the typed entry; Backspace and fast or held keys; Enter too early; only letters; the guard; chords and browser defaults; letters as printed; the refusal. Step 01-01 also carries the Retirement list (the letter-wheel scenarios, steps and helpers, and four unit specs to rewrite), and two new unit tests come with the slice (the keyboard over a plain `EventTarget`, and the rules' letter table). Hence about 1.5–2 days.
