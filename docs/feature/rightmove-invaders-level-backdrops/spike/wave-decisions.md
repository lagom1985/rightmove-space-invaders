# SPIKE Decisions: rightmove-invaders-level-backdrops

No DISCUSS artifacts existed. The brief came straight from the user: every level has the same background, so make the levels look more varied and interesting. The decisions below were made with the user on 2026-10-26.

## Concept
- **Each rung of the property ladder is a different place.** It has its own neighbourhood map, drawn faintly like a property search map, a time of day and a skyline of that rung's homes:

  | Rung | Neighbourhood | Map | Skyline |
  |---|---|---|---|
  | Studio flat | City centre at dawn | dense blocks, ring road, tube line, river | tower blocks |
  | Terrace | Terraced streets in the morning | parallel streets, narrow plots, railway | a terraced row with chimneys |
  | Semi-detached | Suburbs at midday | curving roads, cul-de-sacs, pairs of houses | pairs of semis |
  | Detached | Leafy avenue in the afternoon | winding roads, big gardens, park and pond | detached houses between trees |
  | Country pile | Countryside at sunset | fields, hedgerows, woodland, a long drive | a manor on rolling hills |
  | Forever home | Seaside at night | coast, beach, cliff path, pier | a cottage and lighthouse on the cliff |
- **The next neighbourhood crossfades in during the "Wave cleared!" banner.**
- **From Forever home onwards the backdrop stays on Forever home**, as the ladder's name already does.
- Not chosen, for now: ambient animation (traffic, a shimmering river, clouds), because it costs something every frame.

## Assumption Tested
- Can each rung get its own backdrop (map + palette + skyline) while every foreground colour stays legible on 100% of the area where it is drawn? Objects need at least 3:1 contrast and the HUD's small text at least 4.5:1. No speed budget: build time and crossfade cost were recorded on the side.

## Probe Verdict
- **WORKS**, with one rule: every backdrop palette colour has a relative luminance of 0.05 or less. Three palettes broke it on the first pass, and Gazumper red fell to 2.56:1. After darkening nine colours, every check passed on all six backdrops. See [findings.md](findings.md) and [contact-sheet.png](contact-sheet.png).

## Promotion Decision
- **PROMOTE** (user, 2026-10-26). The probe's six backdrops are validated and already look like the intended feature, so they are worth building on.
- The skeleton's browser scenario **plays wave 1 for real** (user, 2026-10-26), with no seam into the game. It uses the seeded `Math.random` and the fake clock, as the sound tests do. The user accepted the risk: a change to the rules' tuning (fire rate, speeds, lives, house layout) can make the scripted wave fail, and then the script needs retuning.

## Walking Skeleton
- Driving adapter: the browser page, played with real key presses (Playwright `page.keyboard`) on the fake clock with the seeded `Math.random`.
- Path: Enter starts the game, and the status mirror says the neighbourhood is "City centre at dawn". The pin shelters under the second and third houses in turn, 12 s each, holding Space, and the first wave is cleared. The status mirror then says the ladder is at "Terrace" and the neighbourhood is "Terraced streets in the morning". On the way, the renderer builds both backdrops and crossfades between them on the real canvas. The canvas is not asserted on (the policy's waiver D10). The mirror reads the same theme entry the renderer draws from.
- Acceptance test: [walking-skeleton.feature](../../../../tests/e2e/rightmove-invaders-level-backdrops/acceptance/walking-skeleton.feature). One `@walking_skeleton @driving_port` scenario, run in Chromium, Firefox and WebKit. Alone, it takes 11–24 s of real time in WebKit and Chromium and 48–53 s in Firefox. That is over Firefox's 45 s project timeout, so the scenario's `@timeout:120000` tag must stay. In the full suite: 527 passed and 1 failed. The failure was a unit property that also fails on the unchanged code (see Constraints Discovered).
- Code: `src/theme/theme.js` (`NEIGHBOURHOODS`, `neighbourhood(level)`), `src/view/backdrop.js` (new: the map and skyline recipes, and `buildBackdrop(neighbourhood, k)`), `src/view/render.js` (a cache of two backdrops and the crossfade), `src/view/status.js` and `index.html` (the Neighbourhood field). Today's backdrop colours (`COLORS.bg`, `grid`, `road`, `river`) are gone; nothing else used them.
- Commit: `feat(rightmove-invaders-level-backdrops): walking skeleton — a neighbourhood for every rung of the property ladder`
- Demo command: `npm start`, then open http://localhost:4173. Run the test with `npx bddgen && npx playwright test --grep "Clearing the first wave"`.

## Design Implications
- Palettes are theme data (`NEIGHBOURHOODS` in `src/theme/theme.js`, parallel to `LADDER`). Map and skyline drawing is view code (`src/view/backdrop.js`). `src/game/` does not change: `g.level`, `g.state`, `g.banner` and `BANNER_TIME` already say which backdrop to show and how far the fade has gone.
- The legibility rule can be a unit property on theme data alone, with no pixels: every palette colour has luminance ≤ 0.05, and every foreground colour meets its contrast against every palette colour. This is DISTILL's.
- **The backdrop must never call `Math.random`.** It draws with its own generator, seeded per rung. Otherwise drawing would use up the game's seeded random numbers and change the game the tests play.
- Backdrops are built when needed and cached (at most two: the current rung and the next), and rebuilt on resize.
- The status mirror names the neighbourhood (`data-hud="neighbourhood"`) for screen readers and for the tests.

## Constraints Discovered
- The luminance cap comes from the dim HUD label (4.5:1 needs a backdrop at 0.052 or below), then brick (0.0615) and Gazumper red (0.0647). Anti-aliased pixels can come out a little brighter than either colour they blend, so the cap is 0.05 rather than 0.052.
- The houses' door colour (`#8a4a33`) is already below 3:1 against today's backdrop (1.82:1). This was there before the feature: it is not a gate here, but worth a look.
- Skylines read best below the houses (y 590–686) or rising well above them. Tall landmarks behind the houses mostly vanish.
- Contrast does not measure clutter: whether the busiest backdrop (Terrace) keeps the 3 px bolts easy to follow in motion needs play-testing.
- Firefox takes 7 ms to build Country pile at 2×. Build once per rung change, never per frame.
- Clearing wave 1 with a blind script: a side-to-side sweep always lost three homes. Sheltering under the two middle houses, firing up through them, cleared it with 6–12 s dwells in every browser, with an identical game in each (spike findings, second probe).
- Found along the way, not caused by this feature: the unit property at `tests/unit/status-mirror.spec.js:320` sometimes fails its "moments no run reached" check, because fast-check is not seeded in the unit project. It fails on the unchanged code too: 14 times in 300 repeats in one check, and at least 5 in 150 in a second. This needs its own fix.
