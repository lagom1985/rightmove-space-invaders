# Feature delta: rightmove-invaders-sound

Note (2026-10-24): src/ was reorganised into game/, sound/, view/, platform/, theme/; paths below are as they were at the time.

Sound for *Make the Right Move*: synthesised chiptune effects, a marching beat, jingles for big moments, background music, one-key mute (M) and a music toggle (N).

- **Type**: user-facing, new functionality, brownfield (builds on the game walking skeleton, commit `57d9c21`).
- **Density**: lean (Tier-1 only). **Research depth**: lightweight. **JTBD**: yes.
- **SSOT**: [jobs.yaml](../../product/jobs.yaml) · [persona](../../product/personas/casual-arcade-player.yaml) · [journey](../../product/journeys/play-a-session.yaml) · [architecture brief](../../product/architecture/brief.md) · [KPI contracts](../../product/kpi-contracts.yaml)
- **Slices**: [slices/](slices/) · **Revision**: 3 (after two review cycles; final approval by the PO, see "Review gate record" at the end)

---

## Wave: DISCUSS / [REF] Persona ID

`casual-arcade-player`: Alex Morgan (they/them). Plays for fun, anywhere, in 5–10 minute sessions on a MacBook Air through the speakers or AirPods. Knows UK property jargon first-hand and grew up on arcade sound.

## Wave: DISCUSS / [REF] JTBD one-liner

When I take a few minutes to play Make the Right Move, I want the game to sound alive and react to everything I do, so I feel the arcade tension and satisfaction instead of playing a silent screen.

| Job | Opportunity | Stories |
|---|---|---|
| J-SOUND-FEEDBACK (hear my shots and hits) | 17 | US-01, US-04 |
| J-SOUND-TENSION (hear the pressure rise) | 15 | US-03 |
| J-SOUND-CONTROL (silence it with one key) | 15 | US-02, US-07 |
| J-SOUND-CELEBRATION (big moments feel big) | 12 | US-05 |
| J-SOUND-ATMOSPHERE (music sets the mood) | 9 | US-06 |

Evidence level: **assumption** (no DISCOVER wave). The playtest KPIs below validate it.

## Wave: DISCUSS / [REF] Locked decisions

| ID | Decision | Verdict |
|---|---|---|
| D1 | Sounds are synthesised chiptune. No audio files, no licensing, no download weight. | Locked (user) |
| D2 | Sound is **on by default**, because the game is played anywhere, for fun. Browsers allow sound only after a user gesture, so the first key press switches it on. | Locked (user) |
| D3 | **M** toggles all sound, at any time and on any screen. The setting is remembered, shown in the HUD and announced to screen readers. | Locked (PO) |
| D4 | All four groups are in scope (effects, beat, jingles, music), sliced so music ships last and can be dropped as one unit. | Locked (user) |
| D5 | **N** toggles music only, remembered (US-07). | Locked (PO) |
| D6 | Pausing (P, Esc, switching window, hiding the tab) silences everything **before the next frame**. Resuming restores the beat, music and siren. | Locked (PO) |
| D7 | The marching beat follows the formation's own steps (one note per step), not a fixed tempo. | Locked (PO) |
| D8 | No volume slider or settings menu; the system volume is enough. | Locked (PO) |
| D9 | Repo docs in English; conversation in Italian. | Locked (PO) |
| D10 | Criteria that tests can't observe reliably are **manual checks**, done by the person delivering the slice before closing it: listening under stress, the music loop seam, a 120 Hz display, the canvas HUD indicator and controls line, real Safari. | Locked (user, 2026-10-23) |
| D11 | K6 is relative: the sound path may add at most 0.5 ms frame work over the same run without sound. Measured as p95 in Chromium and as the mean in Firefox and WebKit, whose timers round to 1 ms. | Locked (user, 2026-10-23) |
| D12 | K4 between 40% and 60%: re-tune the music once and repeat the playtest; still below 60% means the music is dropped. | Locked (user, 2026-10-23) |

## Wave: DISCUSS / [REF] Scope assessment

**PASS (right-sized).** 7 stories in 7 slices of ≤ 1 day each. DESIGN counts 3 new modules and 7 extended files. The walking skeleton has 2 integration points (keyboard → audio output). Estimate ≈ 25 h ≈ 3–4 days (slices: 4 + 3 + 4 + 3 + 4 + 5 + 2 h). Each outcome can ship on its own; only US-06 and US-07 (music) depend on each other, and they can be dropped together.

## Wave: DISCUSS / [REF] Story map and slice order

Backbone: **open → start → fight → pressure → bonus → lose a home → silence → outcome** (see the [journey](../../product/journeys/play-a-session.yaml)).

| Order | Slice | Story | Why this position |
|---|---|---|---|
| 1 | [01 Hear your shots](slices/slice-01-hear-your-shots.md) | US-01 | Walking skeleton; riskiest technical bet first (latency in 3 engines); highest opportunity (17) |
| 2 | [02 Silence with M](slices/slice-02-silence-with-m.md) | US-02 | Sound defaults to on, so control comes before more noise |
| 3 | [03 Marching beat](slices/slice-03-marching-beat.md) | US-03 | Next-highest uncertainty (follows the formation at any refresh rate); opportunity 15 |
| 4 | [04 Combat sounds](slices/slice-04-combat-sounds.md) | US-04 | Completes the feedback job; tests the rate limit and the mix |
| 5 | [05 Big-moment jingles](slices/slice-05-big-moment-jingles.md) | US-05 | Opportunity 12; must sit well with the beat |
| 6 | [06 Background music](slices/slice-06-background-music.md) | US-06 | Opportunity 9 and the most taste-driven; can be dropped |
| 7 | [07 Music toggle](slices/slice-07-music-toggle.md) | US-07 | Only meaningful with music; dropped together with slice 06 |

Carpaccio taste tests: slice 01 ships 3 new modules with real value; every other slice ships fewer than 4 components. Every slice names what it would disprove, uses real gameplay and has a same-day dogfood moment; no two slices differ only in scale. **PASS.**

## Wave: DISCUSS / [REF] User stories

### US-01: Alex hears every shot and every hit
`job_id: J-SOUND-FEEDBACK` · slice 01 · ≤ 1 day

Alex fires dozens of shots a wave and can't always tell, among the particles and bolts, whether one connected.

#### Elevator Pitch
Before: Alex can only see shots and hits; the game is silent.
After: open the game in a desktop browser, press Enter, then Space → hears a short rising "pew" as the shot leaves the pin, and a "pop" when it hits a hurdle.
Decision enabled: Alex knows by ear whether the shot connected, and decides when to fire again and where to move without tracking every pixel.

**UAT scenarios**
1. *Silent until the first key.* Given Alex has just opened the game, When the title screen has shown for 5 seconds, Then no sound has played and no errors or audio warnings appear.
2. *Immediate.* Given a game in progress, When Alex presses Space, Then the "pew" starts no more than 17 ms (one 60 Hz frame) after the key press.
3. *Hit sounds by value.* Given a wave in progress, When Alex's shots hit a Damp (£50), a Broken Chain (£100), a Rate Rise (£150), a Stamp Duty (£200) and a Gazumper (£300), Then each hit makes a "pop", each higher-pitched than the one before.
4. *Bursts stay tidy.* Given the game's sound is on, When 20 sounds start at the same moment, Then no more than 8 ever sound together, and the oldest are cut first.
5. *Silent but working when sound is unavailable.* Given Alex's browser can't play sound, When they start a game and fire at the Damp above them, Then the deposit rises to £50 and nothing is heard.
6. *Silent but working when sound fails to start.* Given Alex's browser fails to start sound, When they start a game and fire at the Damp above them, Then the deposit rises to £50, nothing is heard and no error appears.

**Acceptance criteria**
- [ ] No sound and no errors before the first key press.
- [ ] The shot sound starts no more than 17 ms after the key press.
- [ ] The hurdle-hit sound knows the hurdle's value, and its pitch rises with it (£50 < £100 < £150 < £200 < £300).
- [ ] At most 8 sounds overlap.
- [ ] When sound is unavailable or fails to start, the game plays normally and silently.

**Technical notes**: browsers start audio only after a user gesture. Tests can't hear, so the audio layer reports what it started (ADR-003). Automated in Chromium, Firefox and WebKit; real Safari is a manual check (D10). Crackle is a dogfood and playtest question, not an AC.
**Dependencies**: game walking skeleton (done).

### US-02: Alex silences the game with M
`job_id: J-SOUND-CONTROL` · slice 02 · ≤ 1 day

Alex sometimes plays where sound isn't welcome. The game starts with sound on, so they need one key that turns it off and remembers.

#### Elevator Pitch
Before: The only way to silence the game is the laptop's mute key, which silences everything else too.
After: press M at any time → all game sound stops before the next frame and the HUD shows "SOUND OFF"; reopening the game starts muted.
Decision enabled: Alex decides to keep playing somewhere quiet instead of closing the game.

**UAT scenarios**
1. *Mute mid-wave.* Given Alex is playing and has just heard a shot, When they press M, Then all sound stops before the next frame, the HUD shows "SOUND OFF" and screen readers hear "Sound off. Press M to turn it on."
2. *Silent shots.* Given the sound is off, When Alex fires at the Damp above them, Then the deposit rises to £50 and nothing is heard.
3. *Unmute.* Given the sound is off, When Alex presses M, Then the HUD shows "SOUND ON", "Sound on." is announced and the beat is heard again.
4. *Remembered.* Given Alex muted on an earlier visit, When they start a game, Then the HUD shows "SOUND OFF" and nothing plays.
5. *Everywhere.* Given Alex is on the title, pause or game-over screen, When they press M, Then the sound switches off the same way.
6. *Sound still starts on when saved settings are unavailable.* Given the browser blocks saved settings and the HUD shows "SOUND ON", When Alex presses M, Then it shows "SOUND OFF".
7. *Unmuting while paused.* Given the game is paused with the sound off, When Alex presses M, Then nothing plays until they resume.

**Acceptance criteria**
- [ ] M toggles all sound on every screen; sound stops before the next frame.
- [ ] The HUD shows SOUND ON/OFF; the title controls line includes "M sound".
- [ ] Each change is announced to screen readers.
- [ ] The setting persists across visits and defaults to on when it can't be saved.
- [ ] Unmuting while paused stays silent until play resumes.

**Technical notes**: same guarded-storage pattern as the best score; same status mirror.
**Dependencies**: US-01.

### US-03: Alex hears the formation march faster and faster
`job_id: J-SOUND-TENSION` · slice 03 · ≤ 1 day

As Alex clears hurdles, the formation speeds up, but nothing tells them danger is rising unless they look.

#### Elevator Pitch
Before: The speed-up is only visible; danger creeps up unnoticed.
After: press Enter to start a wave → hears a four-note bass beat, one note per formation step, faster as hurdles fall, silent while paused.
Decision enabled: Alex senses the urgency and decides to go for the lowest hurdles before the formation reaches the houses.

