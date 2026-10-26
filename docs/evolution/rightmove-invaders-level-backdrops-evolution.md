# Evolution: rightmove-invaders-level-backdrops

**Feature**: a neighbourhood backdrop for every rung of the property ladder in *Make the Right Move* · **Delivered**: 2026-10-26 on branch `rightmove-invaders-level-backdrops` (from `23c1a2b`, the DELIVER roadmap, to `060dc37`) · **Status**: delivered, not pushed and not merged to `main`. The checks that need real hardware, and the comparison with `main` on a deploy preview, are owed to the user · **Full record**: [feature-delta.md](../feature/rightmove-invaders-level-backdrops/feature-delta.md)

## Summary

Every level used to have the same background. Now each rung of the property ladder is a different place, with its own neighbourhood map, drawn faintly like a property search map, a time-of-day palette and a skyline of that rung's homes:

| Rung | Neighbourhood | Skyline |
|---|---|---|
| Studio flat | City centre at dawn | tower blocks |
| Terrace | Terraced streets in the morning | a terraced row with chimneys |
| Semi-detached | Suburbs at midday | pairs of semis |
| Detached | Leafy avenue in the afternoon | detached houses between trees |
| Country pile | Countryside at sunset | a manor on rolling hills |
| Forever home | Seaside at night | a cottage and a lighthouse on the cliff |

- **The fade**: the next rung's neighbourhood fades in while "Wave cleared!" shows, over the banner's 2.4 s. From Forever home onwards the backdrop stays on Forever home, as the ladder's name does. The title shows Studio flat, and a new game goes straight back to it.
- **Readable on every rung**: every foreground use meets its WCAG minimum against every palette colour, 3:1 for objects and 4.5:1 for text. Every palette colour is at relative luminance 0.05 or less, and a check on the data compares every use with every palette colour. Two road colours were darkened a step for the Dream home's 8 px pink text. The door is exempt by name, as before the feature, and the title legend's names are drawn on a dark outline. Some contrasts drop against the old backdrop, a trade the user accepted.
- **Screen readers**: the Neighbourhood field names the place, and the start of every wave after a clear says "Now on the property ladder at Terrace. Terraced streets in the morning."
- **Never in the way**: a backdrop is built only when needed, at most two are held, and one held is never rebuilt at its scale. The build every climb meets lands on the first "Wave cleared!" frame, when the player can't act. A backdrop that can't be built leaves its palette's plain background, and the game plays on.
- **How**: the palettes are theme data (`NEIGHBOURHOODS`). `view/backdrop.js` holds seeded recipes that paint on a context they are handed, a pure fade plan, a store of two with a fail-safe, and the shell `showBackdrop`, which `render.js` only calls (ADR-010). `BANNER_TIME` moved to `game/config.js`, the one change to `game/`. The legibility rule is a check on data, run over every pair (ADR-011). There is no new file under `src/` beyond the skeleton's `backdrop.js`, and no new dependency.

The work was 10 roadmap steps in 1 slice, all on 2026-10-26, a merge of `origin/main` mid-DELIVER, then a refactor and one review revision. 611 tests are green: 96 unit, 146 in-memory, and 123 each in Chromium, Firefox and WebKit. The feature's share is its 40 scenarios (74 runs, all in-memory) and SPIKE's walking skeleton in three browsers. The build gate (`npm run build`) passes 242.

## Business context

**There was no DISCOVER, DIVERGE or DISCUSS.** The brief came straight from the user on 2026-10-26: "every level has the same background", so make the levels look more varied and interesting. The persona is `casual-arcade-player`. No job, story or KPI was written, and `kpi-contracts.yaml` has none for this feature.

SPIKE chose the direction with the user (a place per rung, a crossfade on "Wave cleared!", the clamp at Forever home) and tested the one assumption that could sink it: can six backdrops stay legible for every foreground colour? The probe said yes, with one rule, a luminance cap of 0.05 on every palette colour, after nine colours were darkened. The user promoted it, and the walking skeleton played wave 1 for real in three browsers. Ambient animation was left out, because it costs something every frame.

DISTILL registered three outcomes, OUT-17 (legibility), OUT-18 (a neighbourhood for every rung, faded in) and OUT-19 (seeded, palette-only and fail-safe). They are what the scenarios check, not product KPIs.

## Key decisions

