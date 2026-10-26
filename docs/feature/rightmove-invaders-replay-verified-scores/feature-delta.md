<!-- markdownlint-disable MD024 -->
# Feature delta: rightmove-invaders-replay-verified-scores

The shared high-score table stops trusting the deposit a browser claims. Each game asks the Score API for a **session** as it starts (S2 in the [forged-scores RCA](../../analysis/root-cause-analysis-forged-high-scores.md)), records the keys the player held at each simulation step, and sends that **record** with its signing. The function **replays** the game and saves the deposit the replay produces (S3). A deposit typed into a `curl` or changed in the browser console never reaches the table.

- **Type**: cross-cutting (the rules, the browser's table client and the Score API), a change to live functionality, brownfield. `rightmove-invaders-leaderboard` is in production since `144e23a`, with the plausible ceiling of PR #4 (`4d17123`). Branch `rightmove-invaders-replay-verified-scores`, cut from `main` at `4d17123`.
- **Density**: lean (Tier-1 only). **Research depth**: lightweight; the technical unknowns were probed instead ([probe findings](probe/findings.md)). **JTBD**: yes.
- **No DISCOVER or DIVERGE.** The trigger is an incident: forged deposits on 2026-10-26, analysed by the RCA (5 Whys), which recommends this feature. ADR-007's revisit trigger has fired.
- **SSOT**: [jobs.yaml](../../product/jobs.yaml) (J-TABLE-TRUST, new) · [persona](../../product/personas/casual-arcade-player.yaml) · [journey](../../product/journeys/play-a-session.yaml) (the start step, two error paths, two shared artifacts) · [leaderboard feature delta](../rightmove-invaders-leaderboard/feature-delta.md) · ADR-004, ADR-006, ADR-007, ADR-008
- **Slices**: [slice 01, a session for every game](slices/slice-01-a-session-for-every-game.md) (walking skeleton) · [slice 02, the table replays the game](slices/slice-02-the-table-replays-the-game.md) · [slice 03, no faster than the clock](slices/slice-03-no-faster-than-the-clock.md)

---

## Wave: DISCUSS / [REF] Persona ID

`casual-arcade-player`: Alex Morgan (they/them). Plays for fun in 5–10 minute sessions on a MacBook Air, and checks the shared table after each game. The examples also use other players of the same segment: Priya Shah (long runs) and Sam Taylor (quick games).

Two roles appear in the examples, neither a persona of its own:
- **The owner** runs the site, reads the function's log and deletes rows by hand (the leaderboard's DEVOPS moderation guide).
- **A forger, signing as HAX** (the RCA's reproduction): a player who knows the browser console and `curl`. An anti-persona: every story turns them away, and D16 states what still gets through.

## Wave: DISCUSS / [REF] JTBD one-liner

When I look at the shared high-score table, I want every deposit on it to come from a game somebody really played, so that climbing it means something.

| Job | Opportunity | Stories |
|---|---|---|
| J-TABLE-TRUST (new: every row was really played) | 14 | US-01, US-03, US-05 |
| J-TABLE-SIGN (existing: sign quickly with my initials; here, no regression) | 11 | US-02, US-04, US-06 |

**Evidence level: one incident.** On 2026-10-26 a player put deposits of about £9,999,950 on the production table, with a `curl` and from the browser console (the RCA's Vectors A and B), and the owner deleted them (S0). There are no player interviews. The job's dimensions and forces are in `jobs.yaml`.

## Wave: DISCUSS / [REF] Locked decisions

| ID | Decision | Verdict |
|---|---|---|
| D1 | **The table saves the deposit the server replays.** The signing carries the game's record, and the Score API replays it. The deposit the browser claims is checked against the replay: if they differ, the signing is refused (`replay-mismatch`), logged, and nothing is saved. | Locked (user, 2026-10-26) |
| D2 | **The game picks its own seed, and asks for a session as it starts.** The game starts at once, with a seed of its own. In the background it asks the Score API for a session that binds that seed and the time the session was issued. This request takes over from today's table refresh at every game start (ADR-008), and its answer carries the refreshed table, so a game still costs one request. Choosing the seed gives a forger nothing that a program playing the game doesn't already have (D16). | Locked (user, 2026-10-26) |
| D3 | **A session is a token signed with a secret** (an HMAC), kept in the Netlify environment. The function writes nothing per game, and the restricted table port (ADR-004) stays as it is. Without the secret, the function issues no session and saves no signing, and its log says why. | Locked (user, 2026-10-26) |
| D4 | **The rows already on the production table stay.** The owner checked them after the cleanup (S0), and the key format doesn't change. The owner can still delete any row by hand. | Locked (user, 2026-10-26) |
| D5 | **No new wording or outcome in the game.** Every refused signing ends as today's "Couldn't confirm ALX's signing.", for a forger and for an honest player alike. The game still tells only OK from not OK (ADR-008), and the reason is in the function's log. An honest player should see it only in the rare cases of D11, D12 and US-06. | PO default; awaiting the user's approval |
| D6 | **No signing without a session.** A signing with no session, or with a session whose signature doesn't check, is refused and saves nothing. | PO default; awaiting the user's approval |
| D7 | **One game, one row.** A session signs the table once. A second signing with the same session is refused, and the table never shows two rows from one session, however many arrive at once. | PO default; awaiting the user's approval |
| D8 | **No game faster than the clock.** The game time in a record can't exceed the time since its session was issued, plus a few seconds for the session's own trip (at least its 5 s timeout; DESIGN sets the allowance). A longer record is refused (`too-fast`). A forger can compute a 20-minute game offline in seconds, but has to wait 20 minutes to sign it. | PO default; awaiting the user's approval |
| D9 | **Games of up to 60 minutes of game time are verified.** An honest record of that length always fits the request. A longer record is refused before it is replayed (`game-too-long`), so no request can keep the function replaying for long. 60 minutes is far past any game seen so far (the probe's bot: 17 minutes, £62,800) and past the plausible ceiling: £250,000 is about 28 perfect waves. | PO default; awaiting the user's approval |
| D10 | **A game is verified with the rules it was played with.** A record names its rules version. A record from other rules is refused without replay (`rules-changed`), for example when a deploy changed how the game plays while the page was open; a reload fixes it. A change to how the game plays is always deliberate: a check on recorded games fails the build until the version is raised. | PO default; awaiting the user's approval |
| D11 | **A game whose session never arrived** (a failure, or no answer within the 5 s timeout) plays as usual, and still asks for initials when its deposit makes the table. Its signing ends "Couldn't confirm". | PO default; awaiting the user's approval |
| D12 | **A page loaded before the release** signs in the old shape, is refused, and shows "Couldn't confirm"; a reload fixes it. Accepted for release day. | PO default; awaiting the user's approval |
| D13 | **The game plays exactly as before.** The gameplay draws come from the game's seed instead of `Math.random`, and the house erosion compares squared distances instead of calling `Math.hypot`. The probe played the same games either way. The particles stay random, because they never touch the gameplay. Pause, M, N, the initials, the table lines and the sound are unchanged. | PO default; awaiting the user's approval |
| D14 | **The table's existing checks stay**: JSON only, the word filter, the £50 step, and the plausible ceiling of £250,000 (PR #4), which now applies to the replayed deposit. The game still asks for initials only when its deposit makes the table (`makesTheTable`). | PO default; awaiting the user's approval |
| D15 | **Every refusal is logged with a fixed reason** (the RCA's RC4), in the one log line per request the function already writes. The line never carries the record, the seed, the session or its token, initials or an IP (DDD-17). | PO default; awaiting the user's approval |
| D16 | **Accepted residual risk, stated in the new ADR: a program that plays well.** The seed is known when the game starts, so a program can play in real time, or search offline for the inputs that do best with that seed, and sign the result. It is still held to the rules of the game, to real time per game (D8), to one row per session (D7), to the rate limit and to the £250,000 ceiling. The owner still deletes rows by hand. Ruling it out would take anti-bot measures far beyond this project. | PO default; awaiting the user's approval |

## Wave: DISCUSS / [REF] Scope assessment

**PASS (right-sized), with one recorded exception: slice 02 is over the 1-day carpaccio target.** The feature has 6 stories in 3 slices. It touches three modules that already talk to each other: the rules (`src/game/`), the browser's table client (`src/platform/leaderboard.js`, wired in `main.js`) and the Score API (`netlify/functions/scores.mjs`). The walking skeleton adds one integration point, the session request, and one piece of configuration, the secret.

**Estimate: about 3.5–4 days of DELIVER.**
- **Slice 01**: about 1 day. The session request and its token, the signing that must carry it, one row per session, and the local server's secret.
- **Slice 02**: about 2 days. It needs three precursor commits, which ship no value on their own and so land before the slice, not as a slice: the seeded gameplay draws and the squared distances (about 2 h); a game the function can create afresh for each check, with the test harnesses moved to it (about 1 day, mostly mechanical); and the record (about 2 h). Then the replay, the mismatch check, the body cap and the 60-minute limit (about ½ day).
- **Slice 03**: about ½ day. The clock check, the rules version and the recorded-games check.

**Why slice 02 stays one slice**: replay is worthless without the precursors, and the precursors are worthless without replay. The precursors are @infrastructure work, so they land as precursor commits inside the slice (the carpaccio hard gate's option b), and the slice ships them with the value they enable.

## Wave: DISCUSS / [REF] Player-facing wording

**None new** (D5). Every refused signing uses today's unconfirmed message, `Couldn't confirm ALX's signing.`, on the canvas and in the status mirror. A forger using `curl` sees the function's JSON error, `{ "error": "<reason>" }`. The reasons are DESIGN's.

## Wave: DISCUSS / [REF] Story map and slice order

Backbone, the journey's steps in [play-a-session](../../product/journeys/play-a-session.yaml): **start → play → game over and sign → the table answers**.

| Start | Play | Game over and sign | The table answers |
|---|---|---|---|
| The game asks for its session without waiting (US-02) | The keys held at each step are recorded (US-03) | The signing carries its session (US-02) and its record (US-03) | No session, or an altered one: refused (US-01) |
| The session's answer refreshes the table (US-02) | *Unchanged*: the game plays as before (D13) | A signing waits for a late session, never the frame (US-02) | The same session twice: refused (US-01) |
| A game without a session still plays (US-02) | | | The claimed deposit isn't the replayed one: refused (US-03) |
| | | | A long game fits and is verified in time (US-04); over 60 minutes, refused |
| | | | Faster than the clock: refused (US-05) |
| | | | Other rules: refused cleanly (US-06) |

**Walking skeleton**: slice 01. It extends the leaderboard's skeleton ("A house-hunter signs the high-score table and another house-hunter sees it") instead of adding a parallel one: the skeleton's game now asks for a session as it starts, its signing carries it, and a signing with no session doesn't reach the table (WS strategy, below).

| Order | Slice | Stories | Why this position |
|---|---|---|---|
| 1 | [01 A session for every game](slices/slice-01-a-session-for-every-game.md) (walking skeleton) | US-01, US-02 | The thinnest end-to-end path, and the RCA's recommended skeleton. The probe already retired the riskiest technical assumption (determinism), so the highest remaining risk is on Netlify: the secret in each deploy context, and one session per game within the rate limit. Turns away the laziest forgery, a `curl` with no game |
| 2 | [02 The table replays the game](slices/slice-02-the-table-replays-the-game.md) | US-03, US-04 | The core value: a forged deposit, by `curl` or console, is refused. The largest slice, because of its three precursors |
| 3 | [03 No faster than the clock](slices/slice-03-no-faster-than-the-clock.md) | US-05, US-06 | Closes the forger's last cheap shortcut (a game computed offline in seconds), and keeps the next gameplay change from refusing honest players without saying why. Both checks need slice 02's record |

**Priority rationale**: the walking skeleton comes first, as the RCA recommends, and it carries the highest remaining risk. Slice 02 then delivers most of the value: value × urgency / effort is 5 × 5 / 4 ≈ 6.3, against slice 01's 2 × 5 / 2 = 5 and slice 03's 3 × 3 / 1 = 9. Slice 03 scores highest but depends on slice 02's record.

**Carpaccio taste tests**:
- **Thin**: slice 01 and slice 03 each extend existing components. Slice 02 adds one new concept, the record, and changes the rules into something the function can create afresh. That is the recorded exception (Scope assessment).
- **A new abstraction first**: the record and a game the function can create afresh are needed by slices 02 and 03. They land as precursor commits inside slice 02, not as a slice of their own (hard gate, option b).
- **Each slice can disprove something**: see each brief's learning hypothesis.
- **Production data**: every slice runs on the real page, in real browsers, against the deploy preview's real function and Blobs, with the preview's own secret.
- **No two slices are the same thing at different scales.** **PASS**, with the slice 02 exception.

## Wave: DISCUSS / [REF] User stories

### US-01: The owner's table turns away a signing that no game asked for

`job_id: J-TABLE-TRUST` · slice 01 · about ½ day

On 2026-10-26 a forger signed £9,999,950 as HAX with one `curl` and no game. Since PR #4 the table refuses anything above £250,000, but the same `curl` with £249,950 still lands at #1 for everyone, until the owner deletes it by hand.

#### Elevator Pitch

Before: `curl -X POST https://maketherightmove.fabiodamico.xyz/api/scores -H 'content-type: application/json' -d '{"initials":"HAX","score":249950}'` → 200, and HAX is #1 on everyone's table.
After: the same `curl` → `400 {"error":"session-required"}`; `GET /api/scores` shows the table unchanged; the function's log line for it reads `scores.rejected` with the reason `session-required`.
Decision enabled: the owner stops deleting rows that came from no game, and reads in the log how many signings were turned away, and why.

**Domain examples**

1. *No session*: the table holds KIM £2,000. HAX posts `{ "initials": "HAX", "score": 249950 }` with no session. It is refused, and the table still holds only KIM.
2. *An altered session*: HAX asks for a session, then moves its issue time an hour earlier, to look like a long game. The signature no longer checks, so it is refused, and nothing is saved.
3. *The same session twice*: Alex signs ALX £1,250 with their game's session. HAX copies that request and sends it again with the initials XAH. It is refused, and the table shows ALX £1,250 once.

**UAT scenarios**

1. *A signing without a session is refused.* Given the high-score table holds KIM £2,000, When a signature of HAX £249,950 arrives with no session, Then it is refused as `session-required`, and the table still holds only KIM £2,000.
2. *A session the table didn't issue is refused* (outline: the issue time changed; the seed changed; the token changed; a session made up from nothing). Given the table holds KIM £2,000, When a signature arrives with `<a session altered this way>`, Then it is refused as `invalid-session`, and the table still holds only KIM £2,000.
3. *A session signs once.* Given Alex's game has signed ALX £1,250 with its session, When another signing arrives with the same session and the initials XAH, Then it is refused as `session-used`, and the table shows ALX £1,250 once.
4. *One session, many signings at once, one row at most.* Given an empty table, When 5 signings with the same session arrive at the same moment, Then the table shows at most one row for that session.
5. *No secret, no session.* Given the function has no secret configured, When a game asks for a session, Then no session is issued, every signing is refused, nothing is saved, and the log names the missing secret as the reason.
6. *A refusal is logged by reason only.* Given any refusal above, Then the function writes one log line with its fixed reason, and the line holds no session, token, seed, initials or IP.

**Acceptance criteria**

- [ ] A signing with no session, or with a session whose signature doesn't check after any field was changed, is refused and saves nothing. (UAT 1, 2)
- [ ] A session signs the table at most once: a second signing with it is refused, and however many arrive at once, the table never shows two rows from one session. (UAT 3, 4)
- [ ] With no secret configured, the function issues no session and saves no signing, and its log names the cause. (UAT 5)
- [ ] Every refusal writes one log line with its fixed reason, and never the session, its token, the seed, the record, initials or an IP. (UAT 6)
- [ ] A refused signing writes nothing to Blobs. (UAT 1–3)

**Outcome KPI**: K20 (forgeries are refused).
**Technical notes**: today the body must be exactly `{ initials, score }` (`isValidSignature`, ADR-006), read with a 1 KB cap (DDD-5); it grows here. The session's shape, the reason codes and the status codes are DESIGN's; the codes above are proposals. One row per session can't use a second key family in the store, because D3 keeps the table port as it is: DESIGN decides how. The secret must reach the function in every deploy context that has a table: production, deploy previews and branch deploys. Locally, `scripts/serve.mjs` makes its own, so tests and `npm start` need no setup. In slice 01 the deposit itself is still unchecked beyond its shape and the ceiling: a forger who first asks for a session can still claim £249,950. Slice 02 closes that.
**Dependencies**: none beyond PR #4 (merged).

### US-02: Alex's game gets its session as it starts, without waiting

`job_id: J-TABLE-SIGN` · slice 01 · about ½ day

Alex starts a game a few seconds after the page loads, sometimes on the function's cold start. Today the start never waits on the network, and the table is refreshed in the background (ADR-008). Sessions must not change that, and must not cost Alex an extra request that runs into the rate limit of 10 a minute.

#### Elevator Pitch

Before: press Enter on the title → the formation appears at once, and the game refreshes the table in the background (`GET /api/scores`).
After: press Enter on the title → the formation appears at once, as today, while one request in the background, `POST /api/sessions`, brings this game's session and the refreshed table; at game over with £1,250, type `alx` and press Enter → "Signing ALX…", then "Signed ALX, #3.".
Decision enabled: Alex plays and signs exactly as before, on a table that only games reach, and starts the next game straight away.

**Domain examples**

1. *Happy path*: the table holds KIM £2,000, LEO £1,500 and TED £1,000. Alex's game asks for its session as it starts, and the answer arrives within a second. Alex loses with £1,250, types `alx`, presses Enter and reads "Signed ALX, #3.".
2. *A cold start*: the first request after a deploy takes about 1 s. Alex has already pressed Enter, and the formation is marching. The session arrives a second later, and nothing on screen changes.
3. *A quick game*: Sam loses after 4 seconds with £50, which makes the deploy preview's empty table, and types `sam` and Enter before the session's answer is back. "Signing SAM…" shows at once. The signing goes out as soon as the session arrives, and Sam reads "Signed SAM, #1.".
4. *No session*: Alex is on a train, and the session request fails. The game plays on. At game over with £1,250, Alex is asked for initials (the table loaded at page load), signs, and reads "Couldn't confirm ALX's signing.".

**UAT scenarios**

1. *Typed initials sign the table through the game's session.* Given the high-score table holds KIM £2,000, LEO £1,500 and TED £1,000, When Alex finishes a game with £1,250, types "alx" and presses Enter, Then the game tells them "Signing ALX…" and then "Signed ALX, #3.", and the ALX row is marked as theirs.
2. *The game starts at once, whatever the session request does* (outline: it answers at once; it answers after 3 s; it fails; it never answers). Given the title screen, When Alex presses Enter while the session request `<does this>`, Then the formation appears and starts marching straight away.
3. *One request per game start.* Given the page has loaded, When Alex starts a game, Then the game makes exactly one request to the Score API for it, and the table rows in its answer replace the ones shown, under the listing-time rule (ADR-008).
4. *A signing waits for a late session.* Given Sam's game is over with £50 on an empty table, and its session request hasn't answered yet, When Sam types "sam" and presses Enter, Then the game tells them "Signing SAM…" at once, and "Signed SAM, #1." once the session has arrived and the signing has been answered.
5. *A game without a session.* Given Alex's session request failed, When Alex finishes with £1,250 and signs ALX, Then the game tells them "Couldn't confirm ALX's signing.", and the table has no ALX row.

**Acceptance criteria**

- [ ] Starting a game never waits on the session: the formation appears and marches at once, whatever the request does. (UAT 2)
- [ ] Each game start makes exactly one request to the Score API. Its answer refreshes the table as today's refresh did, under the listing-time rule. (UAT 3)
- [ ] A signing carries the session of the game it signs. When that session hasn't arrived yet, the signing waits for it (pending shows at once), and no frame waits. (UAT 1, 4)
- [ ] A game whose session failed or timed out plays as usual, and its signing ends unconfirmed. (UAT 5)
- [ ] Otherwise the signing lifecycle, the wording and the table's behaviour are unchanged. (UAT 1)

**Outcome KPI**: K21 (honest games replay to their own deposit), with K10 and K15 as guardrails.
**Technical notes**: today `main.js` reads the table on `gameStarted` (`loadTable`) and signs on `initialsEntered` (`signTable`). The seed must be known before the first gameplay draw, which happens as the first wave is set up, so it comes from the game and not from the answer (D2). The session request has the same 5000 ms timeout as every table request (DDD-13). The function's rate limit is 10 requests per 60 s per IP, across all its requests (ADR-007): a session replaces the game-start refresh, so the count per game doesn't grow. Unlike that refresh, though, it is never answered from the CDN cache.
**Dependencies**: US-01 (the session's issuer and its check).

### US-03: A deposit changed in the browser never reaches the table

`job_id: J-TABLE-TRUST` · slice 02 · about 1 day, plus the precursors (about 1 day)

The RCA's second forgery: during a game, `(await import('/src/game/game.js')).g.score = 4242400` changed the HUD, and the game's own client then signed that deposit. After slice 01, a forger can also ask for a session with `curl` and claim any deposit under £250,000.

#### Elevator Pitch

Before: in the browser console during a game, `(await import('/src/game/game.js')).g.score = 249950` → the HUD shows £249,950, and at game over "Signed HAX, #1.".
After: the same line, or any other change made to the game in the browser → at game over "Couldn't confirm HAX's signing.", the function's log reads `replay-mismatch`, and the table is unchanged.
Decision enabled: the owner trusts that every deposit on the table is the one its game produced, and Alex knows that the rows above them were played.

**Domain examples**

1. *The console*: HAX sets the deposit to £249,950 mid-game, loses with "Offer rejected" and signs. The replay ends at £350, so the signing is refused and nothing is saved.
2. *A record made up by hand*: HAX asks for a session, then posts a record of 30 seconds of standing still, claiming £249,950. The replay ends with £0, so it is refused.
3. *Honest*: Alex's game ends at £1,250. The function replays the record to £1,250, ending at the same step, and Alex reads "Signed ALX, #3.".
4. *Extra homes*: HAX gives the pin 99 homes from the console and plays on for 20 minutes, to £180,000. The replay loses its third home after 3 minutes with £9,350, while the record goes on, so it is refused.

**UAT scenarios**

1. *An honest game's deposit is the deposit the table saves.* Given the table holds KIM £2,000, LEO £1,500 and TED £1,000, When Alex finishes a game with £1,250 and signs ALX, Then the table saves ALX £1,250 at #3, and the game tells them "Signed ALX, #3.".
2. *A deposit the game didn't produce is refused* (outline: changed in the console; claimed by `curl` with a made-up record; a deposit claimed above what the record plays to). Given the table holds KIM £2,000, When a signing claims HAX `<deposit>` with a record that plays to `<replayed deposit>`, Then it is refused as `replay-mismatch`, and the table still holds only KIM £2,000.
3. *A record must end where its game ended* (outline: it stops before game over; it goes on after the replay's game over). Given the table holds KIM £2,000, When a signing's record `<ends this way>`, Then it is refused, and the table still holds only KIM £2,000.
4. *A record that isn't a record is refused before any replay* (outline: not text; unknown key letters; steps out of order; no rules version). Given any table, When a signing carries `<such a record>`, Then it is refused, and nothing is saved.
5. *The replayed deposit meets the old rules.* Given a session, When a record that plays to more than £250,000 is signed, Then it is refused as `implausible-score`.
6. *The same game in every browser.* Given games played in Chromium, Firefox and WebKit, When the function replays their records, Then each ends at the deposit and the step the browser saw.

**Acceptance criteria**

- [ ] The table saves the deposit the replay produces, and only when it equals the deposit claimed. Otherwise the signing is refused as `replay-mismatch`, and nothing is saved. (UAT 1, 2)
- [ ] A record whose replay doesn't reach game over exactly at its last step is refused. (UAT 3)
- [ ] A malformed record is refused before it is replayed. (UAT 4)
- [ ] The replayed deposit must meet the existing rules: a positive multiple of £50, at most £250,000. (UAT 5)
- [ ] A game played in Chromium, Firefox or WebKit replays on the function to the deposit and the game-over step the browser saw (K21). (UAT 6)
- [ ] The game plays exactly as before (D13). (UAT 1, 6)

**Outcome KPI**: K20 (forgeries are refused), K21 (honest games replay to their own deposit).
**Technical notes**:
- **What the record must hold.** At each fixed step, the rules read three controls through `keys.isDown`, in `movePlayer` (`game.js`): left (ArrowLeft or A), right (ArrowRight or D) and fire (Space). Nothing else reaches the gameplay. A paused game runs no steps, and M, N, P and the initials never touch it. So the record is the three held controls by step index, from the game's start to its game over: no presses, pauses or initials. The probe measured 0.8–1.6 KB a minute at human pace ([findings](probe/findings.md)).
- **What has to change.** Every gameplay draw is `Math.random` today: enemy fire and the Dream Home in `game.js`, erosion in `shields.js`. `Math.hypot` is used at `shields.js:43`. The rules live in a module-level `g`, which the views read and the tests reach through `snapshot()` and `tests/unit/support/fresh-game.js`. ADR-006 rule 5 lets `netlify/**` import only `high-scores.js` from `src/`.
- **Whether the console line still runs** (Example 1) is DESIGN's. The story asks only that what it changes never reaches the table.

**Dependencies**: US-01 and US-02 (the session that binds the seed).

### US-04: Priya's long game still signs, in the usual time

`job_id: J-TABLE-SIGN` · slice 02 · about ½ day

Priya Shah is the best player in the office, and a good run lasts 25 minutes. Its record is about 20–40 KB (the probe's 0.8–1.6 KB a minute at human pace), and the table reads at most 1 KB of a signing today.

#### Elevator Pitch

Before: a signing is two fields, well under the table's 1 KB cap.
After: after a 25-minute game worth £180,000, type `pri` and press Enter → "Signing PRI…", then "Signed PRI, #1." within the usual wait, well inside the game's 5 s timeout.
Decision enabled: Priya keeps a long run going, knowing it can still be signed.

**Domain examples**

1. *A long run*: Priya plays 25 minutes for £180,000, with a record of about 40 KB, and reads "Signed PRI, #1.".
2. *The longest verified game*: a 60-minute game signs, and the function's replay takes well under a second on Netlify.
3. *Too long*: a 61-minute record is refused without being replayed (`game-too-long`), and so is a program's record claiming 100 hours.
4. *Too big*: a body over the new cap is refused as `payload-too-large`, and the function stops reading it at the cap.

**UAT scenarios**

1. *A long game signs.* Given an empty table and Priya's 25-minute game worth £180,000, When Priya signs PRI, Then the game tells them "Signed PRI, #1.".
2. *The longest game verified.* Given a record of exactly 60 minutes of game time, at human pace, When it is signed, Then it is saved, with the deposit its replay produced.
3. *A longer game is refused before any replay.* Given a record of 60 minutes and one step, When it is signed, Then it is refused as `game-too-long`, nothing is saved, and the log shows it was never replayed.
4. *A body over the cap is refused.* Given a body one byte over the new cap, When it is posted, Then it is refused as `payload-too-large`, and no more than the cap is read.

**Acceptance criteria**

- [ ] An honest record of up to 60 minutes of game time, at any human pace, fits the request and is verified. (UAT 1, 2)
- [ ] A record of more than 60 minutes is refused without being replayed. (UAT 3)
- [ ] A body over the new cap is refused, and is never read past the cap. (UAT 4)
- [ ] On a deploy preview, a 60-minute record is verified within the game's 5 s signing timeout, and its replay takes under 1 s (K22). (UAT 2)

**Outcome KPI**: K22 (a long game is verified in time on Netlify).
**Technical notes**: the probe replayed 72,000 steps (10 minutes) in about 50 ms in Node 22, so about 0.3 s for 432,000 steps (60 minutes) on an M4 Pro; Netlify's CPU is unmeasured. Legacy Free bills invocations, not CPU time. A program that changes keys at every step writes about 4 KB a minute: the cap doesn't have to cover it for an hour. The encoding and the cap are DESIGN's.
**Dependencies**: US-03.

### US-05: A game computed offline can't beat the clock

`job_id: J-TABLE-TRUST` · slice 03 · about ½ day

After slice 02, HAX can't claim a deposit: the record has to produce it. But HAX's game uses a seed HAX knows, and the rules are public, so a program can search for a high-scoring record offline, in seconds. The session knows when the game began.

#### Elevator Pitch

Before (after slice 02): HAX asks for a session, computes a 20-minute record worth £120,000 in a few seconds, and signs it a minute later → "Signed HAX, #1.".
After: the same signing → `400 {"error":"too-fast"}`, and the table is unchanged; HAX would have to wait the full 20 minutes for each game.
Decision enabled: the owner knows that a forged row costs its forger the game's time, one game per session, and can judge whether what is left (D16) needs more.

**Domain examples**

1. *Computed offline*: HAX's 20-minute record is signed one minute after its session was issued, and is refused.
2. *Honest and quick*: Alex's 4-minute game is signed 10 s after game over, and is saved.
3. *A long pause*: Alex pauses for 10 minutes mid-game. The time since the session grows, the game time doesn't, and the signing is saved.
4. *A slow session*: the session's answer took 4 s, so the session was issued 4 s after the game started. The game time is up to 4 s longer than the time since the session, inside the allowance, and the signing is saved.

**UAT scenarios**

1. *A record longer than the time since its session is refused.* Given a session issued 60 s ago, When a record of 20 minutes of game time is signed with it, Then it is refused as `too-fast`, and nothing is saved.
2. *An honest game is never too fast* (outline: signed at once after a short game; the session issued 4 s after the start; a 10-minute pause). Given Alex's game `<played this way>`, When Alex signs ALX, Then the signing is saved.
3. *The browser's clock plays no part.* Given a signing that claims a start an hour ago, When it is checked, Then only the session's issue time and the function's clock count.

**Acceptance criteria**

- [ ] A record whose game time exceeds the time since its session was issued, beyond the allowance, is refused as `too-fast`, and nothing is saved. (UAT 1)
- [ ] An honest game is never refused as too fast, whatever its pauses, and whatever the session's delay up to its 5 s timeout. (UAT 2)
- [ ] The check uses only the session's issue time and the function's clock. (UAT 3)

**Outcome KPI**: K20, K23 (honest players are never refused).
**Technical notes**: the browser acceptance tests play on Playwright's fake clock, so their games run much faster than real time; the local server must let them through without weakening production (DESIGN and DISTILL). Function instances can disagree by a few ms (ADR-008's accepted edge), well inside the allowance.
**Dependencies**: US-03 (the record's game time is trusted only once it is replayed).

### US-06: A game played on yesterday's rules is turned away cleanly

`job_id: J-TABLE-SIGN` · slice 03 · about ½ day

The game keeps changing: level backdrops are in progress on another branch. If a deploy changes how the game plays while Sam's page is open, the new function replays Sam's record under new rules, and gets another game. That must be a clean refusal, logged as what it is, not a mismatch that looks like a forgery.

#### Elevator Pitch

Before (after slice 02): a deploy that changes how the game plays while Sam's page is open → Sam's next signing is refused as `replay-mismatch`, which reads like a forgery in the log.
After: Sam's signing → "Couldn't confirm SAM's signing.", with the log reason `rules-changed`; after a reload, Sam's next game signs as usual.
Decision enabled: the owner tells forgeries from version changes in the log, and picks a quiet moment for a deploy that changes how the game plays.

**Domain examples**

1. *A gameplay deploy*: Sam's page loaded at 10:00 with rules version 1. Version 2, with faster bolts, is published at 10:05, and Sam signs at 10:10. The signing is refused as `rules-changed`.
2. *A look-only deploy*: new backdrop colours, with no change to the gameplay, keep version 1, and Sam's signing is saved.
3. *A forgotten version*: a developer changes the enemy fire timing without raising the version. The build fails on the recorded games, before anything is deployed.

**UAT scenarios**

1. *A record from other rules is refused without replay.* Given the function runs rules version 2, When a record from version 1 is signed, Then it is refused as `rules-changed`, nothing is saved, and the log shows it was never replayed.
2. *A change to the look keeps the version.* Given the recorded games, When only colours or art change, Then they replay to their recorded deposits, and the build passes.
3. *A change to the gameplay needs a new version.* Given the recorded games, When the gameplay changes and the version doesn't, Then the build fails on the recorded games.

**Acceptance criteria**

- [ ] A record names the rules version it was played with, and a record from another version is refused as `rules-changed`, without being replayed. (UAT 1)
- [ ] The recorded-games check fails when the gameplay changes and the version doesn't, and passes when only the look changes. (UAT 2, 3)

**Outcome KPI**: K23 (honest players are never refused, or are told why in the log).
**Technical notes**: the static files are revalidated on every page load (`max-age=0, must-revalidate`), but an open page keeps the modules it loaded. The recorded-games check is K21's corpus, run in the build gate.
**Dependencies**: US-03.

## Wave: DISCUSS / [REF] Outcome KPIs

**Objective**: every deposit on the shared table comes from a game that was really played, with no cost to honest players.

| ID | Who | Does what | Target | Baseline | Measured by | Gate | A miss triggers |
|---|---|---|---|---|---|---|---|
| K20 | Forgers | have every forgery in the catalogue refused | 10 of 10 forgeries refused with their reason; 0 rows saved | Today, 2 of 10: only the over-cap body and the deposit above £250,000 | Acceptance scenarios on the real function and Blobs emulator (`@server`, in the build gate), plus the console forgery in the three browsers | hard | No merge |
| K21 | Honest games | replay to the deposit and the game-over step the player saw | 0 mismatches: over a corpus of recorded games played in Chromium, Firefox and WebKit, replayed in Node, and over every signing in the acceptance suite | Probe, 2026-10-26: 7 of 7 games identical in Node, Chromium, Firefox and WebKit | The corpus in the build gate; the browser scenarios | hard | No merge |
| K22 | A 60-minute game | is verified in time on Netlify | On a deploy preview: answered 200 within 5 s on the client, with the replay under 1 s by the function's log | Probe: about 0.3 s extrapolated, Node 22 on an M4 Pro; not measured on Netlify | DEVOPS smoke test on the preview | hard | No merge (DEVOPS go/no-go) |
| K23 | Honest players in production | are never refused, or the log says why | Every `replay-mismatch`, `too-fast` and `rules-changed` in the 30 days after release is investigated; 0 traced to a determinism bug or a clock problem | n/a | The function's log, weekly | soft | A fix via `/nw-bugfix` |
| K24 | Forgers in production | leave no row | 0 rows on the production table that the owner judges forged, in the 30 days after release | 2026-10-26: rows of about £9,999,950, deleted by the owner (S0) | `GET /api/scores` weekly, and the log's refusals by reason | soft (observational) | Investigate, then decide whether D16's residual risk needs more |

**The forgery catalogue (K20)**: (1) no session; (2) an altered session; (3) a session used twice; (4) a claimed deposit that isn't the replayed one; (5) a record that doesn't end at game over; (6) a malformed record; (7) a record over 60 minutes; (8) a record faster than the clock; (9) a body over the cap; (10) a replayed deposit above £250,000.

**Guardrails** (hard, automated or on the preview):
- The leaderboard's walking skeleton and scenarios, and the typed-initials scenarios, stay green in Chromium, Firefox and WebKit, with every signing now verified by replay.
- K10 (signing p95 under 1000 ms on a preview), K11 and K14 are re-run, as the release-check trigger requires for a change to `scores.mjs`.
- K15 holds: a game start still costs one request.

Proposed IDs: DISTILL registers K20–K24 in [kpi-contracts.yaml](../../product/kpi-contracts.yaml).

**Hypothesis**: we believe that replaying each game on the server, from a session issued as the game starts, will keep forged deposits off the shared table at no cost to honest players. We will know this is true when every forgery in the catalogue is refused (K20), every honest game replays to its own deposit (K21, K23), and no forged row appears in the 30 days after release (K24).

## Wave: DISCUSS / [REF] Definition of Done

1. Every acceptance criterion is verified as DISTILL's traceability says. The automated ones are green in the unit and in-memory projects, and in Chromium, Firefox and WebKit.
2. The leaderboard's walking skeleton is green with its signing verified by replay. `npm test` and `npm run build` are green, with no `@pending` left.
3. The forgery catalogue (K20) and the recorded-games corpus (K21) run in the build gate.
4. The secret is set in Netlify's environment for production and for deploy previews (the owner sets it). The DEVOPS smoke test signs a real recorded game on the preview, and measures K22 and the re-runs of K10, K11 and K14.
5. ADR-007's accepted risk is superseded by the new ADR, which states D16's residual risk. ADR-004, ADR-006 and ADR-008, the brief and OUT-8 are amended where DESIGN changes them.
6. The README and the moderation guide say how to set and rotate the secret, and what still gets through (D16).
7. No new runtime dependency in the browser, and the function's only dependency is still `@netlify/blobs`.
8. Manual check by the deliverer on the deploy preview: a few games in Chrome, Firefox and Safari play as before, and sign.
9. The PO's check on the deploy preview is done, K23's and K24's baselines are recorded on release day, and the work is merged to `main`.

## Wave: DISCUSS / [REF] Out of scope

- **Anti-bot measures**: reaction-time heuristics on the record, captchas, a seed revealed wave by wave from the server (which would put the network on the frame path). D16 accepts the risk instead.
- **Keeping or showing replays**: storing records, or a "watch the replay" view.
- **Verifying a game played on older rules** (D10 refuses it).
- **Re-checking the rows already on the table** (D4).
- **New player-facing wording or signing outcomes** (D5).
- **Accounts, identity or anything personal** beyond today's three initials.
- **Minifying or obfuscating the JavaScript**, which the RCA rejects, and a bundler.
- **Splitting the rate limit** between reading and signing (ADR-007 keeps it for when it bites).

## Wave: DISCUSS / [REF] WS strategy

**Strategy C (real local), extending the leaderboard's walking skeleton instead of adding a parallel one.** The skeleton "A house-hunter signs the high-score table and another house-hunter sees it" (`@walking_skeleton @driving_port`) already runs the real page, keyboard, function and Blobs client on the emulator behind `scripts/serve.mjs`. After slice 01, its game asks for a session as it starts and its signing carries it; after slice 02, its signing is replayed. Its steps can stay as they are, because the session and the record are invisible to the player.

- **One new walking-skeleton scenario at the server's driving port** (`@walking_skeleton @driving_port @server`): "A signing that no game asked for doesn't reach the table". It posts a signature with no session to the real function on the emulator, and reads the table back.
- **The local server makes its own secret**, so the skeleton needs no setup, and never uses production's.

## Wave: DISCUSS / [REF] Driving ports

- **HTTP, the Score API**:
  - `POST /api/sessions` (new; the path is DESIGN's): the game's seed in, its session and the refreshed table out.
  - `POST /api/scores` (changed): the signing now carries its session and its record, besides the initials and the claimed deposit.
  - `GET /api/scores` (unchanged): the page-load read, still cached for 15 s.
- **The keyboard in the game page** (unchanged): what the rules see of it at each step (left, right, fire) is now recorded.
- **Unchanged and not driven by this feature**: page load, window `blur`, `visibilitychange`, and the initials entry.

## Wave: DISCUSS / [REF] Pre-requisites

- **PR #4 merged** (`4d17123`): the plausible ceiling and the `implausible-score` refusal.
- **For DESIGN**:
  - the session's shape, its endpoint, its secret and the reason codes;
  - the record's encoding, the new body cap and how the function keeps the 60-minute limit cheap;
  - one row per session without a second key family (D3);
  - a game the function can create afresh for each check, and what that means for the views (`render.js` imports `g`) and for the test harnesses (`snapshot()`, `fresh-game.js`, `arrange`);
  - where the replay code lives, and the amended layering rule 5;
  - the rules version and the recorded-games check (D10);
  - the clock allowance (D8), and how the fake-clock browser tests get through the local server without weakening production.
- **For DEVOPS**: the secret in Netlify's environment for production, deploy previews and branch deploys (the brief's "no secrets" changes); a smoke test that signs a real record (it can play a game in Node with the same rules) and measures K22.
- **For DISTILL**:
  - the forgery catalogue (K20) and the recorded-games corpus (K21);
  - the existing tests that write the rules' state or seed `Math.random`, which move to the game's own seed: `tests/unit/support/fresh-game.js` (`withDeterministicChance`, `arrange`), `tier-b/signing-rules.js`, `tier-b/entry-rules.js`, the 11 unit specs that import `game.js`, and the browser drivers that seed `Math.random` (`leaderboard-game.js`, `game-driver.js`);
  - the walking-skeleton scenario above.

## Wave: DISCUSS / [REF] Probe results

A probe on 2026-10-26 ([findings](probe/findings.md), scripts alongside) ran against a patched copy of the rules: seeded gameplay draws, particles on their own source, and squared distances in place of `Math.hypot`. It is evidence, not production code.
- **Determinism**: 7 bot games (3.6 to 16.7 minutes of game time, levels 1 to 6) replayed identically, fingerprint for fingerprint every 10 simulated seconds, in Node 22, Chromium 151, Firefox 153 and WebKit 26.5.
- **`Math.hypot` → squared distances**: the same games, fingerprint for fingerprint.
- **Cost**: about 1,500 steps a millisecond in Node. 72,000 steps (10 minutes) take about 50 ms; 60 minutes extrapolates to about 0.3 s on an M4 Pro.
- **Size**: the record, as compact text, is 0.8–1.6 KB a minute at human pace, and up to 4 KB a minute for a program that changes keys at every step.

## Wave: DISCUSS / [REF] DoR validation

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Problem statement clear, in domain language | PASS | Each story opens with the forger's move or the player's constraint: £249,950 by `curl`, the console line, a 25-minute record against a 1 KB cap, a 20-minute game computed in seconds, a deploy mid-session |
| 2 | Persona with specific characteristics | PASS | Alex Morgan (`casual-arcade-player`), with Priya (long runs) and Sam (quick games) of the same segment. The owner and the forger HAX are roles, named and described |
| 3 | ≥ 3 domain examples with real data | PASS | 3–4 per story, with real deposits, tables, durations and the RCA's own forgeries |
| 4 | UAT in Given/When/Then, 3–7 per story | PASS | 6, 5, 6, 4, 3 and 3 scenarios, each with one When, covering happy, edge and error paths; outlines with their examples inline |
| 5 | AC derived from UAT | PASS | Every AC names the UATs it comes from; every UAT feeds at least one AC |
| 6 | Right-sized | PASS | ½ to 1 day per story. Slice 02 is about 2 days with its precursors, the recorded exception (Scope assessment) |
| 7 | Technical notes | PASS | On every story: the body's shape and cap, `loadTable` and `signTable`, the three controls the rules read, the `Math.random` and `Math.hypot` sites, the module-level `g` and the harnesses, layering rule 5, the fake clock, the rate limit, the probe's numbers |
| 8 | Dependencies resolved or tracked | PASS | PR #4 merged. US-02 needs US-01; US-03 needs US-01 and US-02; US-04, US-05 and US-06 need US-03. DESIGN, DEVOPS and DISTILL items are listed under Pre-requisites |
| 9 | Outcome KPIs with measurable targets | PASS | K20–K24, each with who, what, a numeric target, a baseline (or why there is none), a method, a gate and what a miss triggers |
| — | Job traceability (hard check) | PASS | One `job_id` per story; J-TABLE-TRUST is added to `jobs.yaml`, and J-TABLE-SIGN is already there |
| — | Elevator pitch (hard check) | PASS | Every story has Before, After (a real `curl`, console line or UI action → an exact observable output) and Decision enabled. No story is `@infrastructure`; slice 02's precursors are commits inside the slice, not stories |

**DoR status: PASSED.** Expansion triggers: *cross-context complexity* fires (three modules, a new secret), and its suggested expansion, `alternatives-considered`, is covered by the alternatives behind D1–D4 and by the new ADR's "Alternatives considered". No other trigger fires: one persona segment, no regulatory terms, WS strategy C.

## Wave: DISCUSS / [REF] Changed assumptions

The earlier documents are not edited here. Their originals are quoted, and DESIGN amends them:

- **ADR-007, Decision**: "Accepted risk: made-up scores from a script, up to the plausible ceiling" → superseded: a made-up deposit is refused (D1, D6–D10). What is still accepted is narrower: a program that plays well (D16).
- **ADR-007, Alternatives considered**: "Server-side replay of the game from recorded inputs: the only real proof, but it means running the whole game on the server. Far beyond a fan game." → The rules already run without browser APIs, in fixed steps, and a seeded copy replays identically in Node and three engines, at about 50 ms for 10 minutes (probe).
- **ADR-007 and DDD-5**: "The body is read with a 1 KB byte cap … The body must be JSON with exactly `{ initials, score }`" → the body carries a session and a record, under a cap DESIGN sets (US-04).
- **ADR-006, rule 5**: "`netlify/**` imports only `src/game/high-scores.js` from `src/`." → The function also imports the rules it replays (US-03).
- **ADR-006, Context**: "`src/game/game.js` can't be imported server side: it holds the module-level game state `g`" → the function needs a game it can create afresh for each check (US-03).
- **ADR-008, Decision**: "When the table is read: on page load, in the background whenever a game starts (`gameStarted`), and from every POST answer." → the game-start read becomes the session request's answer, which is never cached (D2, US-02).
- **Brief, Platform and Delivery**: "Nothing else: no secrets, no environment variables beyond `NODE_VERSION`" → one secret (D3).
- **RCA, S2**: "When a game starts, the function issues a session: an id, `startedAt` and a seed" → the game picks its seed, and the session binds it with the issue time (D2). "The function refuses a score above `R × elapsed seconds`" → replaced by the replay and the clock check (D1, D8): there is no R to calibrate.
- **RCA, S3 item 3**: "The client records input by step index: held-key changes, presses, typed initials and pauses. That is a few KB for a long game" → only the three held controls by step: presses, pauses and initials never reach the gameplay (US-03). 0.8–1.6 KB a minute at human pace, so 50–100 KB for an hour (probe).
- **RCA, Residual risk**: "a bot that plays well in real time" → also a program that searches offline for the inputs that do best with a seed it knows; D8 holds it to real time per game (D16).

## Wave: DISCUSS / [REF] Wave decisions summary

- **Decisions**: D1–D4 (the user, 2026-10-26: replay with refusal on mismatch, the game's own seed with a session at the start, an HMAC token, keep the current rows). D5–D16 are PO defaults, awaiting the user's approval with this DISCUSS.
- **Jobs**: J-TABLE-TRUST (new, opportunity 14, evidence: one incident) and J-TABLE-SIGN (11, no regression).
- **Feature type**: cross-cutting, brownfield. **Walking skeleton**: slice 01, extending the leaderboard's.
- **Constraints**:
  - The frame never waits on the network, and a game start costs one request.
  - The game plays exactly as before.
  - The table port stays as it is (no second key family).
  - No new runtime dependency.
  - Logs carry fixed reasons only.
- **Risks**:
  - The secret must be set in every Netlify deploy context, or nobody can sign (D3).
  - Netlify's CPU for a long replay is unmeasured (K22).
  - Every future change to the gameplay needs a rules version bump (D10).
  - The browser tests play on a fake clock and need the local server's help with D8.
  - Slice 02 is about 2 days, over the 1-day target.
  - A program that plays well still gets through (D16).
- **Handoff**: DESIGN (nw-solution-architect), with the decisions, the stories, the probe and the Pre-requisites. DEVOPS gets K22, the secret and the smoke test; K23 and K24 read the log and the public table.
