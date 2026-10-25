# ADR-009: The keyboard reports typed key presses in order, beside positional key state

**Status**: Accepted (DESIGN, 2026-10-25; approved by the user) · **Feature**: rightmove-invaders-typed-initials

## Context
`src/platform/input.js` reports key **positions** (`e.code`): `isDown(code)` for movement and fire, and `takePressed()`, a Set of the codes pressed since the last frame, for one-shot keys (Enter, P/Esc, M, N). That is right for play, and the rules (`src/game/game.js`) never touch a browser API (ADR-006, rule 1).

Typed initials (feature delta, D1–D18) need what positions can't give:
- **The printed letter** (D8): on French AZERTY the key printed A arrives as `KeyQ`, and on German QWERTZ the key printed Z as `KeyY`.
- **Every press, in order** (D15): a Set per frame merges two presses of one key and drops the order, so `a a x` typed within one frame can't give `AAX`.
- **One letter per press** (D14): holding a key down types once.
- **No browser feature** (D17): Cmd/Ctrl shortcuts type nothing, and no key may open Firefox's quick find (`/`, `'`) or navigate back (Backspace).

Constraints: the fixed-step loop and `isDown` stay as they are (ADR-000), the game keys stay positional outside the entry (DISCUSS, Out of scope), there is no new dependency, and the target is desktop Chromium, Firefox and WebKit.

## Decision
- **One adapter, two channels.**
  - **Positions, unchanged**: `isDown(code)`, `takePressed()` (a Set of codes), `endStep()` and `releaseAll()`.
  - **Typed presses, new**: `takeTyped()` returns the keydowns since the last call, in the order they arrived, each as `{ key, code }`. Only presses count: a keydown with `repeat` set is not reported. Chords are not reported either: a key pressed with Cmd, Ctrl or Alt/Option held belongs to the browser and the OS. `main.js` drains the queue every frame, paused or not, so nothing typed earlier can turn up later.
- **One rules entry per frame**: `handlePresses(pressed, typed)`. A frame that starts with the initials entry open belongs to the entry. The rules read its typed presses in order and ignore the positions, so M, N, P/Esc and Enter-to-restart have no effect. Any other frame reads the positions only, as today. The rules decide what a press means: what counts as a letter (exactly one ASCII letter, shown in capitals, with no Unicode normalisation or case folding), Backspace, Enter and Escape (read by `key`), the 0.6 s guard and the 3-letter limit. The adapter only reports.
- **Browser defaults are a platform policy, the same on every screen.** For every keydown that isn't a chord and whose `key` is a single printable character, the adapter calls `preventDefault()`. It does the same for Backspace, and for Space and the arrows as before. Repeats count here too, because a held `/` would open quick find. Enter, Esc, Tab and chords keep their defaults, so a focused footer link still opens with Enter and every browser shortcut still works. The page has no editable element; if one is ever added, the policy must skip events aimed at it.
- **Enforcement**: `src/platform/input.js` imports nothing. This becomes a sixth rule in the import-scan unit test (ADR-006's scan), added in DELIVER, so the keyboard can never read the rules' state. Rule 1 keeps the rules away from the adapter.

## Alternatives considered
- **An ordered list from `takePressed()`** (one channel): it gives order and duplicates for everyone. But every one-shot rule would change, and so would five unit specs that pass a Set. Outside the entry, two presses of M within one frame would also toggle twice, which changes the game outside this feature's scope.
- **Recording `e.key` in the existing Set**: it mixes two vocabularies in one channel, and still loses duplicates and order (D15).
- **A hidden, focused `<input>` read through `beforeinput`**: it gives real text semantics (dead keys, IME). But it needs focus management (a click or Tab takes focus away), it adds an editable element to the accessibility tree (a change to the initials field of leaderboard DDD-14), and Enter and Backspace keydowns would have to be merged with input events to keep their order. Far more than three letters need.
- **`navigator.keyboard.getLayoutMap()`** to map a position to its printed letter: Chromium only. Firefox and Safari don't have it.
- **`preventDefault` only while the entry is open**, with `main.js` setting a mode on the keyboard, or with the rules' state injected as a predicate: quick find would still work on the title and during play. But the adapter would then carry a mode that mirrors rule state, with two behaviours to test, and `/` or `'` pressed during play would still let Firefox's find bar take the keyboard mid-game.

## Consequences
- **Positive**:
  - Letters arrive as printed on any Latin layout, in order, once per press.
  - The game keys, `isDown` and the fixed step are unchanged.
  - The rules take plain data, so unit tests and the in-memory model drive typing without a browser.
  - A test can dispatch `KeyboardEvent('keydown', { key: 'a', code: 'KeyQ' })` to stand in for AZERTY, because the adapter doesn't check `isTrusted`.
- **Two vocabularies**: `code` for the game keys and `key` for the entry. Outside the entry the game keys stay positional: on AZERTY the M toggle still answers the key printed `,` (a pre-existing issue, out of scope).
- **On every screen**, Firefox's quick find (`/`, `'`) and typeahead find never open from the game page, and Backspace never navigates back. This is a side effect outside the entry, and it also stops the find bar from taking the keyboard during play.
- **Accepted edges**:
  - Presses that arrive after the closing Enter or Esc, within the same frame (17 ms or less), are dropped.
  - Dead keys and IME composition are not supported (Out of scope). They arrive as `Dead`, `Process` or an accented character, and are ignored.
  - On Windows, Alt+letter types nothing.
- **Defaults can only be shown on real browsers.** Synthetic events run no default. The tests check `defaultPrevented` on a cancelable synthetic keydown, and Firefox's quick find and a real AZERTY or QWERTZ keyboard are manual checks (DoD 5).