| Decision | Why | Record |
|---|---|---|
| Each rung a place: map, time-of-day palette and skyline; the next fades in during "Wave cleared!"; the backdrop stays on Forever home from there | A sense of moving up, with no cost during play | SPIKE (user) |
| The palettes in the theme as data; one map and one skyline recipe per look in the view, painting on a given context, seeded per rung and never `Math.random`, in palette colours and the ground line's green only (DDD-B1, B2) | The theme stays data that imports nothing; a recording context can see every call; the seeded game, and its tests, stay the same | [ADR-010](../product/architecture/adr-010-neighbourhood-backdrops-seeded-view-recipes.md) |
| Built lazily, at most two held, never rebuilt at its scale; the same scale on a resize changes nothing (DDD-B3) | The next rung is built on the first "Wave cleared!" frame, when the player can't act; Firefox takes 7 ms for Country pile at 2× | ADR-010 |
| A build that fails leaves the palette's plain background, with no throw, no log and no retry until a change of scale (DDD-B4) | Decoration must never freeze the game | ADR-010 |
| A pure fade plan, and its shell in `backdrop.js`; `render.js` only calls it (DDD-B5, F7, M-3) | Every case of the fade and the fail-safe can be listed and checked in memory | ADR-010 (user) |
| `BANNER_TIME` moves to `game/config.js`, re-exported by `game.js` (H-1, F9) | The plan can read it under the seventh layering rule and never sees `g` | ADR-010 (user) |
| A luminance cap of 0.05, and a contrast need per use against every palette colour plus 0.001, checked over every pair in plain loops (DDD-B6) | The cap alone fails on dream's 8 px text; 594 pairs are few enough to check them all | [ADR-011](../product/architecture/adr-011-backdrop-legibility-rule.md) |
| The door exempt by name; the legend's names on a dark outline; the drops against the old backdrop accepted (DDD-B7, H-2) | No door colour passes against both the backdrop and its brick; the outline fixes Gazumper's label without changing a colour | ADR-011 (user) |
| The arrival sentence: "Now on the property ladder at {rung}. {Neighbourhood name}.", at the start of every wave after a clear, never on a new game (DDD-B8, F4) | Screen-reader users hear where they have arrived | DESIGN (user) |
| The title shows Studio flat, with no tour (DDD-B9); no reduced-motion change (DDD-B10) | The higher rungs stay a reward; the fade is slow and dark | DESIGN (user) |
| A landmark passes when more than half of it is visible; on a fail, move the art, never the houses (DDD-B11) | Whether a skyline reads is a judgement by eye | DESIGN |
| The resize wiring checked by hand only (F8); the in-memory drivers call the view's units directly (a Mandate 1 deviation) | No seam into the game, and no test reads the canvas (waiver D10) | DESIGN, DISTILL (user) |
| **DELIVER amendments**: 10 steps from DISTILL's 7; the cottage moved; the tree line excused; `main` merged mid-DELIVER; dropped canvases released; the outcome anchor adapted | The roadmap review, DDD-B11 and the adversarial review | [Changed assumptions](../feature/rightmove-invaders-level-backdrops/feature-delta.md#wave-deliver--ref-changed-assumptions) |

## Work completed

| Slice | Step | Commit | What landed |
|---|---|---|---|
| 01 A neighbourhood for every rung | 01-01 | `e943084` | `BANNER_TIME` moved to `config.js`, re-exported by `game.js`. No scenario enabled |
| | 01-02 | `fe1279e` | `backdropPlan` for title, play, dead and over (6 runs) |
| | 01-03 | `d445204` | The fade: `next` and `mix` on "Wave cleared!", the clamps, nothing past Forever home (15 runs; all of M2) |
| | 01-04 | `46882b0` | `paintBackdrop` on a given context, seeded, palette only (4 runs). Forever home's cottage moved from x 74–146 to x 194–266, clear of the houses and standing on the cliff |
| | 01-05 | `366b1b4` | The store and the shell; `render.js` only calls them. `buildBackdrop`, the old cache and fade, and the scaffold marker deleted (6 runs). Page-error check in three engines: 0 errors |
| | 01-06 | `7f3ccba` | The same scale returns at once (3 runs) |
| | 01-07 | `6cfa346` | A failed build shows the palette's plain background, and the game plays on (8 runs) |
| | 01-08 | `ef4878b` | Failed marks, apart from the two, wait for a change of scale (4 runs) |
| | 01-09 | `63efbf4` | The arrival sentence (7 runs) |
| | 01-10 | `b4b4363` | Two road colours darkened (2 runs); the README |

