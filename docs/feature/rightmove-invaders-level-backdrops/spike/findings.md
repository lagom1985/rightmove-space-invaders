# SPIKE Findings: rightmove-invaders-level-backdrops

**Date**: 2026-10-26
**Brief** (user): every level has the same background; make the levels look more varied and interesting. No DISCUSS artifacts exist yet. The user chose the direction on 2026-10-26: each rung of the property ladder gets its own **neighbourhood map**, a **time-of-day palette** and **a skyline of that rung's homes**. The new backdrop **crossfades in during the "Wave cleared!" banner**, and from Forever home onwards the backdrop **stays on Forever home**.
**Probe question**: Can each rung get its own backdrop (map + palette + skyline) while every foreground colour stays legible on 100% of the area where it is drawn? Hurdles, bolts, shot, pin, Dream home and the houses' bricks and windows need at least 3:1 contrast (WCAG 1.4.11, non-text). The HUD's small text needs at least 4.5:1 (WCAG 1.4.3).
**Budget**: none for speed. This is a legibility probe. Build time and the cost of a crossfade frame were recorded on the side.
**Probe code**: two throwaway files in the session scratchpad, not committed. `backdrops.html` draws the six backdrops and measures them. `run.mjs` serves that page together with the repo's real `src/theme/theme.js`, `src/game/config.js` and `src/game/shields.js`, so the colours and sprites are the game's own. It runs in Playwright 1.62. The probe folder was deleted after promotion.

**Promoted on 2026-10-26** into the walking skeleton: `src/theme/theme.js` (`NEIGHBOURHOODS`), `src/view/backdrop.js` and `src/view/render.js` (the crossfade). Built at 1×, the skeleton's six backdrops are pixel-identical to the probe's, so the contrast figures below hold for the shipped code. The real game mid-fade and on Terrace: [skeleton-fade.png](skeleton-fade.png), [skeleton-terrace.png](skeleton-terrace.png). See [wave-decisions.md](wave-decisions.md).

## Verdict

**WORKS, with one rule: every colour in a backdrop's palette must have a relative luminance of 0.05 or less.**

The first pass broke the rule in three palettes. The "lit window", tube-station and lighthouse colours reached 0.055 to 0.084. Gazumper red then fell to **2.56:1** against Semi-detached, and the dim HUD labels fell to **4.18:1** against Forever home, on about 1% of their area. After the nine colours above 0.05 were darkened to 0.048 or less, every check passed on 100% of its area on all six backdrops. The door is the only exception, and it already fails against today's backdrop (edge case 1).

## Results

Measured in headless Chromium on an Apple M4 Pro. Contrast is the WCAG ratio between the foreground colour and every backdrop pixel in the region where that colour can appear: the play area (y 70–686), the houses' band (y 530–584), the pin's band (y 640–686) and the top HUD (y 0–64). The figures are the minimum over the whole region, so they are a worst case. Build times are for one backdrop at 2× device resolution (1920 × 1440). Firefox and WebKit round timers to 1 ms.

| Backdrop | Time of day | Brightest pixel (luminance) | Gazumper (needs 3) | Brick (needs 3) | HUD label, dim (needs 4.5) | Tightest check | Build 2×, Chromium / Firefox / WebKit (ms) |
|---|---|---|---|---|---|---|---|
| Today (baseline) | – | 0.0395 | 3.84 | 3.92 | 5.39 | HUD label 5.39 | 1 / – / – |
| Studio flat | dawn | 0.0479 | 3.51 | 3.42 | 5.03 | HUD label 5.03 | 1.2 / 2 / 0 |
| Terrace | morning | 0.0485 | 3.49 | 3.40 | 4.67 | HUD label 4.67 | 1.2 / 2 / 0 |
| Semi-detached | midday | 0.0478 | 3.52 | 3.42 | 4.70 | HUD label 4.70 | 1.1 / 2 / 0 |
| Detached | afternoon | 0.0488 | 3.48 | 3.71 | 5.22 | Gazumper 3.48 | 1.0 / 2 / 0 |
| Country pile | sunset | 0.0470 | 3.55 | 3.45 | 5.28 | Brick 3.45 | 0.9 / 7 / 0 |
| Forever home | night | 0.0467 | 3.56 | 3.46 | 4.75 | HUD label 4.75 | 1.0 / 2 / 0 |

