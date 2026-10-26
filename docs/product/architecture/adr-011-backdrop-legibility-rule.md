# ADR-011: The backdrop legibility rule: a luminance cap on palette data, and a contrast need per use, checked over every pair

**Status**: Accepted (DESIGN, 2026-10-26; approved by the user); amended by a follow-up (user, 2026-10-26): the title legend's names are drawn on a dark outline and checked against it, so Gazumper's label is no longer exempt · **Feature**: rightmove-invaders-level-backdrops

## Context
Six neighbourhood backdrops (ADR-010) now sit behind everything the player must see:
- the hurdles and their bolts, the pin, the shot, the Dream Home and the houses, which are objects and need **3:1** (WCAG 1.4.11);
- the HUD and the other text drawn straight on the backdrop, which is small text and needs **4.5:1** (WCAG 1.4.3). The pixel font is drawn at 8–16 px, and none of it counts as large text.

The SPIKE ([findings](../../feature/rightmove-invaders-level-backdrops/spike/findings.md)) measured every backdrop pixel by pixel and found a rule: **every palette colour must have a relative luminance of 0.05 or less**. The dim HUD label (luminance 0.410) needs a backdrop at 0.052 or below for 4.5:1, and anti-aliased pixels came out up to about 0.001 brighter than the brightest palette colour (0.0488 against 0.048). Three palettes broke the rule on the first pass, and Gazumper red fell to 2.56:1.

DESIGN found that the spike's list of needs missed some text:
- The Dream-home bonus text, "Dream home saved +£…", is 8 px in `COLORS.dream` (`game.js:428`). Its luminance is 0.396, so it needs a backdrop at about 0.049 or below. **The cap alone doesn't guarantee it**: against 0.05 it gets 4.46:1.
- The title's hurdle legend draws the hurdles' names as 16 px text in their own colours. Gazumper gets 3.51:1 on Studio flat, and already got 3.84:1 on the old backdrop (fixed by the amendment below).
- The door (`COLORS.door`) is 1.6–1.8:1. For 3:1 against the backdrop it would need a luminance of 0.25 or more, which drops it to 1.1:1 against its own brick (0.285). No colour satisfies both.

No test reads the canvas (waiver D10). Fast-check is unseeded in the unit project, which has already made one property flaky (the spike's findings).

## Decision
- **The rule is a test-only unit check on data**: `tests/unit/backdrop-legibility.spec.js`. Nothing in production computes contrast. The WCAG relative-luminance and contrast-ratio formulas live in a test helper, `tests/unit/support/contrast.js`.
- **Two clauses, checked over every pair in plain loops** (about 540 pairs, no sampling):
  1. **The cap**: every palette colour of every neighbourhood has relative luminance ≤ 0.05.
  2. **Contrast need per use**: each use in the needs table meets its need against every palette colour it can stand on. Each palette colour's luminance is **raised by 0.001**, the overshoot the spike measured for anti-aliased pixels. A crossfaded pixel is covered by the same allowance: the canvas blends in gamma space, and the sRGB curve is convex, so a blend is never brighter than its brighter colour except for an 8-bit rounding step.
- **The needs table** (the feature delta's "Legibility needs"):
  - 4.5:1 for `COLORS.dim`, `text`, `green` and `dream`;
  - 3:1 for the five hurdle colours, `brick` and `window`;
  - 4.5:1 for the names in the title legend (the five hurdles' and "Dream home"), against `COLORS.outline`, the dark outline they are drawn on, whatever the backdrop (amended, see below).
- **Exemptions, by name and with their reasons, written in the test**:
  - the door (no colour fixes it);
  - `COLORS.danger`, which is drawn only on the game-over overlay.
- **A failing check is fixed in the palette**: darken the palette colour. Lightening a foreground colour changes the whole game's look, and is a product decision.

## Alternatives considered
- **The cap alone**: simple, but it fails on dream's 8 px text, as shown above.
- **The rule and the maths as theme data or derivations**: they would document the rule next to the palettes, but nothing in production would read them. The theme comment states the rule, and the test enforces it.
- **A fast-check property over sampled pairs**: the style of `music-level.spec.js`, but the unit project is unseeded, and about 540 pairs are few enough to check them all, every run.
- **Measuring pixels in a browser test**, as the spike did: it reads the canvas (against waiver D10), needs a browser, and is slow. Because recipes draw only palette colours (ADR-010, checked on a recording context), the pixel test can be replaced by a check on data.
- **A colour-contrast package**: a dev dependency for about ten lines of public formulas.

## Consequences
- **Positive**:
  - A bright colour added to a palette, a darker foreground colour, or a new text use in a hurdle's colour fails in the build gate, before anyone sees it.
  - A new neighbourhood only has to meet clause 1 and the pairs it adds.
  - The check runs in milliseconds, with no browser and no randomness.
- **Negative**:
  - The needs table restates which colour `render.js` and `game.js` draw as small text. A new use in a new colour must be added to it by hand, and the Rendering universe's manual check is the backstop.
  - The tightest pair, dream against Detached's `light`, has about 1% of headroom.
  - Contrast doesn't measure clutter: whether Terrace's busy streets hide the 3 px bolts is left to play-testing.
  - One pre-existing shortfall stays, named: the door. The other, Gazumper's legend label, is fixed by the amendment.

## Amendment (follow-up, user, 2026-10-26): Gazumper's legend label
- **The shortfall**: the title legend draws Gazumper's name as 16 px text in `#ff5a5f`, its hurdle colour. That is 3.51:1 against Studio flat's brightest palette colour (`light`, luminance 0.048), and 4.5:1 is needed. DESIGN exempted it by name, because it predates the feature.
- **The fix**: every name in the legend, the five hurdles' and "Dream home", is drawn on a 2 px outline in `COLORS.outline` (`#141420`, luminance 0.0075) by `outlinedText` in `src/view/render.js`. No colour changes. The legend's values stay plain `COLORS.text`, which passes against every palette.
- **The check**: `tests/unit/legend-legibility.spec.js` checks each name's colour against `COLORS.outline` for 4.5:1. Gazumper's 6.0:1 is the lowest. The outline is one solid colour, so it gets no 0.001 allowance. The WCAG formulas are in `tests/unit/support/contrast.js` (`luminance`, `contrastRatio`), ready for `backdrop-legibility.spec.js` to reuse. Because the names are checked against their outline, they pass on any backdrop, not only Studio flat.
- **Rejected, with the user**:
  - a dark plate behind the legend rows: 5.2:1 at 70% opacity, but it hides part of the neighbourhood on the title;
  - a lighter red for Gazumper's name alone (`#ff888c`, 4.6:1): the name would no longer match its sprite, with about 3% headroom.