Between 01-07 and 01-08 the user chose to merge `origin/main` (`b5c0879`), for PR #3's fix to a flaky property; it also brought PR #4, a cap on implausible scores. After the steps came:
- the L1–L6 refactor, `26b7701`: accurate comments, one ask per layer in the shell, `paintBackdrop`'s parameter renamed `place`, and the re-export's comment;
- the review revision, `060dc37`: the country map split into helpers (its call log byte-identical, SHA-256 of all six paintings unchanged), dropped canvases released, `bendY` and `MAX_HELD`, and comments.

The 10 steps ran from 17:20 to 19:56 UTC (the execution log), and the whole of DELIVER, from the roadmap (17:19) to the review revision (21:21), in about 4 hours. The whole feature took one day: SPIKE `378d427` and the walking skeleton `83a83fb`, DESIGN `644df67`, the legend follow-up `2fd5e46` (merged as `65a73ca`), DISTILL `0bd4561`, then DELIVER. Each step logged RED, GREEN and COMMIT once, all EXECUTED/PASS, and the execution log was committed with each step. The DES integrity check passed: "All 10 steps have complete DES traces".

## Lessons learned

1. **Stop processes by PID, never by pattern, on macOS.** A crafter's `pkill -f "node scripts/serve.mjs" -n` killed every `serve.mjs`: the preview server on 4173 and a suite run with them. macOS's `pkill` stops reading options at the pattern, so the `-n` after it was ignored. The server was restarted, and later steps were told to stop processes by PID only. Note the PID when a server starts, and kill that.
2. **Run `npx bddgen` after editing a `.feature`.** The generated specs in `.features-gen` stay stale until it runs, so a direct `npx playwright test` still runs the old tags and text. `npm run build` and `npm test` run it first; a direct run doesn't.
3. **Split a roadmap step at the seams DESIGN already draws.** Three of DISTILL's steps enabled 8 or more scenarios each. Split at the plan table (every state but `clear`, then the fade), the store (the build, then the scale rule) and the fail-safe (the plain background, then the failed marks), no step enabled more than 15 runs, and every phase passed the first time.
4. **Prove an art refactor byte-identical on the recording context.** The country map was split into four helpers in review. Hashing every painting's call log (SHA-256, all six) showed the drawing unchanged, without reading a pixel.
5. **Merge an upstream fix for a known flake before the remaining full-suite gates.** The flaky property at `status-mirror.spec.js:320`, found in SPIKE and fixed on `main` by PR #3, failed 01-07's full run and cost a rerun. Merging `main` then kept the later gates clean.
6. **Headless screenshots with a throwaway state script give quick visual coverage, not a verdict on feel.** 68 shots in three engines at 1× and 2× showed every backdrop, the clamp, the fade, a resize mid-fade and the landmarks, with no seam added to the game. Whether the busy streets hide the bolts, what a fade frame costs on a real GPU, and real Safari, still need real hardware.
7. **Let the data check name the colour to change, and change the backdrop, never the foreground.** DISTILL's check found the Dream home's pink short on two roads, not where DESIGN had estimated. DELIVER darkened those two roads by a step, the values from DISTILL's scratch build held, and the tightest pairs moved to window colours with about 0.16% of headroom, which the exhaustive check guards.
8. **Rule on a mandate's intent when its form doesn't fit the repo.** The review's blocker asked for "Outcome anchor: DISCUSS Elevator Pitch" in every scenario, but no DISCUSS ran and no feature in this repo carries that line. Every scenario is anchored to DESIGN by its `@contract-shape:…` and `@DDD-B…` tags; the orchestrator ruled on that and recorded why, as typed-initials did for its contract-shape blockers.
9. **A grep criterion that counts comments can be broken by a comment.** The review revision's caveat on the store names `document.createElement('canvas')` in a comment, so the roadmap's DOM-global grep, comments included, found one line until the close-out commit reworded it. The code was clean throughout. Word such a check as a code check, or recheck it after every revision.

## Issues encountered