Every other colour has more room: Stamp Duty, Rate Rise, Broken Chain, Damp, Dream home, the green shot and pin, the windows and the white HUD text. The full rows are in [probe-results.json](probe-results.json), and all seven frames, today's first, are in [contact-sheet.png](contact-sheet.png).

**Where the 0.05 comes from.** Each foreground colour sets a ceiling on the backdrop's luminance. Brick (luminance 0.285) needs the backdrop at 0.0615 or below for 3:1, and Gazumper (0.294) needs 0.0647. The dim HUD label (0.410) needs 0.052 for 4.5:1, so it is the binding limit. A cap of 0.05 sits just under it and leaves room for anti-aliased pixels (edge case 2). The rule is about palette data alone, so it can be checked without reading a pixel.

**The crossfade** draws two full-size images per frame instead of one. In headless Chromium at 2× that took 2.8 ms per frame, inside the 8.3 ms of a 120 Hz frame. That was headless and software-rendered, and not checked on real hardware.

## What the probe contains

- **Palettes**: one per rung, all dark and shifted in hue by time of day (dawn violet, morning blue, midday slate-teal, afternoon olive, sunset plum, night navy). Each palette has nine named colours: `bg`, `grid`, `block`, `road`, `water`, `park`, `sky`, `light` and `accent`.
- **Neighbourhood maps**, top-down and faint, as on a property search map:
  - Studio flat: dense city blocks, a ring road, a dashed tube line with stations, and the river.
  - Terrace: long parallel streets lined with narrow plots, back alleys and a railway.
  - Semi-detached: curving roads, cul-de-sacs, and houses in pairs.
  - Detached: winding roads, big plots with gardens and trees, and a park with a pond.
  - Country pile: fields with dotted hedgerows, woodland, a lane, a long drive to the big house, and a lake.
  - Forever home: the coast, with a beach, a cliff path, a pier and the sea.
- **Skylines**, side-view silhouettes standing on the ground line, in the palette's `sky` colour with a few `light` windows: tower blocks, a terraced row with chimneys, pairs of semis, detached houses between trees, a manor on rolling hills, and a cottage and lighthouse on a cliff.
- **A seeded random generator per rung**, so each backdrop is identical every time it is drawn.

## Edge cases discovered

