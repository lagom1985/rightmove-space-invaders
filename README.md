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
| M | Sound on / off |
| N | Music on / off |

The game needs a physical keyboard. Phones and narrow windows get a "play on desktop" screen.

## Test

```bash
npm install
npx playwright install   # first time only
npm test
```

The acceptance test lives in `tests/e2e/rightmove-invaders/acceptance/`. It drives the real page with keyboard events in Chromium, Firefox and WebKit, and uses Playwright's fake clock to fast-forward game time.

## Deploy

The game is a static site on Netlify, built from this repo. `netlify.toml` holds the build settings, so the only manual work is a one-time setup in the Netlify UI:

1. Netlify → **Add new site** → **Import from GitHub** → `lagom1985/rightmove-space-invaders`. Leave the build settings as they are; they come from `netlify.toml`.
2. **Domain management** → **Add domain** → `maketherightmove.fabiodamico.xyz`. Netlify DNS adds the record, and the HTTPS certificate is issued automatically.
3. **Roll back** a bad release: **Deploys** → a previous deploy → **Publish deploy**. Click **Start auto publishing** again once the fix is on `main`.

Every push to `main` deploys to https://maketherightmove.fabiodamico.xyz; pull requests and branches get deploy previews. `npm run build` is what Netlify runs: it executes the unit and in-memory tests (no browsers needed) and then writes `dist/` (just `index.html` and `src/`). If a test fails, nothing is published. The browser tests are not part of that build, so run `npm test` before pushing to `main`.

## How it's built

Plain Canvas2D and ES modules, with no runtime dependencies and no bundler (`npm run build` only copies the files to publish).

| File | Job |
|---|---|
| `src/main.js` | Game loop: fixed 120 Hz simulation steps, one render per display frame |
| `src/game.js` | Rules and state; publishes moments such as a shot or a pause for the sound system |
| `src/render.js` | Drawing |
| `src/input.js` | Keyboard, including holding very quick taps so they aren't lost |
| `src/shields.js` | Destructible house shields |
| `src/status.js` | Mirrors the HUD into the page for screen readers |
| `src/storage.js` | Best score and the sound and music settings in `localStorage` |
| `src/events.js` | The sound system's vocabulary: game events, cue operations and sound names |
| `src/sound.js` | Sound director: turns game events into cues (what should be heard, and when) |
| `src/synth.js` | Web Audio synth: plays the cues, with the music on its own bus |
| `src/theme.js` | Names, colours, values, pixel art and sound recipes |

Design notes and the performance spike are in `docs/feature/rightmove-invaders/spike/`.

## Brand

All artwork is original pixel art; neither the Rightmove logo nor the original Space Invaders sprites are used. The colours in `src/theme.js` approximate the Rightmove brand and should come from the official brand kit. Using the Rightmove name outside an internal context needs brand-team approval.
