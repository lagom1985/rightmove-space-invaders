# Evolution: rightmove-invaders-sound

**Feature**: sound for *Make the Right Move* · **Delivered**: 2026-10-23 → 2026-10-24 on `main` (from `48a5234`, the DELIVER roadmap, to `8042e7d`) · **Status**: DELIVER complete. The PO's manual checks (D10) and the playtest (K1–K4, K8, K9) are still owed · **Full record**: [feature-delta.md](../feature/rightmove-invaders-sound/feature-delta.md)

## Summary

The game now has sound: synthesised chiptune, with no audio files and no runtime dependencies.

- **Effects**: a "pew" for each shot; a "pop" for each hurdle hit, higher for more valuable hurdles (£50 → £300); a thud when a house is hit (at most one per 50 ms of game time; extra hits are dropped); a falling explosion when a home is lost; a "tink" when a shot stops a bolt.
- **Marching beat**: one bass note per formation step in a four-note cycle, so it speeds up exactly as the formation does. It is silent while paused, while the pin respawns, on the "Wave cleared!" banner and after game over.
- **Jingles**: a doorbell on start, a siren loop while the Dream Home is on screen, "ka-ching" when it is saved, a rising fanfare (≤ 2.4 s) when a wave is cleared, and a descending tune on game over.
- **Music**: one quiet loop on its own bus, at least 6 dB below the effects. It pauses and resumes with the game.
- **Control**: M toggles all sound and N toggles only the music, on every screen. Both settings are remembered, shown in the HUD and announced to screen readers. P, Esc, switching window and hiding the tab silence everything at once.
- **Robustness**: no sound before the first key press (browser autoplay rules). When Web Audio is missing, fails to start or fails during play, the game stays silent and keeps working.

The work was 11 roadmap steps across 7 slices. 148 tests are green: 23 unit, 23 in-memory, and 34 each in Chromium, Firefox and WebKit. The hard KPIs pass in all three engines: K5 (the shot sound starts ≤ 17 ms after the key press) and K7 (no errors). K6 (frame cost) is within budget.

## Business context

The persona is Alex Morgan (`casual-arcade-player`), who plays 5–10 minute sessions on a MacBook Air through the speakers or AirPods. Their job: *"When I take a few minutes to play, I want the game to sound alive and react to everything I do, so I feel the arcade tension and satisfaction instead of playing a silent screen."*

| Job | Opportunity | Stories | Slices |
|---|---|---|---|
| J-SOUND-FEEDBACK (hear my shots and hits) | 17 | US-01, US-04 | 01, 04 |
| J-SOUND-TENSION (hear the pressure rise) | 15 | US-03 | 03 |
| J-SOUND-CONTROL (silence it with one key) | 15 | US-02, US-07 | 02, 07 |
| J-SOUND-CELEBRATION (big moments feel big) | 12 | US-05 | 05 |
| J-SOUND-ATMOSPHERE (music sets the mood) | 9 | US-06 | 06 |

The evidence for these jobs is an **assumption** (there was no DISCOVER wave), so the playtest is what validates them. Music (slices 06–07) was built last so it can be dropped as one unit if K4 fails (D4, D12).

## Key decisions

