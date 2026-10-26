# ADR-011: The backdrop legibility rule: a luminance cap on palette data, and a contrast need per use, checked over every pair

**Status**: Accepted (DESIGN, 2026-10-26; approved by the user) · Revised 2026-10-26 after the Final Wave Review Gate:
- the promise is stated as every use meeting its WCAG minimum, with the drops the user accepted;
- the check lives in the `in-memory` project as milestone 5;
- the pair count and the tightest pairs are corrected;
- Gazumper's legend exemption is marked temporary.

**Feature**: rightmove-invaders-level-backdrops

## Context
Six neighbourhood backdrops (ADR-010) now sit behind everything the player must see:
- the hurdles and their bolts and the houses, which are objects and need **3:1** (WCAG 1.4.11). The pin, the shot and the Dream Home share their colours with text (green and dream), so they are held to the stricter **4.5:1** (the needs table);
- the HUD and the other text drawn straight on the backdrop, which is small text and needs **4.5:1** (WCAG 1.4.3). The pixel font is drawn at 8–16 px, and none of it counts as large text.

The SPIKE ([findings](../../feature/rightmove-invaders-level-backdrops/spike/findings.md)) measured every backdrop pixel by pixel and found a rule: **every palette colour must have a relative luminance of 0.05 or less**. The dim HUD label (luminance 0.410) needs a backdrop at 0.052 or below for 4.5:1, and an anti-aliased or crossfaded pixel can come out at most an 8-bit rounding step brighter than the brighter colour it blends, about 0.001 at these levels (the spike's brightest measured pixel, 0.0488, matches today's brightest palette colour, Leafy avenue's road `#403f33`). Three palettes broke the rule on the first pass, and Gazumper red fell to 2.56:1.

**The backdrops are brighter than the old one**, so some contrasts drop while still meeting their minimum. On Studio flat, Gazumper goes from 3.84:1 to 3.51:1, and brick from 3.92:1 to 3.42:1. The user accepted this trade (2026-10-26).

DESIGN found that the spike's list of needs missed some text:
- The Dream-home bonus text, "Dream home saved +£…", is 8 px in `COLORS.dream` (`game.js:428`). Its luminance is 0.396, so it needs a backdrop at about 0.049 or below. **The cap alone doesn't guarantee it**: against 0.05 it gets 4.46:1.
- The title's hurdle legend draws the hurdles' names as 16 px text in their own colours. Gazumper gets 3.51:1 on Studio flat. It was 3.84:1 on the old backdrop, so the shortfall predates the feature, but this feature deepens it.
- The door (`COLORS.door`) is 1.6–1.8:1. For 3:1 against the backdrop it would need a luminance of 0.25 or more, which drops it to 1.1:1 against its own brick (0.285). No colour satisfies both.

No test reads the canvas (waiver D10). Fast-check is unseeded in the unit project, which has already made one property flaky (the spike's findings).

## Decision
- **The promise**: every foreground use meets its WCAG minimum on every backdrop, 3:1 for objects and 4.5:1 for text, except the named exemptions below, which include the uses that never stand straight on a backdrop (the game-over red and the veils). It doesn't promise that no contrast drops against the old backdrop.
- **The rule is a test-only check on data.** It lives in the `in-memory` project, which runs in the same build gate, as milestone 5: `tests/e2e/rightmove-invaders-level-backdrops/acceptance/milestone-5-everything-stays-readable.feature`. Nothing in production computes contrast. The WCAG relative-luminance and contrast-ratio formulas live in a test helper, `tests/unit/support/contrast.js`.
- **Two clauses, checked exhaustively in plain loops** (639 pairs plus 54 cap checks, no sampling):
  1. **The cap**: every palette colour of every neighbourhood has relative luminance ≤ 0.05.
  2. **Contrast need per use**: each use in the needs table meets its need against every palette colour it can stand on. Each palette colour's luminance is **raised by 0.001**, the margin for an anti-aliased pixel's rounding. A crossfaded pixel is covered by the same allowance: the canvas blends in gamma space, and the sRGB curve is convex, so a blend is never brighter than its brighter colour except for an 8-bit rounding step.
- **The needs table** (the feature delta's "Legibility needs"):
  - 4.5:1 for `COLORS.dim`, `text`, `green` and `dream`;
  - 3:1 for the five hurdle colours, `brick` and `window`;
  - 4.5:1 for the hurdle names in the title legend, against Studio flat only, the title's one backdrop.
- **Exemptions, by name and with their reasons, written in the check**:
  - the door: no colour fixes it;
  - Gazumper's name in the title legend, held to 3:1 like the hurdle itself. This exemption is **temporary**: a separate fix that outlines the legend names is already committed, will be merged right after DISTILL, and the exemption is dropped then;
  - `COLORS.danger`, which is drawn only on the game-over overlay;
  - the paused and game-over veils, translucent near-black over the whole screen: they only darken, so anything lighter than the backdrop drawn over them only gains contrast.
- **A failing check is fixed in the palette**: darken the palette colour. Lightening a foreground colour changes the whole game's look, and is a product decision.
- **Today's fix**: dream's 8 px text falls short on two road colours, Terrace's `#2f3f57` (4.479:1) and Leafy avenue's `#403f33` (4.463:1). DELIVER darkens each by a step. DISTILL's scratch build passed with `#2e3e56` and `#3f3e32`.

## Alternatives considered
- **The cap alone**: simple, but it fails on dream's 8 px text, as shown above.
- **The rule and the maths as theme data or derivations**: they would document the rule next to the palettes, but nothing in production would read them. The theme comment states the rule, and the check enforces it.
- **A fast-check property over sampled pairs**: the style of `music-level.spec.js`, but the unit project is unseeded, and 639 pairs are few enough to check them all, every run.
- **A spec in `tests/unit/`**: the first plan. DISTILL put the check beside the feature's other outcomes as milestone 5, in the same build gate.
- **Measuring pixels in a browser test**, as the spike did: it reads the canvas (against waiver D10), needs a browser, and is slow. Because recipes draw only palette colours (ADR-010, checked on a recording context), the pixel test can be replaced by a check on data.
- **A colour-contrast package**: a dev dependency for about ten lines of public formulas.

## Consequences
- **Positive**:
  - A bright colour added to a palette, a darker foreground colour, or a new text use in a hurdle's colour fails in the build gate, before anyone sees it.
  - A new neighbourhood only has to meet clause 1 and the pairs it adds.
  - The check runs in milliseconds, with no browser and no randomness.
- **Negative**:
  - Some contrasts are lower than on the old backdrop (accepted).
  - The needs table restates which colour `render.js` and `game.js` draw as small text. A new use in a new colour must be added to it by hand, and the Rendering universe's manual check is the backstop.
  - Dream's 8 px text is the binding use. After the two roads are darkened, the tightest pairs have about 1% of headroom.
  - Contrast doesn't measure clutter: whether Terrace's busy streets hide the 3 px bolts is left to play-testing.
  - Two shortfalls stay, named: the door for good, and Gazumper's legend label until the outlining fix is merged.