- **Adversarial review: NEEDS_REVISION** (1 blocker, 1 high, 5 medium, 7 low), with no testing theater, no dead code, a design match and every edge case safe. B1 (lesson 8) was a project adaptation. H1: the closure evidence is in the feature delta's DELIVER sections, because only crafters write the execution log, and only phase entries. M1: the user excused Country pile's tree line by name. M2: the `render.js` wiring stays under waiver D10 and F8. One revision pass, `060dc37`, plus the orchestrator's doc fixes (M4, M5, L1, L2). L4 and L5 were accepted as notes.
- **The `pkill` that killed every server** (lesson 1).
- **Stale generated specs** after a `.feature` edit (lesson 2).
- **The DES pre-bash hook** blocks any shell command that mentions "execution-log", read-only ones included. The log has to be read with the file-read tool.
- **The first `log_phase` call changed the log's `schema_version` from "5.0" to "3.0".** The integrity check still passes. Worth reporting upstream.
- **The flaky property** cost one rerun in 01-07 (lesson 5).
- **Roadmap review**: conditionally approved (0 blockers, 4 high, 9 low). The orchestrator applied H1–H4 and L1–L7 before 01-01.
- **Mutation testing**: disabled under the project's strategy (`CLAUDE.md`), and logged as skipped.
- **Not verified by DELIVER**: real hardware, real Safari, a resize during play, play-testing Terrace's streets, and the deploy preview.

## Still open

- **Owed to the user, on real hardware**: play-testing Terrace's busy streets with bolts in motion; a fade frame's cost in Firefox at 2×; a resize during play (at most one hitch per change of scale); Safari on a real Mac (WebKit headless is covered).
- **The release**: with the user's OK, push the branch, open a pull request, compare its deploy preview with `main` for everything the canvas must not change, then the PO's check and the merge (the feature delta's [Pre-requisites](../feature/rightmove-invaders-level-backdrops/feature-delta.md#wave-deliver--ref-pre-requisites)).
- **The DOM-global comment** in `src/view/backdrop.js` (line 245), if the grep is to hold as worded.
- **Candidate follow-ups**, not in this feature: seeding fast-check in the unit project (DESIGN, For DISTILL 4); a globals check in the layering scan, in place of this feature's grep; a read-only view of `g` for the views (DDD-T14); ambient animation, left out in SPIKE. The door stays exempt by design.

## Links

- Delivery record: [feature-delta.md](../feature/rightmove-invaders-level-backdrops/feature-delta.md) (DESIGN through DELIVER), [SPIKE findings](../feature/rightmove-invaders-level-backdrops/spike/findings.md), [SPIKE decisions](../feature/rightmove-invaders-level-backdrops/spike/wave-decisions.md), [roadmap](../feature/rightmove-invaders-level-backdrops/deliver/roadmap.json), [execution log](../feature/rightmove-invaders-level-backdrops/deliver/execution-log.json), the by-hand evidence in [deliver/](../feature/rightmove-invaders-level-backdrops/deliver/) (`handcheck-*.png`)
- Architecture SSOT: [brief](../product/architecture/brief.md), [ADR-010](../product/architecture/adr-010-neighbourhood-backdrops-seeded-view-recipes.md), [ADR-011](../product/architecture/adr-011-backdrop-legibility-rule.md); the layering scan of [ADR-006](../product/architecture/adr-006-shared-high-score-rules.md), with ADR-010's seventh rule
- Product SSOT: [persona](../product/personas/casual-arcade-player.yaml), [journey](../product/journeys/play-a-session.yaml) (the start and outcome steps, and the `neighbourhood` artifact), [outcomes registry](../product/outcomes/registry.yaml) (OUT-17 to OUT-19). No KPI in [KPI contracts](../product/kpi-contracts.yaml)
- Test policy: [ATDD infrastructure policy](../architecture/atdd-infrastructure-policy.md), with this feature's rows: the backdrops on their own, window `resize` (waived), the widened D10 and the offscreen canvas factory
- Code and tests: [acceptance suite](../../tests/e2e/rightmove-invaders-level-backdrops/acceptance/), [backdrops](../../src/view/backdrop.js), [theme](../../src/theme/theme.js), [status mirror](../../src/view/status.js)
- **Nothing was migrated** to other permanent directories. The feature has no `design/`, `discuss/` or `distill/` folder, so no file matches the finalize destination map: ADR-010, ADR-011 and the architecture already live in `docs/product/architecture/`, the journey in `docs/product/journeys/`, and the walking skeleton is a `.feature` file under `tests/`. The delivery history, `spike/` included, stays in `docs/feature/rightmove-invaders-level-backdrops/`.