| Decision | Why | Record |
|---|---|---|
| Synthesised chiptune, no audio files (D1) | No licensing, no download weight | DISCUSS |
| Sound on by default; the first key press unlocks audio (D2, DDD-6) | The game is played for fun, anywhere. Browsers allow audio only after a user gesture, and Safari needs the context created inside one | DISCUSS, DESIGN |
| M for all sound, N for music only, both remembered; no volume UI (D3, D5, D8) | One key is enough control; the system volume does the rest | DISCUSS |
| Pause, blur and a hidden tab silence everything before the next frame (D6, DDD-9) | Hidden tabs stop `requestAnimationFrame`, so `main.js` flushes the events at once | DISCUSS, DESIGN |
| The beat follows the formation's steps, not a fixed tempo (D7) | It stays in time at any refresh rate, because the simulation runs in fixed 120 Hz steps | DISCUSS |
| The rules publish events into an outbox they own | No events are lost, events carry details (the hurdle's value), and the rules don't depend on audio | [ADR-001](../product/architecture/adr-001-game-events-outbox.md) |
| A hand-rolled Web Audio synth, with recipes as theme data | No dependency; the sounds are readable and easy to tune | [ADR-002](../product/architecture/adr-002-hand-rolled-web-audio-synth.md) |
| Tests observe sound through a read-only journal | Tests assert meaning (a `hurdle-hit` worth £300), not frequencies, over the real audio path with no mock | [ADR-003](../product/architecture/adr-003-sound-journal-for-tests.md) |
| The director returns cue plans and never touches the synth (DDD-4); there is one mute mechanism (DDD-8) | The policy can be checked over the plans for every event sequence | DESIGN |
| `g.settings` is the only authority, and settings enter through `applySettings` (DDD-5) | Only `game.js` writes `g` | DESIGN |
| The synth's capabilities are injected, and the music scheduler is bounded by the audio clock (DDD-14) | Tests on a fake clock can't build a backlog of notes | DESIGN |
| Manual checks for what tests can't observe (D10); K6 is relative, ≤ 0.5 ms (D11); a rule for dropping music on K4 (D12) | Keeps automated tests to what they can honestly check | DISCUSS |
| **DELIVER amendment N1**: stop operations still act when the context is suspended; any audio-graph exception makes the synth `unavailable` for good | Review findings F2 (a stale siren or music came back on resume) and F8 (an exception must never reach the game loop) | [Changed assumptions](../feature/rightmove-invaders-sound/feature-delta.md#wave-deliver--ref-changed-assumptions) |

## Work completed

| Slice | Story | Step | Commit | What landed |
|---|---|---|---|---|
| 01 Hear your shots | US-01 | 01-01 | `db0a2b7` | Walking skeleton: the outbox, a minimal director, the synth on real Web Audio, shot and hit recipes, unlock on keydown |
| | | 01-02 | `dad1a56` | Silent until the first key, ≤ 17 ms, the 8-voice cap, the fallbacks; a `unit` test project with specs for hit pitch and the read-only handle. All 7 scenarios passed as soon as they were enabled (GREEN skipped as NOT_APPLICABLE) |
| 02 Silence with M | US-02 | 02-01 | `8098c87` | M on every screen, `applySettings`, guarded strict storage, the HUD field and announcements, the synth's `silence` |
| | | 02-02 | `97c2861` | The whole director policy table, with the music rows in one labelled block |
| 03 Marching beat | US-03 | 03-01 | `a58d841` | `formationStepped`, four march notes, a property for the step interval |
| | | 03-02 | `1da305b` | `paused` and `resumed` events; an immediate flush on blur and on a hidden tab |
| | | 03-03 | `f2c87a4` | `homeLost`; a property that the formation steps only during play |
| 04 Combat sounds | US-04 | 04-01 | `e2786cd` | `shieldHit` and `boltStopped`; the thud, tink and explosion; a noise voice |
| 05 Jingles | US-05 | 05-01 | `765547c`, `3bccdea` | Dream Home events (including the paths that cleared it silently), five jingles, the siren loop, a fanfare-length property |
| 06 Music | US-06 | 06-01 | `0a38c05` | A look-ahead music scheduler on its own bus; a music-level property |
| 07 Music toggle | US-07 | 07-01 | `6449d7e` | N on every screen, the music HUD field and announcement, a settings-parse property, README controls |

After the steps came:
- a K6 measurement script: `76b7b4d`
- the L1–L6 refactor: `1dc514e` `565fbf4` `f94d18e` `1867699` `f9856fa` `681974e`. It did not change behaviour, and the suite stayed green after each module.
- the review revision: `11bff9a` `674ff59` `f436db0` `92d87e8` `7189e63` `e6fb575` `4b326b3` `aa9fa09` `8042e7d`

The DES integrity check passed (all 11 steps have complete traces).

## Lessons learned

1. **A scenario that passes as soon as it is enabled hasn't been tested yet.** That happened to 01-02's seven scenarios, to 03-02's pause and focus scenarios, and to most in-memory director scenarios (the full policy table landed in 02-02). A silence check can only fail once something would otherwise be sounding, so each check was deliberately broken as soon as it could fail. In 05-01, skipping `applySettings(loadSettings())` made "The game remembers that the sound was off" fail in all three browsers (HUD On, journal `["doorbell"]`). In 06-01, turning the synth's `silence` into a no-op made "M silences the game in the middle of a wave", "Switching to another window…" and "Hiding the game's tab…" fail in all 9 runs (music still `playing`). When a later slice is what gives an earlier check its meaning, plan the break-it check in the roadmap, as this one did.
2. **A property that something never happens also needs proof that it does happen.** The formation-play-only property showed that the formation never steps outside play. It did not show that its setups actually reached the banner, respawn and game over (F9), or that the formation steps during play at all (N2). Both proofs were added.
3. **Design tables can encode bugs.** "Any perform while suspended: no change" looked tidy. But it meant a stop sent while the browser had suspended the context was dropped, so the siren or music came back on resume (F2). Stop operations must reach resources that are still held; only starts should be gated. No acceptance scenario could see this; the adversarial review found it.
4. **Adapters must fail closed.** A throwing audio graph inside `perform()` or the music timer could have frozen the game loop (F8). Now the synth goes `unavailable` and silent, and the game carries on.
5. **A test's expected values should not come from the code under test.** The music-level test read the same theme data the synth reads (F4); it now reads the mix the synth builds. `referencePlan` in the director harness re-codes the same policy table the director implements (F6); that is still open for DISTILL.
6. **A fake page clock with a real audio clock worked** (DDD-14). Fast-forwarded timers never built up a backlog of music notes in any engine.
7. **Measure what you mean to measure.** K6's "without sound" run removes Web Audio, so the director still runs and its cost is not in the delta. Browser timers round to 0.1–1 ms, so the measured deltas (+0.03 to +0.1 ms) are close to the timer resolution. That is enough for a soft gate, but not a precise number.
8. **Flagging large milestones for a sizing review was worth it.** Milestones 2 and 3 were split into two and three steps. Milestone 5 stayed one step, because 7 of its 9 scenarios were in-memory and passed as soon as they were enabled.

## Issues encountered

- **Adversarial review, iteration 1: rejected.** The high findings were:
  - F1: the P-key pause event was untested, and the pause outline could pass without testing anything.
  - F2: stops were dropped while the context was suspended.
  - F3: the pitch the synth gives a hurdle hit was untested.
  - F4: the music-level test copied the theme data.

  The revision fixed F1 (the DELIVER part, with a unit property), F2 (a fix plus a unit property), F3, F4, F7 (the oldest voices are cut first), F8 (the fail-safe), F9, F12 (unit properties can be replayed with `FC_SEED`) and N2 (a proof that the formation steps during play). **Iteration 2: approved.**
- **Deferred to DISTILL** (owner: the acceptance designer):
  - F1, scenario part: add "all sound stops at once" to the milestone-3 pause outline, and music checks to the silent-since-press steps.
  - F5: `expectAllSoundStopped` uses `expect.poll`, so it also passes when the voices simply end on their own. It should read once instead.
  - F6: `referencePlan` re-codes the policy table, so it can't catch a misreading of it. Add literal cue sequences or independent invariants.
  - F10: `game.js` exports `PLAYER_SPEED`, `RESPAWN_TIME` and `houseCentreX` only for the test driver.
- **Open, low**:
  - N3: the nodes of a partly started voice leak if the graph fails mid-start.
  - N4: `unlock()` is not under the fail-safe.
  - N5: the unit tests' fake audio never fires `onended`.
  - F11: 01-02's RED phase has no recorded failing run, and the K6 script is dev tooling outside the component table.
- **Architecture record updated for N1**: ADR-002 said `perform()` changes nothing while the synth is `suspended`; an amendment section appended in DELIVER records that stops now act while suspended and the fail-safe. ADR-003's journal statement still holds.
- **Mutation testing** was skipped under the project's mutation strategy (nightly-delta, which runs it nightly on changed code).
- **Not verified by DELIVER**: anything by ear, and real Safari (only Playwright's WebKit was tested).

## Still owed before the feature closes

- **PO manual checks (D10)**:
  - a real Safari dogfood session;
  - a 30 s listen under stress, on speakers and on headphones (the thud, tink and explosion levels were set by measurement, not by ear);
  - the music loop seam over about 5 minutes, and whether the tune works;
  - the same tempo on a 60 Hz and a 120 Hz display;
  - the canvas "SOUND OFF"/"MUSIC OFF" indicator and the controls line.
- **Playtest**: K1–K4, K8 and K9 per the protocol, with n recorded. The D12 rule decides whether the music stays.

## Links

- Delivery record: [feature-delta.md](../feature/rightmove-invaders-sound/feature-delta.md) (DISCUSS through DELIVER), [slices](../feature/rightmove-invaders-sound/slices/), [roadmap](../feature/rightmove-invaders-sound/deliver/roadmap.json), [execution log](../feature/rightmove-invaders-sound/deliver/execution-log.json), [Web Audio headless check](../feature/rightmove-invaders-sound/design/web-audio-headless-check.md), [RED classification](../feature/rightmove-invaders-sound/distill/red-classification.md)
- Architecture SSOT: [brief](../product/architecture/brief.md), [ADR-001](../product/architecture/adr-001-game-events-outbox.md), [ADR-002](../product/architecture/adr-002-hand-rolled-web-audio-synth.md), [ADR-003](../product/architecture/adr-003-sound-journal-for-tests.md)
- Product SSOT: [jobs](../product/jobs.yaml), [persona](../product/personas/casual-arcade-player.yaml), [journey](../product/journeys/play-a-session.yaml), [KPI contracts](../product/kpi-contracts.yaml), [outcomes registry](../product/outcomes/registry.yaml)
- Code and tests: [acceptance suite](../../tests/e2e/rightmove-invaders-sound/acceptance/), [unit properties](../../tests/unit/), [K6 tool](../../scripts/measure-performance.mjs)
- No artifacts were migrated to other permanent directories. None of the feature's files matches the finalize destination map, and the architecture and ADRs already live in `docs/product/architecture/`.