**UAT scenarios**
1. *Start tempo.* Given a new wave with all 55 hurdles, When the formation marches 8 steps, Then one bass note plays per step, cycling four descending notes, 0.53 s ± 10% apart.
2. *Speeding up.* Given 10 hurdles are left in the first wave, When the formation marches, Then the notes are 0.12 s ± 10% apart.
3. *Pause or leave.* Given the beat is playing, When Alex pauses with P or Esc, switches window or hides the tab, Then all sound stops before the next frame.
4. *Resume.* Given the game is paused, When Alex resumes, Then the beat plays again.
5. *Respawn.* Given the beat is playing, When a bolt hits Alex's pin, Then no beat plays until the pin is back, and then the beat plays again.
6. *Banner.* Given Alex has just cleared the last hurdle, When the "Wave cleared!" banner shows for 2.4 s, Then no beat plays.
7. *Game over.* Given the game is over, When anything else happens before a new game, Then no beat plays.

**Acceptance criteria**
- [ ] Exactly one beat note per formation step, in a four-note cycle.
- [ ] The tempo follows the formation's step interval (0.53 s ± 10% at 55 hurdles; 0.12 s ± 10% at 10, first wave).
- [ ] No beat while paused, respawning, on the "Wave cleared!" banner, or after game over; it plays again after a respawn or a resume.
- [ ] Switching window or hiding the tab silences everything before the next frame.
- [ ] The same tempo on 60 Hz and 120 Hz displays (manual check, D10).

**Technical notes**: the formation steps in fixed 120 Hz simulation steps, so the beat follows simulation steps, not display frames.
**Dependencies**: US-01, US-02.

### US-04: Alex hears hits on houses, homes lost and bolts stopped
`job_id: J-SOUND-FEEDBACK` · slice 04 · ≤ 1 day

In a busy wave Alex can't tell whether their cover is crumbling, whether they've lost a home, or whether a shot stopped a bolt. The three sounds share one outcome: *knowing what just happened in the fight by ear*.

#### Elevator Pitch
Before: House hits, losing a home and stopping a bolt look alike in the chaos.
After: fire Space into a house, or let a bolt hit one → hears a dull thud; get hit → hears a falling explosion; shoot a falling bolt → hears a "tink".
Decision enabled: Alex knows when their cover is going or they've lost a home, and decides whether to move to another house.

**UAT scenarios**
1. *Shot into a house.* Given Alex stands under the second house, When they fire, Then a thud plays.
2. *Bolt into a house.* Given a bolt is falling towards a house, When it hits the house, Then a thud plays.
3. *Many hits.* Given the sound is on, When 7 hits land 20 ms apart (0–120 ms of game time), Then exactly 3 thuds play, at 0, 60 and 120 ms; the others are dropped, not queued.
4. *Home lost.* Given Alex has 3 homes, When a bolt hits the pin, Then a falling explosion plays.
5. *Bolt stopped.* Given a Stamp Duty bolt is falling, When Alex's shot meets it, Then a "tink" plays.
6. *Muted.* Given the sound is off, When a house is hit, a home is lost or a bolt is stopped, Then nothing plays.

**Acceptance criteria**
- [ ] Distinct sounds for house hit, home lost and bolt stopped.
- [ ] House-hit sounds at least 50 ms apart in game time: a hit is dropped only if it lands less than 50 ms after the last played thud.
- [ ] Respects mute.
- [ ] Clean under the spike's stress scene (40 bolts, 3,000 particles). Manual check (D10): the deliverer listens for 30 s on laptop speakers and on headphones; it passes if no clicks, crackle or distortion are heard. K6 covers the cost.

**Technical notes**: these moments already exist in the game rules.
**Dependencies**: US-01, US-02, US-03.

### US-05: Alex hears the big moments
`job_id: J-SOUND-CELEBRATION` · slice 05 · ≤ 1 day

The Dream Home is easy to miss, and cleared waves and game-overs pass in silence. One outcome: *each big moment is recognisable by ear*.

#### Elevator Pitch
Before: The Dream Home, a cleared wave and game over are only on screen.
After: press Enter → "ding-dong" doorbell; the Dream Home flies over → a warbling siren; shoot it → "ka-ching"; clear a wave → a rising fanfare; lose → a descending tune.
Decision enabled: Hearing the Dream Home arrive, Alex decides to go for the bonus; the end jingles tell them how it went without reading.

**UAT scenarios**
1. *Start.* Given the title screen, When Alex presses Enter, Then the doorbell plays.
2. *Dream Home.* Given a wave in progress, When the Dream Home enters, Then a siren loops while it is on screen.
3. *Saved.* Given the siren is playing, When Alex shoots the Dream Home and "+£1,500" appears, Then "ka-ching" plays and the siren stops.
4. *Wave cleared.* Given the siren is playing, When Alex clears the last hurdle of Studio flat, Then the siren stops and a fanfare of at most 2.4 s plays.
5. *Game over.* Given the siren is playing, When Alex loses their last home ("Offer rejected") or is overrun ("Gazumped!"), Then the siren stops and the game-over tune plays.
6. *Pause and resume.* Given a pause stopped the siren while the Dream Home is still on screen, When Alex resumes, Then the siren plays again.
7. *Muted.* Given the sound is off, When any of these moments happens, Then no jingle plays.

**Acceptance criteria**
- [ ] Five distinct jingles: start, Dream Home siren, saved, wave cleared, game over.
- [ ] The siren plays only while the Dream Home is on screen and the game is audible.
- [ ] The wave-cleared fanfare lasts ≤ 2.4 s.
- [ ] Respects mute and pause.

**Technical notes**: all these moments exist in the game rules; some currently clear the Dream Home without telling anyone (DESIGN fixes this).
**Dependencies**: US-01, US-02, US-03.

### US-06: Alex plays to background music
`job_id: J-SOUND-ATMOSPHERE` · slice 06 · ≤ 1 day

Between effects the game feels empty.

#### Elevator Pitch
Before: The game has no mood between effects.
After: press Enter to start a game → hears a quiet chiptune loop under the beat and effects.
Decision enabled: Alex decides, wave by wave, whether to keep the music on or switch to effects only (N, US-07).

**UAT scenarios**
1. *Music on start.* Given music is on, When Alex starts a game, Then a quiet loop plays under the beat and effects.
2. *Level.* Given music and effects are both on, When a game is playing, Then the music is set at least 6 dB below the effects.
3. *Pause.* Given the music is playing, When Alex pauses, Then the music stops.
4. *Resume.* Given the game is paused with music on, When Alex resumes, Then the music plays again.
5. *Game over.* Given the music is playing, When the game ends, Then the music stops.
6. *Unmute.* Given music is on and the sound is off, When Alex presses M, Then the music comes back.
7. *Loop.* Given the music is playing, When 5 minutes pass, Then no gap is heard at the loop point (manual check, D10).

**Acceptance criteria**
- [ ] Music plays during a game, set at least 6 dB below the effects.
- [ ] The music pauses and resumes with the game, stops on game over, and comes back when unmuting.
- [ ] Seamless loop (manual check, D10).

**Technical notes**: pick a key that sits with the beat's four notes. Dropped as one unit with US-07 if K4 fails (D12).
**Dependencies**: US-01, US-02, US-03.

### US-07: Alex turns just the music off with N
`job_id: J-SOUND-CONTROL` · slice 07 · ≤ 1 day

Not everyone wants music, but they still want the effects.

#### Elevator Pitch
Before: Alex can only silence everything (M), losing the useful effects.
After: press N → the music stops while effects continue, the HUD shows "MUSIC OFF", and it stays off next visit.
Decision enabled: Alex keeps the effects they rely on without music they don't want.

**UAT scenarios**
1. *Music off.* Given music is playing, When Alex presses N, Then the music stops, the HUD shows "MUSIC OFF", the sound setting stays on and "Music off. Press N to turn it on." is announced.
2. *Effects continue.* Given the music is off, When Alex fires, Then the shot is heard.
3. *Remembered.* Given Alex turned the music off on an earlier visit, When they start a game, Then no music plays.
4. *Mute wins.* Given the music and the sound are both off, When Alex presses M, Then the sound comes back without music.
5. *Everywhere.* Given Alex is on the title, pause or game-over screen, When they press N, Then the music switches off the same way.
6. *Music still starts on when saved settings are unavailable.* Given the browser blocks saved settings and the HUD shows "MUSIC ON", When Alex presses N, Then it shows "MUSIC OFF".

**Acceptance criteria**
- [ ] N toggles music only, on every screen; persisted; on by default when it can't be saved; shown in the HUD; announced; "N music" in the controls line.
- [ ] Unmuting with M brings the music back only if it is on.

**Technical notes**: same storage and status pattern as M.
**Dependencies**: US-06, US-02.

## Wave: DISCUSS / [REF] Outcome KPIs

**Playtest protocol** (K1–K4, K8, K9): 5 people matching the persona (play casual games on a laptop, know UK house-buying, not on the team). Each plays three waves. Waves 1 and 2: one muted and one with sound, order alternated between people. Wave 3: sound on, with M and N free to use. n is recorded with every result.

| ID | KPI | Target | How measured | Gate |
|---|---|---|---|---|
| K1 | Hits feel better with sound | ≥ 4 of 5 prefer the wave with sound (waves 1–2) | Playtest form | soft |
| K2 | The beat adds urgency | ≥ 4 of 5 say the last 10 hurdles felt more urgent with the beat | Playtest form | soft |
| K3 | Mute is discoverable | 5 of 5 find how to mute within 10 s, unaided | Timed playtest task | soft |
| K4 | Music is wanted | ≥ 60% have music on at the end of wave 3. 40–60%: re-tune and repeat once (D12); still < 60% after the repeat, or < 40% at first: drop slices 06–07. The form also asks "could you hear the beat over the music?" | Observe the N setting; playtest form | soft |
| K5 | Sound is immediate | The shot sound starts no more than 17 ms (one 60 Hz frame) after the key press | Automated: `@kpi-K5` scenario, 3 engines, fake clock (journal `at` vs key-press time, same page clock) | hard |
| K6 | No performance cost | Sound adds ≤ 0.5 ms frame work over the same stress run without sound (D11: p95 in Chromium, mean in Firefox and WebKit) | Stress run with and without sound per slice that adds sounds. The tool is the spike's script (`git show 6801c46:.spike/measure/measure.js`), adapted to the real game in slice 04 | soft |
| K7 | No errors | 0 page errors or audio warnings; silent fallback when sound is unavailable or fails | Automated: `@kpi-K7` scenarios, 3 engines | hard |
| K8 | Big moments land | ≥ 4 of 5 name the outcome (bonus, wave cleared, game over) from the jingle alone, eyes closed | Playtest task | soft |
| K9 | Sound on by default is welcome | ≤ 1 of 5 say the sound bothered them or muted it for that reason | Post-session question | soft |

K5 and K7 run on every local `npm test`. CI automation belongs to the skipped DEVOPS wave; until then, the person delivering each slice owns the run.

## Wave: DISCUSS / [REF] Definition of Done

1. Every acceptance criterion is verified the way its row in the DISTILL traceability table says; automated rows are green in Chromium, Firefox and WebKit.
2. All sound scenarios and the game's walking skeleton are green; no `@pending` scenarios left.
3. K5 and K7 pass (hard gates).
4. K6 measured and recorded (soft gate: reviewed, not blocking).
5. Manual checks (D10) done and recorded by each slice's deliverer before closing the slice: real Safari, listening under the stress scene, the music loop seam, a 120 Hz display, the canvas HUD indicator and controls line.
6. Playtest run per the protocol; K1–K4, K8 and K9 recorded with n.
7. Settings persistence verified, including blocked storage.
8. README controls table updated (M, N).
9. Committed to `main`, with no new runtime dependencies.

