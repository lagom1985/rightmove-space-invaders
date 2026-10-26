# Evolution: rightmove-invaders-typed-initials

**Feature**: typed initials for the shared high-score table of *Make the Right Move* · **Delivered**: 2026-10-26 on branch `rightmove-invaders-typed-initials` (from `81498c0`, the DELIVER roadmap, to `96a2146`), not pushed and not merged to `main` · **Status**: DELIVER complete. Still to do with the user, on the pull request's deploy preview: the manual checks (DoD 5 and 6), the K16–K18 playtest and the PO's check; then the merge, and K19's baseline on release day · **Full record**: [feature-delta.md](../feature/rightmove-invaders-typed-initials/feature-delta.md)

## Summary

A player whose deposit makes the shared top 10 now types their three initials and presses Enter, instead of choosing each letter with Up and Down. Backspace takes back the last letter, and Esc skips signing. Everything after the signing is as the leaderboard shipped it: a signing still sends exactly 3 capital letters to `/api/scores`, through the same lifecycle, word filter and table.

- **Typing**: the entry opens empty (`_ _ _`). Each letter fills the next slot, in capitals, as printed on the key, so French AZERTY and German QWERTZ sign what they show.
  - Only A–Z type. é, ü, ß, å, ı, ſ and K (the Kelvin sign) are ignored, never turned into a plain letter.
  - During the entry, A, D, M, N and P are letters, not game keys. The arrows, digits, Space and punctuation do nothing.
  - A 4th letter is ignored, a held key types once, and every press counts, in order, however fast: "aax" typed within one frame gives AAX.
