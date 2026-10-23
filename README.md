# Make the Right Move

A Rightmove-themed take on Space Invaders for desktop browsers. You're a house-hunter's map pin defending your dream home from the hurdles of buying one: Gazumpers, Stamp Duty, Rate Rises, Broken Chains and Damp. Your shields are terraced houses that crumble a bit with every hit. Score is your deposit saved, and each cleared wave moves you up the property ladder.

## Play

```bash
npm start
```

Then open http://localhost:4173.

| Key | Action |
|---|---|
| ← → or A D | Move |
| Space | Fire |
| P or Esc | Pause |
| Enter | Start / play again |

The game needs a physical keyboard. Phones and narrow windows get a "play on desktop" screen.

## Test

```bash
npm install
npx playwright install   # first time only
npm test
```

The acceptance test lives in `tests/e2e/rightmove-invaders/acceptance/`. It drives the real page with keyboard events in Chromium, Firefox and WebKit, and uses Playwright's fake clock to fast-forward game time.

## How it's built

Plain Canvas2D and ES modules, with no runtime dependencies and no build step.

| File | Job |
|---|---|
| `src/main.js` | Game loop: fixed 120 Hz simulation steps, one render per display frame |
| `src/game.js` | Rules and state |
| `src/render.js` | Drawing |
| `src/input.js` | Keyboard, including holding very quick taps so they aren't lost |
| `src/shields.js` | Destructible house shields |
| `src/status.js` | Mirrors the HUD into the page for screen readers |
| `src/storage.js` | Best score in `localStorage` |
| `src/theme.js` | Names, colours, values and pixel art |

Design notes and the performance spike are in `docs/feature/rightmove-invaders/spike/`.

## Brand

All artwork is original pixel art; neither the Rightmove logo nor the original Space Invaders sprites are used. The colours in `src/theme.js` approximate the Rightmove brand and should come from the official brand kit. Using the Rightmove name outside an internal context needs brand-team approval.