## Wave: DISCUSS / [REF] Out of scope

Volume sliders or a settings menu · audio files or samples · stereo or positional panning · per-sound toggles · music on the title screen (a new story, not a fallback) · more than one music track · gamepad or haptics · mobile audio · visual captions for sounds.

**Accessibility**: every sound has a visual counterpart (the shot, the hit, the crumbling house, the banners). Screen readers already hear game started, home lost, wave cleared and game over from the status region. **Known gap**: the Dream Home's arrival is not announced to screen readers (it is visible, and audible as the siren). It is out of scope here and a candidate follow-up.

## Wave: DISCUSS / [REF] WS strategy

The feature's walking skeleton is **slice 01**: first key press → game → sound policy → synth → real browser audio output. Real local adapters (old strategy C): sound, storage and the page are local and free. Automated tests *observe* what the synth started (ADR-003); nothing replaces the real audio path.

## Wave: DISCUSS / [REF] Driving ports

- Keyboard: Enter, Space, ←/→ or A/D, **M**, **N**, P/Esc.
- Window focus and tab visibility (pause silences everything before the next frame).
- Page load (restores the saved settings).

## Wave: DISCUSS / [REF] Pre-requisites

- The game walking skeleton (commit `57d9c21`).
- Sound support in desktop browsers (Chromium, Firefox, WebKit/Safari). No external services.

## Wave: DISCUSS / [REF] DoR validation

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Problem statement clear | PASS | Each story opens with the player's pain in domain language |
| 2 | Persona with specifics | PASS | Alex Morgan, MacBook Air, speakers or AirPods, 5–10 minute sessions |
| 3 | ≥ 3 domain examples with real data | PASS | All five hurdles £50–£300; 0.53 s / 0.12 s; "+£1,500"; 7 hits → 3 thuds at 0/60/120 ms; 2.4 s banner |
| 4 | UAT scenarios in Given/When/Then, happy path and edge cases, 3–7 | PASS | 6–7 per story, every one with Given, When and Then |
| 5 | AC derived from UAT | PASS | Every AC has a UAT. The banner (US-03 UAT 6) and the 6 dB level (US-06 UAT 2) are verified by DELIVER unit tests (DISTILL traceability) |
| 6 | Right-sized | PASS | Each story ≤ 1 day with one outcome; US-04 and US-05 bundle sounds under one outcome each |
| 7 | Technical notes | PASS | On every story |
| 8 | Dependencies tracked | PASS | Music appears only in US-06/US-07 (droppable together); US-04/05 depend on US-02 and US-03 |
| 9 | Job traceability | PASS | Exactly one `job_id` per story, all in `jobs.yaml` |

## Wave: DISCUSS / [REF] Changed assumptions

- **Revision 2**: K6 was absolute (≤ 4 ms); it is now relative (D11). US-06 is split into US-06 (music) and US-07 (N). K5 is measured under the fake clock.
- **Revision 3**: music clauses removed from US-02, US-03 and US-05 (music lives only in US-06/US-07, so it can be dropped). One K5 wording everywhere (≤ 17 ms). The K6 statistic is per engine (D11). The playtest has three waves, so K4 is measurable. Every UAT is in strict Given/When/Then. New UATs: banner, 6 dB level, sound fails to start, N everywhere, music with blocked storage.

---

## Wave: DESIGN / [REF] DDD list

Scope: application / components (nw-solution-architect) · mode: propose · paradigm: OOP · density: lean · revision 3.

| ID | Decision | Verdict | One-line rationale |
|---|---|---|---|
| DDD-1 | The rules publish events into an outbox that only `game.js` owns: `emit(event)` inside the rules; `takeEvents()` returns and clears it. `main.js` takes the events once per frame, and at once on blur or hidden tab (DDD-9). | Accepted (user) | No lost events; carries details ([ADR-001](../../product/architecture/adr-001-game-events-outbox.md)) |
| DDD-2 | Our own Web Audio synth plays data recipes from `theme.js`. | Accepted (user) | No dependencies; readable, tunable sounds ([ADR-002](../../product/architecture/adr-002-hand-rolled-web-audio-synth.md)) |
| DDD-3 | Tests observe sound through the synth's journal, exposed read-only as `window.makeTheRightMove.audio`. | Accepted (user) | Meaningful assertions over the real audio path ([ADR-003](../../product/architecture/adr-003-sound-journal-for-tests.md)) |
| DDD-4 | The sound director returns cue plans and never touches the synth: `createSoundDirector({ sound, music }) → { handle(event) → Cue[] }`. Cues come out in event order. `main.js` passes each cue to `synth.perform(cue)`. | Accepted | Policy invariants can be checked over the returned plans for every event type |
| DDD-5 | `g.settings` is the single authority for the sound and music flags. `main.js` loads them and calls `applySettings({ sound, music })` before the first frame; M/N flip them in `handlePresses` and emit `soundToggled`/`musicToggled`; `main.js` saves them when it takes those events. Only `game.js` writes `g`. The director gets a copy at creation, then learns only from events. | Accepted (rev. 3) | One source of truth; the wiring layer never writes rule state |
| DDD-6 | The AudioContext is created and resumed only inside a keydown handler (`synth.unlock()`, idempotent). A browser-suspended context is resumed on the next keydown. | Accepted (rev. 3) | Safari needs a user gesture; a resume outside one could log an autoplay warning (K7) |
| DDD-7 | Events and cues carry simulation time `t`; rate limits use it with a 1e-6 s tolerance (`t − lastThud ≥ 0.05 − 1e-6`). Journal entries carry `seq`, `t` and `at` (page time). | Accepted (rev. 3) | Same behaviour under the fake clock and at any refresh rate; no float flakiness at the 6-step boundary |
| DDD-8 | One mute mechanism: the director. Sound off → a `silence` cue, then nothing audible; the synth has no master mute. | Accepted | No double mute |
| DDD-9 | On `blur` and `visibilitychange` (hidden), `main.js` calls `pause()`, takes the events and performs the cues straight away, without waiting for a frame. | Accepted | Hidden tabs stop `requestAnimationFrame` |
| DDD-10 | The diagnostics handle is data only: getters returning frozen copies, no functions, on a frozen `window.makeTheRightMove`. The game never exposes `perform` or `unlock`. | Accepted | Read-only in fact |
| DDD-11 | One vocabulary module, `src/events.js` (`GameEvent`, `CueOp`, `Sound`), imported by the rules, director, synth and tests. | Accepted | Typos can't fail silently |
| DDD-12 | Sound path budget: ≤ 0.5 ms per frame, as in D11. One shared noise buffer; short-lived nodes per voice. | Accepted | Meets K6 |
| DDD-13 | The voice cap (8, oldest cut first) is an adapter resource limit; *when* to play is the director's decision. | Accepted | Clear policy ownership |
| DDD-14 | The synth's platform capabilities are injected: `createSynth({ recipes?, createContext, now, setInterval, clearInterval })`, wired in `main.js`. The music look-ahead scheduler never schedules a note before the audio clock's current time. | Accepted (rev. 3) | No ambient globals in the adapter. Fast-forwarded timers in tests can't build a backlog, because the audio clock runs on real time (verified) |

## Wave: DESIGN / [REF] Component decomposition

Contract shapes: **pure** · **bounded-change** (declared universe and delta) · **unbounded-preservation** (invariants that hold for every input sequence) · **composition root** / **static** (exempt, universe listed).

| Component | Path | Change | Contract shape | Notes |
|---|---|---|---|---|
| Event vocabulary | `src/events.js` | CREATE NEW | pure | Constants only |
| Rules and state | `src/game.js` | EXTEND | bounded-change | Universe: `g` and the outbox. M/N delta: one flag in `g.settings` + one event; never `paused`, `state`, score, lives or timers. `applySettings` delta: `g.settings` only. Emit sites below |
| Loop and wiring | `src/main.js` | EXTEND | composition root | Universe: window listeners (keydown unlock, blur, visibilitychange, resize), the rAF loop, `window.makeTheRightMove`, settings load and save calls |
| Storage | `src/storage.js` | EXTEND | bounded-change | Universe: keys `make-the-right-move:sound` / `:music` (plus the existing best key); strict `'on'`/`'off'` parse; default on |
| Theme | `src/theme.js` | EXTEND | pure | Recipes, jingles, march notes, music, plus pure derivations (hit pitch by value) |
| Rendering | `src/render.js` | EXTEND | bounded-change | Universe: canvas pixels only. "SOUND OFF"/"MUSIC OFF" indicator; controls line "M sound  N music" |
| Status mirror | `src/status.js` | EXTEND | bounded-change | Universe: `[data-hud]` nodes and the live region. It announces when `state`, `paused`, `settings.sound` or `settings.music` change from the last frame |
| Page | `index.html` | EXTEND | static | Two `data-hud` fields (`sound`, `music`) |
| Sound director | `src/sound.js` | CREATE NEW | unbounded-preservation (plan-returning) | Invariants for every event sequence: nothing audible while muted or paused; thuds ≥ 50 ms apart; one note per step while playing. Exact plan = the policy table |
| Synth | `src/synth.js` | CREATE NEW | bounded-change per operation | See the synth operation table |
| Keyboard | `src/input.js` | none | n/a | M/N/Esc already flow through `takePressed()` |

### Synth operation table (`perform(cue)` and `unlock()`)

Universe: active voices, the named siren loop, the music scheduler and scheduled music notes, the journal, the AudioContext and the state.

| Operation | Delta when `running` | Already in that state | Journal |
|---|---|---|---|
| `unlock()` | `locked` → create the context (`createContext`) and resume → `running`; on throw or no Web Audio → `unavailable`. `suspended` → resume → `running` | `running` / `unavailable`: no-op | none |
| `play {sound, detail}` | Start one voice from the recipe; if 8 are sounding, cut the oldest first; `voices` + 1, `peakVoices` = max | Unknown sound: no-op | + 1 entry `{seq, sound, detail, t, at}` |
| `startLoop siren` | Start the loop | Already looping: no-op | + 1 entry if started |
| `stopLoop siren` | Stop the loop | Not looping: no-op | none |
| `startMusic` | Start the scheduler; `music = 'playing'` | Already playing: no-op | none |
| `stopMusic` | Stop the scheduler, cancel scheduled notes; `music = 'stopped'` | Already stopped: no-op | none |
| `silence` | Stop every voice (`voices = 0`), the loop, the scheduler and its scheduled notes (`music = 'stopped'`) | Nothing sounding: no-op | none |
| any `perform` while `locked`, `suspended` or `unavailable` (amended in DELIVER — see Changed assumptions) | No change | — | none |

State transitions: `locked → running` (unlock succeeds) · `locked → unavailable` (no Web Audio, or `createContext` throws) · `running → suspended` (browser suspends the context) · `suspended → running` (`unlock()` on the next keydown).