1. **The houses' door colour already fails 3:1 today.** The door (`#8a4a33`) has 1.82:1 against today's backdrop and 1.58:1 on the darkest new ones. Brick surrounds it, so only its bottom edge meets the backdrop. This was there before the feature, so it is not a gate, but a slightly lighter door would fix it everywhere.
2. **Anti-aliasing can be brighter than the palette.** A pixel blended between two palette colours can come out a little brighter than both: the brightest pixel measured was 0.0488, and the brightest palette colour 0.048. The cap needs a margin below the 0.052 limit, which is why it is 0.05 and not 0.052.
3. **The houses hide tall skylines.** The houses stand at y 530–584. Skyline shapes that rise above them read well (Studio flat's towers). So do shapes that repeat in the band below them, y 590–686 (Terrace, Semi-detached, Detached). Country pile's manor and Forever home's lighthouse mostly vanish behind the houses or into the map.
4. **Contrast does not measure clutter.** Terrace's regular street lines are the busiest backdrop. Every colour passes, but whether the 3 px bolts are easy to follow in motion is a play-testing question this probe did not answer.
5. **Firefox builds Country pile in 7 ms at 2×.** That is close to one 120 Hz frame, because of its many dashed hedgerow strokes; every other build took 2 ms or less. A backdrop must be built once per level change, never per frame. It would take longer at 3× (4K screens).
6. **Resize rebuilds what is on screen.** Today the backdrop is rebuilt on every resize. A resize during the crossfade has to rebuild both the outgoing and the incoming backdrop.
7. **Randomness has to be seeded.** With `Math.random` the map would differ in every game and from one resize to the next, and no screenshot comparison could hold. A per-rung seed keeps each rung's backdrop the same everywhere.
8. **Top-down map plus side-view skyline.** In stills it reads as "the map, with the street on the horizon". Whether it still reads that way in motion needs a human look.

## Design implications

- **Palettes are theme data.** A per-rung table in `src/theme/theme.js`, alongside `LADDER`: the time of day and its nine colours. `theme/` still imports nothing.
- **Drawing is view code.** Map and skyline recipes draw on a canvas, so they belong in `src/view/` (a backdrop module next to `render.js`), not in `theme/`. `game/` does not change: `g.level`, `g.state === 'clear'`, `g.banner` and `BANNER_TIME` already tell the view which backdrop to show and how far the crossfade has gone. The rung is `Math.min(level, 5)`, the same clamp as `ladderName`.
- **Legibility can be a pure unit property, with no pixels involved.** For every rung, every palette colour has a luminance of 0.05 or less. For every foreground colour in `COLORS` and `HURDLES`, the contrast against every palette colour meets its need (3:1, or 4.5:1 for HUD text). This would be a fast-check property in `tests/unit/`, like `music-level.spec.js`, and it fails as soon as someone adds a bright colour to a palette.
- **Build on level change, and cache.** Keep the "one offscreen canvas per backdrop" pattern. Hold the outgoing and incoming backdrops only while the crossfade runs.
- **Skylines go in the band below the houses**, y 590 to the ground, with at most a few landmarks rising above them.
- **Accessibility**: the status mirror already announces "Now on the property ladder at {rung}." It could also name the place and the time of day, for example "Terrace, morning", so screen-reader users get the same sense of moving up.

## Open for the promotion gate

- **How would an end-to-end test see the backdrop?** Canvas pixels are not asserted on in this codebase (see the rightmove-invaders spike), so the backdrop needs a DOM signal. That could be a status-mirror field, which would also serve screen readers. No browser scenario clears a wave today, and clearing 55 hurdles with real keys depends on random enemy fire. A walking skeleton either plays a whole wave on the fake clock, which needs a way to make the enemy fire predictable, or DESIGN picks a seam for starting at a later rung.
  *Resolved at the gate (user, 2026-10-26)*: a status-mirror field, `data-hud="neighbourhood"`, and wave 1 played for real (see below).
- **Which backdrop does the title screen show?** Studio flat, like the first wave? Or one that changes in attract mode?
  *For the skeleton*: the rung the game is on (Studio flat at load). Attract mode is left to DISCUSS.

## Second probe: clearing wave 1 in a browser

**Question**: can a blind key script (real key presses, `Math.random` seeded with 20261023, Playwright's fake clock) clear wave 1, so a browser scenario reaches Terrace with no seam into the game? Probe code: `clear-wave.mjs`, in the same scratchpad folder.

**Verdict: WORKS.** A sweep from side to side while holding Space never cleared it. Fourteen sweep periods from 0.8 s to 4 s all lost three homes, with between £750 and £9,400 saved (Dream home bonuses included). **Sheltering under the second and third houses in turn** (x 360 and 600), firing up through them, cleared the wave. The houses stop the bolts, and the pin's own shots wear a way up through the house above it.

| Time under each house | Result (Chromium) |
|---|---|
| 6 s | cleared at 98.6 s of game time, 3 homes left |
| 7 s | cleared at 76.4 s, 3 homes left |
| 8 s | cleared at 95.9 s, 2 homes left (Firefox and WebKit: identical) |
| 9 s | cleared at 185.9 s, 2 homes left |
| 10 s | cleared at 93.3 s, 2 homes left |
| 12 s | cleared at 70.5 s, 3 homes left |
| 16 s | game over at 92 s |
| 8 s, at x 380 and 580 | game over at 35.5 s |

- **It is deterministic across engines.** The 8 s run gave the same game in Chromium, Firefox and WebKit, to the 100 ms (95.9 s, 2 homes, £8,800).
- **It is not knife-edge in time, but it is in place.** Every time from 6 to 12 s clears. Standing 20 px off the houses' centres (380/580) loses, because the gap between each pair of houses is right above the pin at 360 and 600.
- **Fragility, accepted by the user**: the script only holds for these rules. A change to the fire rate, speeds, lives or house layout can make it fail, and then it needs retuning.
- **The skeleton's driver** (`steps/backdrops.steps.js`) works out the pin's position from the keys held and its speed, and waits out the respawn after a lost home. It reads the ladder, homes and announcement fields in one round trip per 100 ms tick. Three round trips per tick made Firefox take 53 s; with one, the scenario takes 7–31 s of real time per browser.