- **Enter**: with 3 letters, it signs. With fewer, it says "Type 3 letters to sign, or press Esc to skip." and keeps the letters. Initials on the word filter are refused ("Those initials aren't allowed. Type different ones.") and the entry empties. Each hint or refusal is announced, even when the words repeat, in the same game or the next.
- **Esc**: "Signing skipped. Press Enter to house-hunt again." Nothing is sent and no sound plays; an earlier signing keeps its mark, and the best deposit is saved as usual.
- **Stray keys**: for the first 0.6 s of game over, no key acts on the entry, and a key held down from play never types. A key pressed as the window loses focus is dropped, and the letters already typed stay.
- **Browser defaults, on every screen**: printable keys and Backspace never start a browser feature, such as Firefox's quick find on `/` and `'`, or Backspace leaving the page. With Cmd, Ctrl or Alt/Option held, they keep their default and never type.
- **How**: the keyboard gained a second channel, `takeTyped()` (every press, in order, as `{ key }`), beside the unchanged positions, and one pure default policy, `preventsDefault` (ADR-009). The rules take both as plain data in `handlePresses(pressed, typed)` and run each press through one pure entry step, `entryStep`, which returns a plan and emits nothing. There is no new file under `src/` and no new dependency.

The work was 9 roadmap steps in 2 slices, all on 2026-10-26, then a refactor, a fix for three flaky checks and one review revision. 525 tests are green: 92 unit, 67 in-memory, and 122 each in Chromium, Firefox and WebKit. The feature's share is its 46 scenarios (72 runs: 61 in each browser and 11 in-memory), 3 new unit specs with 17 tests, and the rewritten status-mirror spec. The leaderboard's walking skeleton now types FAB. The build gate (`npm run build`) passes 159. K16–K18 are a playtest and K19 a count on production, and none has run yet.

## Business context

**There was no DISCOVER or DIVERGE.** The change came from the user on 2026-10-25, once the leaderboard was live: "the player should type the letters directly". DISCUSS wrote two jobs, both assumptions from the product owner's own preference, to be validated by K16–K18:
- **J-TABLE-SIGN** (opportunity 11): sign quickly, with exactly my initials. The letter wheel took 9 presses for FAB and 17 for ALX (37 with Up only); typing takes 4. Typing must also take M, N and P as letters, though everywhere else they toggle the sound and the music, and pause.
- **J-TABLE-SKIP** (opportunity 9): pass with one key. The only way past the wheel was to sign, so pressing Enter three times left `AAA` on a public table.

Five stories for `casual-arcade-player`, in two slices:
- **Slice 01, type your initials** (US-01 to US-04): typing, only letters, the letter as printed, and refused initials starting again empty. Typing had to replace the wheel in one release, so the slice couldn't be split.
- **Slice 02, skip with Esc** (US-05).

The hypothesis: 5 of 5 playtesters sign unaided within 10 s with exactly their own letters (K16, K17), and at least 4 of 5 find Esc when they want to pass, with no accidental skip (K18). K19 then counts new `AAA` rows on production for 30 days after release.

## Key decisions

| Decision | Why | Record |
|---|---|---|
| Type up to 3 letters; Enter signs at 3 and gives a hint with fewer; Backspace deletes; the entry opens empty (D1, D5, D13) | What any name field does: 4 presses for ALX | DISCUSS (user) |
| Only A–Z type; during the entry A, D, M, N and P are letters; every other key does nothing (D2, D6, D7) | Mina can sign MNP, and no game key lands on a public table | DISCUSS |
| The letter printed on the key: the entry reads `key`, and the game keys keep reading `code` (D8, DDD-T1) | AZERTY and QWERTZ sign what they show, with no layout setting | [ADR-009](../product/architecture/adr-009-keyboard-typed-presses-in-order.md) |
| Two channels from one keyboard: the positions unchanged, and `takeTyped()`, every press in order as `{ key }`, without repeats or chords; `releaseAll()` empties both (DDD-T1, DDD-T4, D20) | Every press, in order (D15), without touching the game keys or the fixed step | ADR-009 |
| One rules entry per frame, `handlePresses(pressed, typed)`, with plain data; a frame that starts with the entry open belongs to it; a press that closes it drops the rest of the frame (DDD-T2) | The Enter that signs never also starts a game, and M can't mute mid-signature | ADR-009 |
| A letter is exactly one character, A–Z or a–z, checked before uppercasing, with no normalisation (DDD-T3) | `'ß'.toUpperCase()` is SS and `'ı'.toUpperCase()` is I | DESIGN |
| One pure entry step that returns a plan, with `handlePresses` as its shell; notices numbered across games by a counter outside `g` (DDD-T6, DDD-T10) | Its identity for every other key can be enumerated, and a repeated hint is still heard | DESIGN, ADR-009 |
| The 0.6 s stray-key guard drops presses; it never queues them (D11, DDD-T5) | A queue would type the very tap the guard exists to stop | DESIGN |
| Blocked initials empty the entry (D4) | Typing has no current letter to change | DISCUSS (user) |
| Esc skips as state only: `g.skipped`, with no event, no request and no sound; the earlier signing, its mark and the best untouched (D3, D16, DDD-T7) | Nothing would consume an event | DESIGN |
| One pure default policy on every screen: printable keys and Backspace prevented unless Cmd, Ctrl or Alt/Option is held; Space and the arrows as before (D17, D19, DDD-T8) | Quick find and Back never take the game page, and shortcuts stay the browser's | ADR-009 (user, 2026-10-25 and 2026-10-26) |
| `update` gets only an `{ isDown }` view of the keyboard; a sixth layering rule, `platform/input.js` imports nothing (DDD-T13, DDD-T14) | The rules can't drain the typed queue, and the keyboard can't read the rules | ADR-009 |
| Wording by owner: `messages.js` for what both views say, `status.js` and `render.js` for their own (D12, DDD-T9) | Each phrase is declared once | DESIGN |
| Unchanged: the server contract, the 16-word list, the signing lifecycle and `high-scores.js`'s code (D9, DDD-T13) | The change stays in the browser | DESIGN |
| **DELIVER amendments**: `canPlayAgain()` as the one rule for "Enter plays again"; Backspace prevented from 01-02; Firefox and WebKit test timeouts; the fake clock paused relative to the page's own | The refactor, a WebKit finding, and the flaky-check fixes | [Changed assumptions](../feature/rightmove-invaders-typed-initials/feature-delta.md#wave-deliver--ref-changed-assumptions) |

## Work completed

| Slice | Step | Commit | What landed |
|---|---|---|---|
| 01 Type your initials | 01-01 | `e8fe3ee` | The step that can't be split: `takeTyped()`; `handlePresses(pressed, typed)`; `entryStep` and its shell (letters, Enter signs 3, the word filter refuses, the too-few row); numbered notices; `g.skipped`; `update` on `{ isDown }`; the typed prompt, field and slots. The switch flipped, then deleted; the leaderboard's wheel field scenario deleted, its three other wheel scenarios parked; four unit specs rewritten; three new ones. The walking skeleton types FAB |
| | 01-02 | `5a49b65` | Backspace, its default prevented already (in WebKit it left the page). The fourth letter, held keys and fast typing passed on 01-01's code. Retirement item 2 |
| | 01-03 | `2442abe` | Each notice announced once by its number, in the same game and the next; `INITIALS_NOTICES`; the hint and the refusal on the canvas. The rules needed no change |
| | 01-04 | `a5bc496` | Only letters A to Z: all five scenarios passed as soon as they were enabled (01-01's raw-key check). No production change |
| | 01-05 | `210990c` | The 0.6 s guard drops presses (`STRAY_KEY_GUARD_S`); `releaseAll()` empties the typed queue |
| | 01-06 | `f05027a` | `preventsDefault`, on every screen, and its enumerated unit table; the sixth layering rule, named in `CLAUDE.md` |
| | 01-07 | `2f26b25` | Letters as printed: all of M3 passed as soon as it was enabled. The entry step's enumerated table. No production change |
| | 01-08 | `923b2df` | The refusal reworded, and the entry emptied; three of the four M4 scenarios passed as soon as they were enabled. The comment-only edit to `high-scores.js`; Retirement item 3 ends the letter wheel; the README's controls |
| 02 Skip with Esc | 02-01 | `ed5a0d6` | Esc skips (the skip plan, `g.skipped`); the slice 02 wording; M2's after-skip block, M6's journey property and its Esc row; the README |

After the steps came:
- the L1–L6 refactor: `3698a36`. `canPlayAgain()` became the one source for the 0.6 s guard on "Enter plays again", read by `handlePresses` and `render.js`, and the entry step's rows were named (`typeLetter`, `takeBackLetter`). No assertion changed.
- three flaky checks made certain: `f081ed8` (see Issues encountered)
- the review revision: `96a2146`

The 9 steps ran from 03:35 to 09:19 UTC, and the whole of DELIVER, review included, in about 8 hours; DISCUSS had estimated about 2 days. No step needed a fix cycle. The roadmap is `81498c0`; the earlier waves are DISCUSS `8a01ef8`, DESIGN `171b9e0` and DISTILL `62025b3` (each revised before DELIVER). The DES integrity check passed: all 9 steps have complete RED, GREEN and COMMIT traces. The execution log is committed with the DELIVER record, not after each step as in the leaderboard.

## Lessons learned

1. **Rare witnesses in property tests flake.** fast-check's 100 runs missed "a tap no step has seen" in 6 of 500 test runs, and "the same key typed twice in one go" in about 3 of 1,000, and either fails the Netlify build. Each was fixed with an `examples` entry that reaches the moment first. The cost: the witness check now holds by construction for the moments those examples reach. So when a witness set is added, estimate how often each moment comes up, as `96a2146` did for the Esc set (its rarest moment, about 1 game in 6, is missed by a 200-game run about once in 10^16), and add an example when a moment is rare.
2. **Pause a fake clock relative to the page's own clock.** The page driver paused at a fixed time after page load, and failed with `Cannot fast-forward to the past` whenever a busy machine took longer than that to load the page. It now pauses 1 s ahead of the page's clock when that is later.
3. **Size browser timeouts per project, from measured durations.** Firefox and WebKit play the fake-clock games slower than Chromium: the slowest scenario alone takes about 36 s, 44 s and 56 s, about 1.2× and 1.6×. Under load, two WebKit runs hit the 90 s limit. Firefox and WebKit now have project timeouts of 45 s and 60 s, so the table scenarios, which get three times their project's, have 90 s, 135 s and 180 s: about three times the slowest each takes alone.
4. **A scenario that passes as soon as it is enabled needs proof that it can fail.** Many did, because the behaviour had landed in earlier steps: all five of 01-04's, all of M3, three of M4, and parts of M1, M2, M5 and M6. The crafters ran hand mutations in 7 of the 9 steps (uppercasing before the check, positions let through during the entry, `>=` for `>` at the 0.6 s guard, notices numbered per entry, a refusal keeping its letters, Esc left as the identity…), and each was caught.
5. **Retire a test only with its replacement, and trace each removal.** Each wheel scenario was parked until the step that enabled its typed replacement, so no behaviour went untested in between. The review traced the 01-08 removals (the leaderboard's parked refusal scenario, the blocked-initials helpers, and a step left with no user) to their typed replacements.
6. **A dangerous browser default can show in the test engine.** In WebKit, Backspace left the page during the 01-02 scenarios. Its prevention landed in that step, four steps before the policy it belongs to. When a scenario sends a key with a default that can leave or cover the page, guard it in the same step.
7. **Rule on a mandate's intent when its form assumes tooling the repo doesn't have.** The review's two blockers asked for the contract-shape mandate in Python form, checked by a CLI this repo doesn't have. The repo already meets its intent its own way: DESIGN's component table, a `@contract-shape:` tag on every scenario, and `@US-0N` story anchors. The orchestrator ruled on that and recorded why.
8. **The roadmap's choices held.** 01-01, the step that couldn't be split, kept the walking skeleton green through the switch. Of the three features flagged for a sizing review, the roadmap spread M1 and M2 over several steps, and kept M5 in one (02-01, 12 runs), which went green with no fix cycle.

## Issues encountered

- **Adversarial review: NEEDS_REVISION**, with 0 behavioural, layering or test-integrity defects. Its 2 blockers (lesson 7) were ruled not applicable in that form. The revision `96a2146` applied the useful suggestions: a witness set for the Esc property (400 test runs, 0 misses); comments on the `POLICY` oracle and on the examples that hold by construction; the timeout comment; two stale references. Not applied: folding four entry-step properties into the enumerated table, because they quantify over letter content and notice numbers.
- **The integration gate at `ed5a0d6`**: 523 passed, 2 failed, both WebKit timeouts at 90 s under load, in "my deposit of £50 makes the high-score table". Both passed alone (40 s and 56 s). Fixed by the per-project timeouts in `f081ed8` (lesson 3), and confirmed by the 525-green run.
- **Two flaky keyboard properties** (lesson 1): reported in 02-01, fixed in `f081ed8`. The keyboard spec then passed 2,000 of 2,000.
- **`Cannot fast-forward to the past`** (lesson 2): `f081ed8`.
- **Backspace left the page in WebKit** (lesson 6): `5a49b65`.
- **Roadmap review**: conditionally approved (0 blockers). The orchestrator applied the conditions before 01-01.
- **Mutation testing**: disabled under the project's strategy (`CLAUDE.md`); hand mutations instead (lesson 4).
- **Not verified by DELIVER**: real keyboards and layouts; Firefox's quick find and typeahead find; Backspace in real Firefox and Safari; the canvas (01-03 looked only at a local screenshot of the hint and the refusal); VoiceOver; the playtest.

## Still owed before the merge to `main`

The commands and checklists are in the feature delta's [DELIVER pre-requisites](../feature/rightmove-invaders-typed-initials/feature-delta.md#wave-deliver--ref-pre-requisites).
- **A pull request**: with the user's OK, push the branch and open one, for its deploy preview. No platform change is needed: nothing under `netlify/` changed, and no new dependency or setting.
- **The manual checks (DoD 5)**, with the user on the preview: a real AZERTY or QWERTZ keyboard in Chrome, Firefox and Safari; Firefox's quick find on `/` and `'`, and typeahead find; Backspace in Firefox and Safari; the canvas lines, "Esc skip" and "Signing skipped" included, against DESIGN's Rendering universe.
- **VoiceOver (DoD 6)**: the prompt, each letter, the hint, the refusal and the skip, and which keys Quick Nav takes first.
- **The K16–K18 playtest** on the same preview, n recorded with every result. A miss opens a fix via `/nw-bugfix` before the release record.
- **The PO's check, then the merge** (DoD 9).
- **On release day**: K19's baseline (the `AAA` rows on the production top 10), then weekly for 30 days.
- **Candidate follow-ups**, not in this feature: a browser-globals check in the layering scan; a read-only view of `g` for the views; layout-aware game keys outside the entry (on AZERTY, the M toggle answers the key printed `,`). An editable element added to the page later would need the default policy, and ADR-009, revised.
- **Session state**: `deliver/.develop-progress.json` and `.nwave/des/` are left for finalize Phase C, with the user's approval.