**Emit sites** (crafter's checklist, by function in `src/game.js`): `startGame` → `gameStarted` · `movePlayer` (shot created) → `shotFired` · `moveShot`: shield hit → `shieldHit {source:'shot'}`, bolt hit → `boltStopped`, hurdle hit (`killInvader`) → `hurdleHit {value}`, wave cleared → `dreamGone` (if a Dream Home was on screen) then `waveCleared`, Dream Home hit (`saveDream`) → `dreamSaved {bonus}` · `moveBolts`: shield hit → `shieldHit {source:'bolt'}` · `killPlayer` → `homeLost {livesLeft}` · `stepFormation` → `formationStepped {alive}` (and, when overrun, then `gameOver`) · `moveDream`: spawn → `dreamAppeared`, off screen → `dreamGone` · `gameOver` → `dreamGone` (if a Dream Home was on screen) then `gameOver {reason}` · `handlePresses`: P/Esc → `paused`/`resumed`; M → `soundToggled {on}`; N → `musicToggled {on}` (M and N are independent `if` statements outside the existing `else if` chain) · `pause()` → `paused` (only if it changes the state). `saveDream` implies the Dream Home is gone. Both `shieldHit` sources make the same thud.

**Music as one removable unit** (D4, D12): the director's music cues (`startMusic` in `gameStarted` and restore, the `musicToggled` rows); `g.settings.music`, its `applySettings` field and save path; the `:music` storage key; the synth's music scheduler, music bus and `diagnostics.music`; `MUSIC` in theme; the N key and `musicToggled`; `[data-hud="music"]` and its announcement; "MUSIC OFF" and the "N music" controls text. `CueOp.START_MUSIC`/`STOP_MUSIC` may stay as unused constants. Without music, "restore" is just the siren, which still works.

### Director policy table

Audible = sound on, game in progress (started and not over), not paused. "Restore" = `startMusic` if music on, plus `startLoop siren` if the Dream Home is on screen. Cues are produced in event order (for example `formationStepped` then `gameOver` in the same step: a march note, then `silence` and the tune).

| Event | Policy state change | Cues |
|---|---|---|
| `gameStarted` | in game, not over, not paused, march index 0, no dream, no last thud | if sound on: `play doorbell`, then `startMusic` if music on |
| `shotFired` / `hurdleHit` / `boltStopped` / `homeLost` | — | if audible: `play` shot / hurdle-hit `{value}` / bolt-stopped / home-lost |
| `shieldHit` | last thud = `t`, only when a thud plays | if audible and (no last thud or `t − lastThud ≥ 0.05 − 1e-6`): `play shield-hit`; else dropped, not queued |
| `formationStepped` | march index + 1 (only while in game and not paused, even if muted) | if audible: `play march {note: index mod 4}` |
| `dreamAppeared` | dream on screen | if audible: `startLoop siren` |
| `dreamGone` | no dream | `stopLoop siren` |
| `dreamSaved` | no dream | `stopLoop siren`; if audible: `play ka-ching` |
| `waveCleared` | no dream | `stopLoop siren`; if audible: `play fanfare` |
| `gameOver` | over, no dream | `silence`; if it was audible: then `play game-over` |
| `paused` | paused | `silence` |
| `resumed` | not paused | if sound on and in game: restore |
| `soundToggled {on:false}` | sound off | `silence` |
| `soundToggled {on:true}` | sound on | if in game and not paused: restore (unmuting while paused stays silent until `resumed`) |
| `musicToggled {on:false}` | music off | `stopMusic` |
| `musicToggled {on:true}` | music on | if audible: `startMusic` |

Edge rows: M while respawning → normal toggle and restore. Resume while muted → no cues. A game over can't happen while paused (the rules don't update while paused). The siren and music don't survive a pause; they are restored on resume. The banner (`clear` state) produces no `formationStepped`, so no beat; the formation steps only during play (a rules property, checked by a DELIVER unit test).

## Wave: DESIGN / [REF] Driving ports

- Keyboard in the page (`src/input.js` → `handlePresses` / `update`): Enter, Space, ←/→/A/D, P/Esc, **M**, **N**.
- Every keydown → `synth.unlock()` (DDD-6: creates on the first one, resumes a suspended context later; otherwise a no-op).
- Window `blur` and document `visibilitychange` (hidden) → `pause()` plus an immediate flush (DDD-9).
- Page load → settings loaded by `main.js` and applied with `applySettings`. The best score is loaded by `game.js` (pre-existing accepted exception).

## Wave: DESIGN / [REF] Driven ports + adapters

| Port | Adapter | In acceptance tests |
|---|---|---|
| Audio output | `src/synth.js` on Web Audio (`createContext` injected) | Real; observed through the journal. Headless Chromium, Firefox and WebKit verified ([check](design/web-audio-headless-check.md)) |
| Audio clock | `AudioContext.currentTime` | Real; it runs on real time even when Playwright fast-forwards page time (verified, same check) |
| Music timer | `setInterval` / `clearInterval` (injected) | Faked by Playwright's clock. Harmless: the scheduler only schedules notes up to the audio clock + 100 ms, which barely moves while page time is fast-forwarded |
| Page clock | `performance.now` (injected as `now`) | Faked by Playwright's clock; used for journal `at` and K5 |
| Screen | `src/render.js` on Canvas2D | Real, not asserted on (D10 manual) |
| Accessibility tree | `src/status.js` on the DOM | Real, asserted on |
| Persistence | `src/storage.js` on localStorage | Real, fresh context per test |

## Wave: DESIGN / [REF] Technology choices

- JavaScript ES2022 modules, no bundler, no runtime dependencies.
- Web Audio API: `AudioContext` (`webkitAudioContext` fallback), `OscillatorNode`, `GainNode`, and `AudioBufferSourceNode` with one shared noise buffer.
- Node 22 for `scripts/serve.mjs` (dev and tests only).
- Playwright `@playwright/test` 1.62.1, `playwright-bdd` 9.2.1, `fast-check` 4.10.2 (dev only; property scenarios for the director).
- Target: current desktop Chrome/Edge, Firefox and Safari.

**Security and exposure**: client-only, with no personal data and no network calls besides the font. The only global is the frozen, data-only diagnostics handle (DDD-10). Settings are strictly parsed `'on'`/`'off'` strings that default to on.

## Wave: DESIGN / [REF] Decisions table

| ID | Decision |
|---|---|
| DDD-1 | Outbox owned by `game.js` (`emit`, `takeEvents`) |
| DDD-2 | Hand-rolled Web Audio synth, recipes as data |
| DDD-3 | Sound journal + read-only `window.makeTheRightMove.audio` |
| DDD-4 | Director returns cue plans in event order; `main.js` performs them |
| DDD-5 | `g.settings` authority; `applySettings` from `main.js`; director learns by events |
| DDD-6 | AudioContext created and resumed only in keydown handlers |
| DDD-7 | Simulation time on events, cues and journal; 1e-6 s tolerance; journal `seq` |
| DDD-8 | Single mute mechanism (director `silence`) |
| DDD-9 | Immediate silence on blur / hidden tab |
| DDD-10 | Data-only, frozen diagnostics |
| DDD-11 | One vocabulary module (`src/events.js`) |
| DDD-12 | Sound path ≤ 0.5 ms per frame (D11 statistic) |
| DDD-13 | Voice cap is an adapter resource limit |
| DDD-14 | Synth capabilities injected; scheduler bounded by the audio clock |

## Wave: DESIGN / [REF] Reuse Analysis

| Existing component | File | Overlap | Decision | Contract shape | Justification |
|---|---|---|---|---|---|
| Rules and state | `src/game.js` | Knows every sound-worthy moment; handles one-shot keys and pause | EXTEND | bounded-change | One `emit` per existing branch; M/N next to P; `applySettings` |
| Loop and wiring | `src/main.js` | Wires adapters, owns the frame pipeline | EXTEND | composition root | One more consumer; settings load and save; blur and visibility flush; capability wiring |
| Status mirror | `src/status.js` | Announces state | EXTEND | bounded-change | Announcing the sound and music state is its job. It diffs state, which is fine for text but loses events, so sound policy stays out |
| Storage | `src/storage.js` | Guarded persistence | EXTEND | bounded-change | Same pattern, two keys, strict parse |
| Theme | `src/theme.js` | "Theme is data" | EXTEND | pure | Recipes are theme data like colours and art |
| Rendering | `src/render.js` | Draws the HUD and controls line | EXTEND | bounded-change | Two indicators, one line of text |
| Page | `index.html` | Hosts the status fields | EXTEND | static | Two `data-hud` fields |
| Keyboard | `src/input.js` | Key handling | NONE | n/a | No change needed |
| (none) | `src/synth.js` | No audio code exists | CREATE NEW | bounded-change | A separate output platform (Web Audio) with its own resources; it sits beside `render.js` as a sibling adapter |
| (none) | `src/sound.js` | Toggles live in `game.js`; `status.js` reacts to state | CREATE NEW | unbounded-preservation | Rate limits, the march cycle, loop restoration and the music lifecycle are audio policy. In the rules they would make the rules depend on audio concepts; in the synth they would be untestable without Web Audio |
| (none) | `src/events.js` | Event strings were implicit | CREATE NEW | pure | One declaration for producer, consumer and tests |