## Links

- Delivery record: [feature-delta.md](../feature/rightmove-invaders-typed-initials/feature-delta.md) (DISCUSS through DELIVER), [slice 01](../feature/rightmove-invaders-typed-initials/slices/slice-01-type-your-initials.md), [slice 02](../feature/rightmove-invaders-typed-initials/slices/slice-02-skip-with-esc.md), [roadmap](../feature/rightmove-invaders-typed-initials/deliver/roadmap.json), [execution log](../feature/rightmove-invaders-typed-initials/deliver/execution-log.json)
- Architecture SSOT: [brief](../product/architecture/brief.md), [ADR-009](../product/architecture/adr-009-keyboard-typed-presses-in-order.md); the layering scan of [ADR-006](../product/architecture/adr-006-shared-high-score-rules.md), and the signing lifecycle of [ADR-008](../product/architecture/adr-008-table-probed-never-awaited.md), unchanged
- Product SSOT: [jobs](../product/jobs.yaml) (J-TABLE-SIGN, J-TABLE-SKIP), [persona](../product/personas/casual-arcade-player.yaml), [journey](../product/journeys/play-a-session.yaml) (the high-score steps), [outcomes registry](../product/outcomes/registry.yaml) (OUT-15 and OUT-16; OUT-11 and OUT-14 amended), [KPI contracts](../product/kpi-contracts.yaml) (K16 to K19)
- Test policy: [ATDD infrastructure policy](../architecture/atdd-infrastructure-policy.md), with this feature's rows: synthetic key events for other layouts, the `defaultPrevented` recorder, and the typed entry's rules on their own
- Code and tests: [acceptance suite](../../tests/e2e/rightmove-invaders-typed-initials/acceptance/), [unit specs](../../tests/unit/), [keyboard](../../src/platform/input.js), [rules](../../src/game/game.js)
- **Nothing was migrated** to other permanent directories. The feature has no `design/`, `discuss/` or `distill/` folder, so no file matches the finalize destination map: ADR-009 and the architecture already live in `docs/product/architecture/`, the journey in `docs/product/journeys/`, and the walking skeleton is the leaderboard's `.feature` file under `tests/`. The delivery history stays in `docs/feature/rightmove-invaders-typed-initials/`.