**Accepted exceptions** (the rules' imports): `storage.js` for the best score (pre-existing, commit `57d9c21`); `events.js` (pure constants, no adapter). Nothing else is added to `game.js`'s imports.

## Wave: DESIGN / [REF] Open questions

- **Recipes and timbres** (DELIVER): tuned by ear per slice. The pitch-by-value ordering, the fanfare length (≤ 2.4 s) and the 6 dB bus levels are covered by DELIVER unit tests.
- **Music loop** (slice 06): composition, and a key that fits the march notes.
- **Rules properties** (DELIVER unit tests): the step interval at 55 and 10 hurdles; the formation doesn't step outside `play` (banner, respawn).

## Wave: DESIGN / [REF] Changed assumptions

- **Revision 2**: the outbox is owned by `game.js` (`takeEvents`); no master mute in the synth; ADR-003's handle shape grew; the director returns plans instead of holding the synth.
- **Revision 3**: rule imports now record `events.js` as an accepted exception (revision 2 wrongly said "nothing new"). `applySettings` replaces `main.js` writing `g`. The window-focus resume is removed (not a user gesture). The synth's capabilities are injected (DDD-14). Each synth operation has a declared delta and idempotence. The journal gains `seq`. The rate-limit tolerance is explicit. The music removable unit is complete. K6 uses a per-engine statistic.

## Wave: DESIGN / [REF] Wave decisions summary

- **Pattern**: modular monolith with ports and adapters (browser SPA). **Paradigm**: OOP (`CLAUDE.md`).
- **New**: `events.js`, `sound.js`, `synth.js`. **Extended**: `game.js`, `main.js`, `storage.js`, `theme.js`, `render.js`, `status.js`, `index.html`.
- **Constraints**: the rules import only `events.js` beyond the pre-existing best-score storage; only `game.js` writes `g`; the director has no synth reference; one mute mechanism; silence on blur or hidden happens without a frame; diagnostics are data-only and frozen; audio starts and resumes only in keydown handlers; synth capabilities are injected; rate limits use simulation time with a 1e-6 s tolerance; sound path ≤ 0.5 ms per frame.
- **SSOT**: [brief](../../product/architecture/brief.md), ADR-000…003 (revision 3).
- **Outcome collision check**: `nwave-ai outcomes check-delta` exits 0.

---

## Wave: DEVOPS / [REF] Environment matrix

Run on 2026-10-24, after DELIVER (the wave was skipped before DISTILL). It sits here by wave order and changes no earlier decision. Machine-readable version: [environments.yaml](environments.yaml). Config: [netlify.toml](../../../netlify.toml), [scripts/build.mjs](../../../scripts/build.mjs).

| Environment | URL | Platform | Deploy trigger | Preconditions |
|---|---|---|---|---|
| production | https://maketherightmove.fabiodamico.xyz | Netlify static hosting | push to `main` | Site linked to `lagom1985/rightmove-space-invaders`; custom domain added in Netlify (the apex already uses Netlify DNS, so the record and the Let's Encrypt certificate are automatic) |
| deploy-preview | generated per deploy by Netlify | Netlify static hosting | pull request or branch push | Same site and same `netlify.toml` |
| local | http://localhost:4173 | Node 22, `npm start` | manual | `npm install`; `npx playwright install` for the browser projects |

Platform coverage: desktop Chrome and Edge, Firefox and Safari, current versions. Tested with Playwright's desktop Chrome, Firefox and WebKit devices; real Safari stays a manual check (D10). Phones and narrow windows get the "play on desktop" screen.

DISTILL's player-state variants apply to every environment: `clean` (first visit), `with-stale-config` (saved sound and music settings); `with-pre-commit` is not applicable.

## Wave: DEVOPS / [REF] CI/CD pipeline outline

Platform: Netlify builds from the GitHub repo. No GitHub Actions, no containers. Nothing is pushed by the delivery tooling: the owner links the site once (see Pre-requisites).

| Stage | Command | Gate type | What it checks |
|---|---|---|---|
| Install | `npm install` (Netlify, automatic) | blocking | Dependencies from `package-lock.json`; Playwright browsers are not downloaded |
| Test gate | `bddgen && playwright test --project=unit --project=in-memory` | blocking | 46 tests, about 2 s: the unit properties (fast-check) and the 23 director scenarios, with no browser. `bddgen` generates the specs first |
| Build | `node scripts/build.mjs` | blocking | Cleans `dist/`, copies `index.html` and `src/` only (14 files). No tests, docs or `node_modules` are published |
| Publish | Netlify | atomic | Serves `dist/` with the headers from `netlify.toml`, only if every stage above passed |

Single command: `npm run build` (Netlify runs it from `netlify.toml`, with `NODE_VERSION = "22"`).

| Trigger | Result |
|---|---|
| Push to `main` | Full pipeline, then publish to production |
| Pull request, branch push | Same pipeline, then a deploy preview (never the production URL) |
| Failing test or build | Build fails, nothing is published, the previous deploy keeps serving |

Checked locally: with `PLAYWRIGHT_BROWSERS_PATH` pointing at an empty folder the gate passes (46 passed), so no browser is needed. With `CI=true` (as on Netlify) Playwright starts its own `npm start` and stops it again. A throwaway failing unit spec made `npm run build` exit 1 and left no `dist/`. Serving `dist/` in Chromium loaded all 12 modules and the stylesheet with no 404 and no page error, and audio unlocked on the first key press.

Headers (all responses): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`. Cache: `/` and `/index.html` `no-cache`; `/src/*` `public, max-age=0, must-revalidate`, because the files are not content-hashed. No `Content-Security-Policy`: a policy would have to allow Google Fonts and Web Audio, and the game takes no user-supplied content.

Local gates: none added (no hooks). `npm test` before pushing to `main` is the only way to run K5 and K7, because a push to `main` deploys.

## Wave: DEVOPS / [REF] Monitoring contracts

No runtime monitoring: there is no server, and the game collects nothing. Each KPI in [kpi-contracts.yaml](../../product/kpi-contracts.yaml) keeps its existing instrument. This table says where each one runs now that a deploy exists.

| KPI | Gate | Instrument | Runs in the Netlify build? |
|---|---|---|---|
| K1 Hits feel better | soft | Playtest form | No: manual, once. Playtesters can use the production URL or a deploy preview |
| K2 Beat adds urgency | soft | Playtest form | No: manual, once |
| K3 Mute is discoverable | soft | Timed playtest task | No: manual, once |
| K4 Music is wanted | soft | Observing the N setting at the end of wave 3 | No: manual, once (plus one repeat if 40-60%) |
| K5 Sound is immediate | **hard** | `@kpi-K5` scenario, `@real-io`, 3 engines | **No**: browser scenario. Runs in `npm test` on the developer's machine |
| K6 No performance cost | soft | `node scripts/measure-performance.mjs` (own server on port 4181; browsers) | No: run by hand once per slice that adds sounds |
| K7 No errors | **hard** | Three `@kpi-K7` scenarios (`@real-io`, 3 engines) | **Partly**: the browser scenarios run locally only. The unit specs `synth-fail-safe`, `synth-suspended` and `settings-parse`, which cover the silent fallback and blocked storage without a browser, do run in the gate |
| K8 Big moments land | soft | Playtest task | No: manual, once, after slice 05 |
| K9 Sound on by default is welcome | soft | Post-session question | No: manual, once |

Consequence: the two hard gates are only fully enforced locally. Netlify stops a regression in the director, the synth's fail-safe and the pure rules, but a browser-only break (K5 timing, a page error) reaches production unless `npm test` was run first. Accepted for now: the user chose the light gate so that Netlify needs no browsers. If this bites, the next step is a GitHub Actions job running the browser projects on pull requests, not browsers in the Netlify build.

## Wave: DEVOPS / [REF] Deployment strategy

**Netlify atomic deploys.** Every build produces an immutable deploy; Netlify switches production to a new deploy only when the build succeeds, so there is no half-deployed state and no downtime. Canary, blue-green and rolling were rejected: one static site with no server, no state and no migrations has nothing to shift gradually, and Netlify already gives the instant switch.

**Rollback (designed first):** Netlify → Deploys → pick a previous deploy → Publish deploy. No rebuild and no code change; it takes seconds. Netlify then stops auto-publishing (the Deploys page offers "Start auto publishing"), so a later push does not undo the rollback unnoticed. The code fix goes to `main` as a normal commit (or `git revert`); then click "Start auto publishing" again. Browsers pick up the rollback on the next page load because `index.html` and `src/*` revalidate on every request.

Release check before a push to `main`: `npm test` green (148 tests, includes K5 and K7), then `npm run build`.

## Wave: DEVOPS / [REF] Mutation testing strategy

**Disabled** (user, 2026-10-24). Test quality is validated through code review and the test suite. Persisted in `CLAUDE.md` under `## Mutation Testing Strategy`. This supersedes the "nightly-delta" strategy named in DELIVER's Quality gates and in the evolution record; no nightly job was ever set up.

## Wave: DEVOPS / [REF] Observability stack

**None** (user, 2026-10-24). No logs, metrics, traces, analytics or error tracking. Rationale: the game is static, has no server and handles no personal data, and the KPIs come from the playtest (K1-K4, K8, K9) or from the test suite and the K6 script (K5, K6, K7). Netlify's own deploy log and the deploy list are the only operational record. SLOs are not defined: with no users to page, an availability target would measure Netlify, not this game.

## Wave: DEVOPS / [REF] Branching strategy

**Trunk-based on `main`** (current practice). Commits go to `main`; short-lived branches, if used, get a deploy preview. Every push to `main` is a production deploy, so `main` must stay releasable: run `npm test` first. No branch protection or required checks are configured; the Netlify build gate is the only automated check.

## Wave: DEVOPS / [REF] Coexistence matrix

| Tool | Must keep working | How |
|---|---|---|
| `@playwright/test` 1.62.1 | yes | `dist/` is separate from `tests/`; `npm start` still serves the repo root; `npm test` is unchanged |
| `playwright-bdd` 9.2.1 | yes | The gate runs `bddgen` first; `.features-gen/` stays git-ignored |
| `fast-check` 4.10.2 | yes | Unit properties run in the gate |

Nothing else is present: no husky, pre-commit, GitHub Actions or containers.

## Wave: DEVOPS / [REF] Pre-requisites

- **Owner, once, in Netlify** (nothing in the repo can do this): (a) Add new site → Import from GitHub → `lagom1985/rightmove-space-invaders` (build settings come from `netlify.toml`); (b) Domain management → Add domain → `maketherightmove.fabiodamico.xyz` (Netlify DNS adds the record; the HTTPS certificate is automatic); (c) rollback is Deploys → a previous deploy → Publish deploy.
- Check the first deploy log: the test gate starts `npm start` on port 4173 inside the Netlify build. If the port or `localhost` resolution is a problem there, that is where it shows.
- DESIGN constraints held: no runtime dependencies and no bundler (the build only copies files); the frozen diagnostics handle and the sound journal are untouched (ADR-003); Google Fonts remains the only third-party request.
- Still owed from DELIVER and unchanged by this wave: the D10 manual checks (real Safari, listening tests) and the playtest for K1-K4, K8, K9.
- Not done here: pushing, creating the Netlify site, DNS. The `docs/feature/.../devops/wave-decisions.md` of the legacy layout is not produced; this section is the record.

---

## Wave: DISTILL / [REF] Scenario list with tags

51 scenarios (56 runnable examples, counting three outlines) in [tests/e2e/rightmove-invaders-sound/acceptance/](../../../tests/e2e/rightmove-invaders-sound/acceptance/), all `@pending`. The 28 `@real-io` scenarios (33 browser examples) run in Chromium, Firefox and WebKit; the 23 `@in-memory` ones run once, with no browser. Error paths: 13 (25%). Edge cases: 11 (22%). Together 24 of 51 (47%). Edge cases count toward the 40% target because each is a boundary of a failure mode: overload, unmuting while paused, the rate-limit window, settings on every screen. Every scenario has exactly one When.

| File | Scenario | Tags |
|---|---|---|
| walking-skeleton | Alex hears their shot and the hurdle it hits | @walking_skeleton @driving_port @real-io @US-01 |
| milestone-1 | The game stays silent until the first key press | @US-01 @real-io @error @kpi-K7 |
| milestone-1 | A shot is heard in the same frame it is fired | @US-01 @real-io @kpi-K5 |
| milestone-1 | Every shot is heard | @US-01 @real-io |
| milestone-1 | The hit sound knows which hurdle was hit | @US-01 @in-memory |
| milestone-1 | A burst of sounds never plays more than eight at once | @US-01 @real-io @adapter-integration @edge |
| milestone-1 | The game plays silently when sound is unavailable | @US-01 @real-io @error @kpi-K7 |
| milestone-1 | The game plays silently when sound fails to start | @US-01 @real-io @error @kpi-K7 |
| milestone-2 | M silences the game in the middle of a wave | @US-02 @real-io |
| milestone-2 | Shots make no sound while the sound is off | @US-02 @real-io |
| milestone-2 | M turns the sound back on | @US-02 @real-io |
| milestone-2 | The game remembers that the sound was off | @US-02 @real-io |
| milestone-2 | M switches the sound off on the title / pause / game over screen (outline ×3) | @US-02 @real-io @edge |
| milestone-2 | Sound still starts on when saved settings are unavailable | @US-02 @real-io @error |
| milestone-2 | While the sound is off, nothing the game does makes a sound | @US-02 @in-memory @property |
| milestone-2 | Turning the sound back on brings back the Dream Home siren | @US-02 @in-memory @edge |
| milestone-2 | Turning the sound on while paused stays silent until play resumes | @US-02 @in-memory @edge |
| milestone-3 | The formation marches to a four-note beat at its own pace | @US-03 @real-io |
| milestone-3 | Exactly one beat note per formation step, whatever the pace | @US-03 @in-memory @property |
| milestone-3 | Pausing with P / Escape stops the beat (outline ×2) | @US-03 @real-io @error |
| milestone-3 | Resuming starts the beat again | @US-03 @real-io |
| milestone-3 | Losing a home stops the beat until the pin is back | @US-03 @real-io @error |
| milestone-3 | Switching to another window silences the game without waiting for the next frame | @US-03 @real-io @error |
| milestone-3 | Hiding the game's tab silences the game without waiting for the next frame | @US-03 @real-io @error |
| milestone-3 | No beat after game over until a new game starts | @US-03 @in-memory @property @edge |
| milestone-4 | A shot into a house makes a thud | @US-04 @real-io |
| milestone-4 | A bolt hitting a house makes a thud | @US-04 @in-memory |
| milestone-4 | Losing a home is heard | @US-04 @real-io |
| milestone-4 | Stopping a bolt with a shot makes a tink | @US-04 @in-memory |
| milestone-4 | Seven hits in 120 ms make three thuds (at 0, 60, 120 ms) | @US-04 @in-memory @edge |
| milestone-4 | House hits never sound closer together than 50 ms | @US-04 @in-memory @property @edge |
| milestone-5 | Starting a game rings the doorbell | @US-05 @real-io |
| milestone-5 | The siren plays while the Dream Home is on screen | @US-05 @in-memory |
| milestone-5 | The siren stops when the Dream Home leaves | @US-05 @in-memory |
| milestone-5 | Saving the Dream Home stops the siren and plays ka-ching | @US-05 @in-memory |
| milestone-5 | Clearing a wave stops the siren and plays the fanfare | @US-05 @in-memory |
| milestone-5 | Losing the game plays the game-over tune | @US-05 @real-io |
| milestone-5 | Game over silences the Dream Home siren | @US-05 @in-memory @error |
| milestone-5 | Pausing silences the Dream Home siren | @US-05 @in-memory @error |
| milestone-5 | Resuming brings the siren back while the Dream Home is still on screen | @US-05 @in-memory @edge |
| milestone-6 | Music plays under the game | @US-06 @real-io |
| milestone-6 | Music pauses with the game | @US-06 @in-memory @error |
| milestone-6 | Music stops on game over | @US-06 @in-memory @error |
| milestone-6 | Turning the sound back on brings the music back | @US-06 @in-memory @edge |
| milestone-6 | Music comes back when play resumes | @US-06 @in-memory |
| milestone-7 | N turns just the music off | @US-07 @real-io |
| milestone-7 | The game remembers that the music was off | @US-07 @real-io |
| milestone-7 | With the music off, effects still play | @US-07 @in-memory |
| milestone-7 | Unmuting brings the music back only if it was on | @US-07 @in-memory @edge |
| milestone-7 | N switches the music off on the title / pause / game over screen (outline ×3) | @US-07 @real-io @edge |
| milestone-7 | Music still starts on when saved settings are unavailable | @US-07 @real-io @error |

Milestones 2, 3 and 5 carry `@sizing-review-needed` (8–9 scenarios each); DELIVER may split them into two roadmap steps.

## Wave: DISTILL / [REF] WS strategy

The project policy ([atdd-infrastructure-policy.md](../../architecture/atdd-infrastructure-policy.md)) replaces the per-feature A/B/C/D choice. In the old terms it is **C, real local**: keyboard, DOM, localStorage and Web Audio are real; the clock is faked (`page.clock`) and `Math.random` is seeded, so every run plays the same game.

**Documented deviation**: no spike promoted audio code, so the sound walking skeleton is `@pending` (RED) and is DELIVER's first step. **Enablement order**: walking skeleton first, then milestone order; re-run `RUN_PENDING=1 npx playwright test` before enabling each scenario. The suite is green at hand-off.

## Wave: DISTILL / [REF] Adapter coverage table

| Adapter | @real-io scenario | Covered by |
|---|---|---|
| `src/synth.js` (Web Audio) | YES | WS; M1 burst (`@adapter-integration`, synth hosted on its own); M1 unavailable and fails-to-start fallbacks |
| `src/storage.js` settings | YES | M2 "remembers" and "unavailable"; M7 "remembers" and "unavailable" |
| `src/status.js` (DOM) | YES | M2 and M7 setting and announcement checks |
| `src/render.js` (canvas) | WAIVED (user, D10) | Pixels not asserted; HUD indicator and controls line are a manual check; state mirrored by `status.js` (covered) |
| `src/sound.js` (director) | n/a | 23 `@in-memory` scenarios plus every `@real-io` sound scenario |

## Wave: DISTILL / [REF] Scaffolds

| File | Marker | Behaviour |
|---|---|---|
| `src/sound.js` | `export const __SCAFFOLD__ = true` | `createSoundDirector({ sound, music })` throws `Not yet implemented -- RED scaffold`; contract in the header |
| `src/synth.js` | `export const __SCAFFOLD__ = true` | `createSynth({...})` throws the same; capabilities, operations and journal schema in the header |

Real (no scaffold needed): `src/events.js`; `PLAYER_SPEED`, `RESPAWN_TIME` and `houseCentreX()` exported from `src/game.js` (behaviour-preserving; the game's walking skeleton stays green). `main.js` doesn't import the scaffolds yet. RED gate: [distill/red-classification.md](distill/red-classification.md).

## Wave: DISTILL / [REF] Test placement

`tests/e2e/rightmove-invaders-sound/acceptance/` follows the precedent of `tests/e2e/rightmove-invaders/acceptance/`. The sound suite has its own step phrases, all routed through `steps/game-driver.js` (browser) or `steps/director-harness.js` (in-memory). The vocabulary is `steps/domain-types.js` (re-exporting `src/events.js`) and `steps/parameter-types.js`. `fixtures/synth-host.html` hosts the synth on its own (`window.synth` is a test-only hook). The driver's cursor is the journal `seq`, never an array index. Pending scenarios run with `RUN_PENDING=1`; DELIVER enables one by deleting its `@pending` tag. fast-check uses seed 20261023 unless `FC_SEED` is set.

## Wave: DISTILL / [REF] Driving adapter coverage

| DESIGN driving port | Scenario(s) |
|---|---|
| Keyboard: Enter, Space, ←/→ | WS, M1 shots and frame timing, M4 house |
| Keyboard: M | M2 (all browser scenarios) |
| Keyboard: N | M7 browser scenarios |
| Keyboard: P and Esc | M3 pause outline (P, Escape), M3 resume, M2/M7 pause screen |
| Keyboard: A/D | Out of scope for sound (movement is existing game behaviour) |
| Keydown unlocks audio | WS, M1 "silent until the first key press" |
| Window blur / tab hidden | M3 window and tab scenarios (no frame runs before the check) |
| Page load restores settings | M2 and M7 "remembers" |
| Director `handle(event)` (layer 2) | the 23 `@in-memory` scenarios |

## Wave: DISTILL / [REF] Acceptance-criteria traceability

| Story · AC / UAT | Verified by |
|---|---|
| US-01 silent before the first key | M1 "silent until the first key press" |
| US-01 ≤ 17 ms | M1 "same frame" (`@kpi-K5`) |
| US-01 knows the value · pitch rises with it (UAT 3) | M1 "knows which hurdle" (in-memory) · DELIVER unit test (theme: pitch by value) |
| US-01 ≤ 8 voices | M1 burst (adapter) |
| US-01 unavailable · fails to start | M1 two fallback scenarios (`@kpi-K7`) |
| US-02 M everywhere, before the next frame | M2 mid-wave (`all sound stops at once`, no frame run), outline ×3 |
| US-02 HUD and announcements · controls line | M2 mid-wave and unmute · manual (D10, canvas) |
| US-02 persists · blocked storage · unmute while paused | M2 "remembers", "unavailable", in-memory edge |
| US-03 one note per step, four-note cycle · 0.53 s | M3 four-note beat (browser) + property |
| US-03 0.12 s at 10 hurdles | DELIVER unit test of the step-interval rule |
| US-03 pause/leave · resume · respawn and back | M3 pause outline, window, tab, resume, respawn (silent, then plays again) |
| US-03 banner | DELIVER unit test: the formation doesn't step outside `play` (no `formationStepped`, so no beat) |
| US-03 game over | M3 lifecycle property |
| US-03 60 / 120 Hz | Manual (D10) |
| US-04 distinct sounds · 50 ms rule (UAT 3 times) · muted | M4 scenarios + property · M2 mute property (every event type) |
| US-04 clean under stress | Manual (D10) + K6 |
| US-05 five jingles · siren lifecycle · mute and pause | M5 scenarios · M2 mute property |
| US-05 fanfare ≤ 2.4 s | DELIVER unit test (theme) |
| US-06 music on start · pause · resume · game over · unmute | M6 scenarios |
| US-06 6 dB below effects · loop seam | DELIVER unit test (bus levels) · manual (D10) |
| US-07 N, everywhere, persists, blocked storage, announced · controls line | M7 scenarios · manual (D10, canvas) |
| US-07 unmute restores music only if on · effects continue | M7 in-memory scenarios |
| DDD-10 handle is read-only | DELIVER contract test (moved out of the Gherkin: a developer contract, not a player journey) |

## Wave: DISTILL / [REF] Pre-requisites

- DESIGN DDD-1…14 and ADR-001…003: the vocabulary in `src/events.js`; the director contract in the `src/sound.js` header; the synth capabilities, operations and journal schema (`seq`, `sound`, `detail`, `t`, `at`) in the `src/synth.js` header. Journal `detail` keys: `value` (hurdle-hit, pounds), `note` (march, 0–3).
- HUD fields `[data-hud="sound"]`, `[data-hud="music"]` showing `On`/`Off`. Announcements: `Sound off. Press M to turn it on.`, `Sound on.`, `Music off. Press N to turn it on.`
- **Environment mapping** (DEVOPS skipped, no `environments.yaml`): `clean` = first-visit scenarios including the walking skeleton; `with-stale-config` = the saved-settings scenarios in M2 and M7 (not the walking skeleton, because a feature has exactly one walking skeleton); `with-pre-commit` = not applicable (a browser game with no install step or hooks). Matrix: Chromium, Firefox, WebKit via Playwright 1.62.1; Node 22.
- Outcomes OUT-1…OUT-6 in the [registry](../../product/outcomes/registry.yaml); [KPI contracts](../../product/kpi-contracts.yaml) (K5, K7 hard).
- **Mandate 8 waiver** (user, 2026-10-23) and **Mandate 10 substitution**: no state-delta port and no separate state machine. The properties compare the director's whole cue plan, cue by cue, against `referencePlan()` in `steps/director-harness.js`: the DESIGN policy table as code. Approved by the PO together with the review-gate closure.
- **Mandate 12**: types from `src/events.js` and `domain-types.js`; typed parameters (`{pounds}`, `{seconds}`, `{house}`, …); every step body is one delegating call.
- **What "I hear" means**: the synth started that sound (journal entry). That it reached the speakers is a manual check (D10).

## Wave: DISTILL / [REF] Test-the-tests evidence (revision 3)

- **Satisfiable**: a throwaway director that follows the policy table (written only for this check and then removed; `src/sound.js` is back to its scaffold) passed all 23 in-memory scenarios.
- **Discriminating**: four broken variants of it were each caught: ignores mute (1 scenario failed), beat while paused (2), no rate limit (2), siren left on at game over (4).
- **Browser scenarios**: the RED run classifies every failure as MISSING_FUNCTIONALITY ([red-classification.md](distill/red-classification.md)). The two cursor bugs reviewers found in revision 2 (the multi-shot count and the explosion behind the cursor) are fixed: the cursor is now the journal `seq`, and loss timing uses simulation time.

## Wave: DISTILL / [REF] Review gate record

| Cycle | DISCUSS (Eclipse) | DESIGN (Architect) | DEVOPS (Forge) | DISTILL (Sentinel) |
|---|---|---|---|---|
| 1 | needs_revision (4 blockers) | needs_revision (6 blockers) | not run: wave skipped by the user | rejected (2 blockers) |
| 2 | needs_revision (4 blockers) | rejected (2 blockers) | not run | rejected (4 blockers) |

After cycle 2 (the nWave limit), the **PO (user) decided on 2026-10-23** to fix every cycle-2 finding and hand off to DELIVER without a third review, taking final approval. Revision 3 addresses all cycle-2 blockers and high findings; low findings are fixed or explicitly recorded above (for example the Dream Home announcement gap and the A/D scope). Nothing known is left open for DELIVER beyond the items marked "DELIVER unit test" or "manual (D10)" in the traceability table.

---

## Wave: DELIVER / [REF] Implementation summary

Delivered 2026-10-23 → 2026-10-24 on `main`, from `48a5234` (the roadmap) to `8042e7d`: 11 roadmap steps, a K6 measurement script, an L1–L6 refactor and one review revision. The summary and lessons are in the [evolution document](../../evolution/rightmove-invaders-sound-evolution.md).

The sound path follows the DESIGN (DDD-1…14), with one amendment (N1, under Changed assumptions):
- **Rules** (`src/game.js`): every DESIGN emit site publishes into the outbox. M and N flip `g.settings`, which outside code sets only through `applySettings`, and emit `soundToggled` / `musicToggled`. P, Esc and `pause()` emit `paused` / `resumed`, only when the pause state changes.
- **Wiring** (`src/main.js`):
  - calls `synth.unlock()` on every keydown;
  - drains `takeEvents()` once per frame, and at once on blur or when the tab is hidden;
  - passes each cue to `synth.perform`;
  - saves the settings on the toggle events;
  - exposes the frozen, data-only `window.makeTheRightMove.audio`.
- **Director** (`src/sound.js`, 114 lines): implements the whole policy table, complete since 02-02. The music rows are in one labelled `MUSIC` block. Dropping music means deleting the block, the two `startMusic` calls and the `...MUSIC_ROWS` line.
- **Synth** (`src/synth.js`, 307 lines):
  - a cap of 8 voices, with the oldest cut first;
  - one shared noise buffer;
  - the siren loop;
  - a 25 ms timer that schedules music up to 100 ms ahead of the audio clock, on its own bus;
  - the journal `{seq, sound, detail, t, at}` (the last 100 entries);
  - the suspended-state and fail-safe rules of N1.
- **Theme** holds every recipe, the jingles, the march notes, the tune and the bus levels.
- **Storage** has `loadSettings()` and `saveSetting(name, on)`, with a strict `'off'` parse and a default of on, behind one guard.
- **Status** and **render** show and announce both settings.

| Slice | Story | Steps (commit) |
|---|---|---|
| 01 | US-01 | 01-01 walking skeleton (`db0a2b7`) · 01-02 (`dad1a56`; all 7 scenarios passed as soon as they were enabled) |
| 02 | US-02 | 02-01 (`8098c87`) · 02-02 (`97c2861`) |
| 03 | US-03 | 03-01 (`a58d841`) · 03-02 (`1da305b`) · 03-03 (`f2c87a4`) |
| 04 | US-04 | 04-01 (`e2786cd`) |
| 05 | US-05 | 05-01 (`765547c`; then `3bccdea` removed a test-only export) |
| 06 | US-06 | 06-01 (`0a38c05`) |
| 07 | US-07 | 07-01 (`6449d7e`) |
| — | K6 | Measurement script (`76b7b4d`) |
| — | L1–L6 refactor | `1dc514e` `565fbf4` `f94d18e` `1867699` `f9856fa` `681974e` |
| — | Review revision | `11bff9a` `674ff59` `f436db0` `92d87e8` `7189e63` `e6fb575` `4b326b3` `aa9fa09` `8042e7d` |

## Wave: DELIVER / [REF] Files modified

`git diff --stat 48a5234..HEAD`: 36 files, +1,583 / −91.

| File | Change | Commits |
|---|---|---|
| `src/synth.js` | From RED scaffold to the Web Audio adapter | `db0a2b7` `8098c87` `e2786cd` `765547c` `0a38c05` `1dc514e` `11bff9a` `7189e63` |
| `src/sound.js` | From RED scaffold to the sound director | `db0a2b7` `8098c87` `97c2861` `565fbf4` |
| `src/game.js` | Outbox and emit sites, M and N, `applySettings`, pause events | `db0a2b7` `8098c87` `a58d841` `1da305b` `f2c87a4` `e2786cd` `765547c` `6449d7e` `f94d18e` |
| `src/main.js` | Unlock, per-frame drain, flush on blur or hidden tab, settings load and save, diagnostics handle | `db0a2b7` `8098c87` `1da305b` `6449d7e` |
| `src/theme.js` | Recipes, jingles, march notes, tune, bus levels, pitch by value | `db0a2b7` `a58d841` `f2c87a4` `e2786cd` `765547c` `3bccdea` `0a38c05` `f9856fa` |
| `src/storage.js` | `loadSettings` and `saveSetting`, strict parse, one guard | `8098c87` `1867699` |
| `src/status.js` | Sound and music fields and announcements | `8098c87` `6449d7e` |
| `src/render.js` | "SOUND OFF" and "MUSIC OFF" indicators; "M sound" and "N music" in the title controls line | `8098c87` `6449d7e` |
| `index.html` | `data-hud="sound"` and `data-hud="music"` | `8098c87` `6449d7e` |
| `README.md` | M and N in the controls table; the new modules in the file table | `6449d7e` |
| `playwright.config.js` | A `unit` project (`tests/unit`) | `dad1a56` |
| `scripts/measure-performance.mjs` | K6 stress measurement (dev tooling, not shipped) | `76b7b4d` |
| `tests/e2e/rightmove-invaders-sound/acceptance/*.feature` (8 files) | `@pending` tags removed, nothing else | One per step |
| `tests/unit/support/fake-audio.js`, `fresh-game.js`, `seed.js` | A recording fake of the Web Audio graph for the synth properties; game setups that check each write as it is made; `FC_SEED` replay | `11bff9a` `7189e63` `e6fb575` |

The unit specs are fast-check properties: 13 files, 23 tests, each replayable with `FC_SEED`.

| Spec | Proves | Added in |
|---|---|---|
| `hit-pitch.spec.js` | The pitch function rises with the hurdle's value | `dad1a56` |
| `synth-hit-pitch.spec.js` | The synth starts a hurdle hit at that pitch (F3) | `674ff59` |
| `diagnostics-handle.spec.js` | The handle is data only, frozen and can't be written through; journal reads are snapshots (DDD-10) | `dad1a56` |
| `formation-step-interval.spec.js` | Steps are 0.53 s apart at 55 hurdles and 0.12 s at 10 (first wave), and never slower as hurdles fall | `a58d841` |
| `formation-play-only.spec.js` | No formation step on the banner, while the pin respawns or after game over. The test checks that its setups really reach those states (F9) and that the formation does step in play (N2) | `f2c87a4` |
| `fanfare-length.spec.js` | The fanfare fits within the 2.4 s banner and rises | `765547c` |
| `music-level.spec.js` | The theme data puts the music at least 6 dB below every effect | `0a38c05` |
| `synth-mix.spec.js` | The mix the synth builds keeps that 6 dB gap (F4) | `f436db0` |
| `synth-voice-cap.spec.js` | Past 8 effects, the oldest are the ones cut (F7) | `92d87e8` |
| `synth-suspended.spec.js` | Stops act while the context is suspended; nothing starts while it is suspended (F2, N1) | `11bff9a` |
| `synth-fail-safe.spec.js` | An audio-graph failure leaves the synth unavailable and silent, with no console output, including a failure inside the music timer (F8, N1) | `7189e63` |
| `pause-events.spec.js` | Every pause change from P, Escape and focus loss is published exactly once (F1, DELIVER part) | `4b326b3` |
| `settings-parse.spec.js` | A setting is off exactly when `'off'` was saved for it; with storage blocked both are on; saving never fails | `6449d7e` |

**Unchanged in DELIVER**: `src/events.js` (created in DISTILL), `src/input.js`, `src/shields.js`, the DISTILL step definitions, `steps/game-driver.js`, `steps/director-harness.js`, the fixtures, `package.json` and `package-lock.json`.

## Wave: DELIVER / [REF] Scenarios green count

Result of `npx bddgen && npx playwright test`:

| Project | Tests | Green |
|---|---|---|
| unit | 23 (13 specs) | 23 |
| in-memory | 23 | 23 |
| chromium | 34 (33 sound examples + the game's walking skeleton) | 34 |
| firefox | 34 | 34 |
| webkit | 34 | 34 |
| **Total** | **148** | **148** |

All 51 sound scenarios (56 runnable examples) are enabled. No `@pending` tags remain, and a `RUN_PENDING=1` run gives the same result. The DISTILL RED baseline had 3 of 125 passing ([red-classification.md](distill/red-classification.md)); now all 125 pass, plus the 23 unit tests.

## Wave: DELIVER / [REF] DoD check

Checked against "DISCUSS / [REF] Definition of Done".

| # | DoD item | Status | Evidence |
|---|---|---|---|
| 1 | Every AC verified the way its traceability row says; automated rows green in Chromium, Firefox and WebKit | **Met** for every automated row · **Owed by the PO** for the manual rows (item 5) | Browser rows are green in all three engines (148/148). Every "DELIVER unit test" row exists: pitch by value (`hit-pitch`, `synth-hit-pitch`), 0.12 s (`formation-step-interval`), banner (`formation-play-only`), fanfare ≤ 2.4 s (`fanfare-length`), 6 dB (`music-level`, `synth-mix`), DDD-10 (`diagnostics-handle`). One caveat: for the US-03 pause row, the M3 pause outline does not itself check "all sound stops at once" (the scenario part of F1, a DISTILL follow-up). The behaviour is covered by `pause-events`, the window and tab scenarios and the in-memory pause scenarios |
| 2 | All sound scenarios and the game's walking skeleton green; no `@pending` left | **Met** | No `@pending` tags; the `RUN_PENDING=1` run is identical; the game's walking skeleton is green in 3 engines |
| 3 | K5 and K7 pass (hard gates) | **Met** | `@kpi-K5` ("A shot is heard in the same frame it is fired") and the `@kpi-K7` scenarios (silent until the first key; sound unavailable; sound fails to start) are green in 3 engines |
| 4 | K6 measured and recorded (soft gate) | **Met** | `node scripts/measure-performance.mjs`: Chromium p95 0.4 → 0.5 ms (+0.1), Firefox mean 2.707 → 2.746 ms (+0.039), WebKit mean 0.682 → 0.712 ms (+0.030), against a 0.5 ms budget; 0 page errors. Caveats are under Quality gates |
| 5 | Manual checks (D10): real Safari, listening under stress, the music loop seam, 120 Hz, the canvas HUD indicator and controls line | **Owed by the PO** | Nothing was checked by ear or in real Safari during DELIVER. The list and how to do each check are under Pre-requisites |
| 6 | Playtest run per the protocol; K1–K4, K8, K9 recorded with n | **Owed by the PO** | Not run yet. D12 decides whether the music stays |
| 7 | Settings persistence verified, including blocked storage | **Met** | The M2 and M7 "remembers" and "unavailable" scenarios in 3 engines; `settings-parse.spec.js`; the 05-01 check that the scenario can fail: skipping `applySettings(loadSettings())` made "The game remembers that the sound was off" fail in all 3 browsers (HUD On, journal `["doorbell"]`) |
| 8 | README controls table updated (M, N) | **Met** | `README.md` (`6449d7e`) has rows "M · Sound on / off" and "N · Music on / off" |
| 9 | Committed to `main`, with no new runtime dependencies | **Met** for the code | All step, refactor and revision commits are on `main` (not pushed). `package.json` and `package-lock.json` are unchanged since `48a5234`; there are only devDependencies (`@playwright/test`, `fast-check`, `playwright-bdd`). The orchestrator commits this DELIVER record |

## Wave: DELIVER / [REF] Demo evidence

One scenario per story plus the walking skeleton, run with `--reporter=list`: **24 passed in 8.7 s**, each green in Chromium, Firefox and WebKit.

| Story | Scenario | Chromium | Firefox | WebKit |
|---|---|---|---|---|
| WS | Alex hears their shot and the hurdle it hits | ✓ | ✓ | ✓ |
| US-01 | A shot is heard in the same frame it is fired | ✓ | ✓ | ✓ |
| US-02 | M silences the game in the middle of a wave | ✓ | ✓ | ✓ |
| US-03 | The formation marches to a four-note beat at its own pace | ✓ | ✓ | ✓ |
| US-04 | A shot into a house makes a thud | ✓ | ✓ | ✓ |
| US-05 | Starting a game rings the doorbell | ✓ | ✓ | ✓ |
| US-06 | Music plays under the game | ✓ | ✓ | ✓ |
| US-07 | N turns just the music off | ✓ | ✓ | ✓ |

The raw list output was captured in the delivery session and is not committed. To re-run: `npx bddgen && npx playwright test --reporter=list -g "<title>"`. Here, "heard" means the synth started that sound (a journal entry, ADR-003). Whether it reached the speakers is a manual check.

## Wave: DELIVER / [REF] Quality gates

| Gate | Result |
|---|---|
| Per-step TDD (DES RED → GREEN → COMMIT) | 11 of 11 steps. 01-02 GREEN is `SKIPPED` (NOT_APPLICABLE: all 7 scenarios passed as soon as they were enabled) |
| Full suite before each commit and at the integration gate | 148/148 green; the `RUN_PENDING=1` run is identical |
| Checks that tests can fail (planned in the roadmap) | 05-01: the persistence scenario fails without `applySettings(loadSettings())`, in 3 of 3 browsers. 06-01: with the synth's `silence` turned into a no-op, "M silences the game in the middle of a wave", "Switching to another window…" and "Hiding the game's tab…" fail in all 9 runs (music still `playing`) |
| Design compliance | No production file outside the DESIGN component table. The director holds no synth reference. The rules' only new import is `events.js`. `scripts/measure-performance.mjs` is dev tooling (F11, low) |
| Refactor L1–L6 | 6 commits, behaviour unchanged, suite green after each module |
| Adversarial review | Iteration 1 **rejected** (high findings F1–F4). The revision fixed F1 (DELIVER part), F2, F3, F4, F7, F8, F9, F12 and N2. Iteration 2 **approved**. Open items are under Changed assumptions |
| Mutation testing (Phase 5) | **Skipped**: the project's mutation strategy is nightly-delta |
| DES integrity | `des-verify-integrity` exits 0: "All 11 steps have complete DES traces" |
| K5 and K7 (hard) | Pass in 3 engines |
| K6 (soft) | Pass in 3 engines: +0.1, +0.039 and +0.030 ms against 0.5 ms. Caveats below |
| No new runtime dependencies | Pass |
| Not run | CI (none exists: the DEVOPS wave was skipped, so the deliverer runs `npm test`); anything by ear; real Safari |

K6 caveats:
- Each figure comes from one headless 12 s run per mode per engine. Frame work is the duration of the rAF callback.
- Timer resolution is coarse (0.1 ms in Chromium, about 1 ms in Firefox and WebKit), so the deltas are close to the resolution.
- The "without sound" run removes Web Audio. The synth then takes its silent fallback while the rules and the director still run, so **the director's cost is not in the delta**.
- The load is a play-stress run (hold Space, sweep, restart), not the spike's 40-bolt, 3,000-particle scene, which the real game does not have.

## Wave: DELIVER / [REF] Pre-requisites

For whoever playtests or ships next:
- **Run it**: Node 22; `npm install`; `npx playwright install` for the test browsers; `npm start`, then open http://localhost:4173. `npm test` must show 148 passed. For K6, run `node scripts/measure-performance.mjs`. It starts its own server on port 4181; `PORT` and `WINDOW_MS` override the port and the run length.
- **Debug in the browser**: `window.makeTheRightMove.audio` shows:
  - `state`: `locked` until the first key; `unavailable` means the silent fallback;
  - `journal`, `music`, `voices` and `peakVoices`.

  Settings live in the localStorage keys `make-the-right-move:sound` and `make-the-right-move:music`; only `'off'` turns one off.
- **PO manual checks owed (D10)**, to be recorded in this file:
  - Real Safari: play one full wave with sound, mute and unmute, pause and resume.
  - A 30 s listen under stress, on laptop speakers and on headphones: no clicks, crackle or distortion. The thud, tink and explosion levels were set by measurement, not by ear. The real game has no stress mode: use a Country pile wave (slice 04's load case), or hold Space while sweeping, as the K6 script does.
  - Music: listen for a gap at the loop point over about 5 minutes; judge the tune and whether the beat can still be heard over it.
  - Tempo: the same beat on a 60 Hz and on a 120 Hz display.
  - Canvas HUD: "SOUND OFF" and "MUSIC OFF" at the bottom right, shown only when off (the DOM HUD shows On/Off). "M sound" and "N music" in the title controls line.
- **Playtest owed**: K1–K4, K8 and K9 per the DISCUSS protocol (5 people, three waves), with n recorded. If K4 is below 40%, or still below 60% after one re-tune and repeat (D12), drop slices 06–07 as one unit. What to remove: the list in DESIGN "Music as one removable unit", plus the `music` flag in `storage.js`'s `loadSettings()`, the N row in `README.md`, the `milestone-6` and `milestone-7` features, and the `music-level` and `synth-mix` specs.
- **Before the next audio feature**: the DISTILL follow-ups and open low findings under Changed assumptions.
- **Known gap** (from DISCUSS): screen readers aren't told when the Dream Home arrives.
- Not part of the record: the uncommitted DES working files `deliver/.develop-progress.json` and `deliver/orchestrator-brief.md`.

## Wave: DELIVER / [REF] Changed assumptions

- **N1: the synth operation table is amended** (review findings F2 and F8; commits `11bff9a` and `7189e63`; header contract in `src/synth.js`). The DESIGN row "any `perform` while `locked`, `suspended` or `unavailable`: No change" now reads:
  - `stopLoop`, `stopMusic` and `silence` act when the state is `running` **or** `suspended`. A suspended context still holds what it was playing, and the director has already forgotten those sounds, so a dropped stop would be heard again on resume.
  - `play`, `startLoop` and `startMusic` act only when the state is `running`.
  - Nothing acts when the state is `locked` or `unavailable`.
  - On any exception from the audio graph inside `perform()` or the music timer, the synth stops what it can, goes `unavailable` for good and prints nothing. The game loop is unaffected. This adds a state transition: `running` or `suspended` → `unavailable`.
  - The journal rule is unchanged: nothing writes an entry while the context is suspended, because stops never write one and starts don't act. ADR-003 still holds. ADR-002's sentence "While `locked`, `suspended` or `unavailable`, `perform()` changes nothing" is superseded by an amendment section appended to ADR-002 in DELIVER (the original text is kept).
- **K6 was measured once, at the integration gate**, not once per slice from slice 04 on. `scripts/measure-performance.mjs` adapts the spike's script to the real game. Its "without sound" baseline keeps the director running (only Web Audio is removed), and its load is a play-stress run rather than the spike's 40-bolt, 3,000-particle scene (see Quality gates).
- **Settings storage was generic from 02-01**: `loadSettings()` returns both flags and `saveSetting(name, on)` serves both keys. So `g.settings.music` and the `:music` key existed before slice 06, and 07-01 only wired N, the HUD field and the README.
- **More unit specs than the roadmap planned**: the review added `synth-hit-pitch`, `synth-mix`, `synth-voice-cap`, `synth-suspended`, `synth-fail-safe` and `pause-events`. `hit-pitch` and `music-level` are now named for the pure data they check.
- **DISTILL follow-ups** (owner: nw-acceptance-designer). The orchestrator deferred these; review iteration 2 approved without them.
  - F1, scenario part: add "all sound stops at once" to the milestone-3 pause outline, and music checks to the silent-since-press steps.
  - F5: `expectAllSoundStopped` uses `expect.poll`, so it also passes when the voices reach 0 because they ended on their own. It should read once instead.
  - F6: `referencePlan` in `steps/director-harness.js` re-codes the policy table, so it can't catch a misreading of the table. Add literal cue sequences or independent invariants.
  - F10: `game.js` exports `PLAYER_SPEED`, `RESPAWN_TIME` and `houseCentreX` only for the test driver.
- **Open, low**:
  - N3: a voice's nodes leak if the audio graph fails part-way through starting it.
  - N4: `unlock()` is not under the fail-safe.
  - N5: the unit tests' fake audio never fires `onended`.
  - F11: 01-02's RED phase has no recorded failing run, because its scenarios passed as soon as they were enabled. DISTILL's RED run had shown them failing for MISSING_FUNCTIONALITY.
