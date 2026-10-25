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

The acceptance suites live in `tests/e2e/<feature>/acceptance/`, one per feature: `rightmove-invaders` (the game), `rightmove-invaders-sound` (sound and music) and `rightmove-invaders-leaderboard` (the shared high-score table). They drive the real page with keyboard events in Chromium, Firefox and WebKit, and use Playwright's fake clock to fast-forward game time. Scenarios tagged `@in-memory` or `@server` need no browser and run once, in the `in-memory` project; the unit properties are in `tests/unit/`.

## Deploy

The game is a static site on Netlify, built from this repo. `netlify.toml` holds the build settings, so the only manual work is a one-time setup in the Netlify UI:

1. Netlify → **Add new site** → **Import from GitHub** → `lagom1985/rightmove-space-invaders`. Leave the build settings as they are; they come from `netlify.toml`.
2. **Domain management** → **Add domain** → `maketherightmove.fabiodamico.xyz`. Netlify DNS adds the record, and the HTTPS certificate is issued automatically.
3. **Roll back** a bad release: **Deploys** → a previous deploy → **Publish deploy**. A rollback moves the code, not the data: the production high-score table stays as it is (no signature is undone, no deleted row comes back). Once the fix is on `main`, publish its deploy and click **Unlock to start auto publishing**.

Every push to `main` deploys to https://maketherightmove.fabiodamico.xyz; pull requests and branches get deploy previews. `npm run build` is what Netlify runs: it executes the unit and in-memory tests (no browsers needed) and then writes `dist/` (just `index.html` and `src/`). If a test fails, nothing is published. The browser tests are not part of that build, so run `npm test` before pushing to `main`.

## How it's built

Plain Canvas2D and ES modules, with no runtime dependencies in the browser and no bundler (`npm run build` only copies the files to publish). The shared high-score table is a Netlify Function (`netlify/functions/scores.mjs`), whose only dependency is `@netlify/blobs`.

`src/` is organised by layer, matching the ports and adapters in `docs/product/architecture/brief.md`: `game/` holds the rules and state with no browser APIs, and the other folders plug into it from `main.js`.

| File | Job |
|---|---|
| `src/main.js` | Composition root and game loop: fixed 120 Hz simulation steps, one render per display frame |
| `src/game/game.js` | Rules and state; publishes moments such as a shot or a pause for the sound system. Settings and the best-score store are handed in from `main.js` |
| `src/game/shields.js` | Destructible house shields |
| `src/game/high-scores.js` | The high-score rules shared by the game and the function: table size, initials, the word filter, what makes a valid signature and which deposits make the table. Imports nothing |
| `src/game/events.js` | The game's vocabulary: game events (the sound system's, and the table's: `initialsEntered`, with which `main.js` signs the high-score table), cue operations and sound names |
| `src/sound/director.js` | Sound director: turns game events into cues (what should be heard, and when) |
| `src/sound/synth.js` | Web Audio synth: plays the cues, with the music on its own bus. Built from `voices.js` (voices from recipes), `effects.js` (voice cap and loops), `music.js` (music scheduler) and `journal.js` |
| `src/sound/recipes.js` | Sound data: pitches, the mix, the tune and each sound's recipe |
| `src/view/render.js` | Drawing |
| `src/view/status.js` | Mirrors the HUD into the page for screen readers |
| `src/view/messages.js` | The words both views show (the signing messages, the refused initials, the unavailable table, play again), declared once (data only, no imports) |
| `src/platform/input.js` | Keyboard, including holding very quick taps so they aren't lost |
| `src/platform/storage.js` | Best score and the sound and music settings in `localStorage` |
| `src/platform/leaderboard.js` | The high-score table client: reads and signs `/api/scores`, one request per call with a 5-second timeout |
| `src/theme/theme.js` | Names, colours, values, pixel art and the property ladder (data only, no imports) |
| `netlify/functions/scores.mjs` | The shared high-score table: a Netlify Function over Netlify Blobs, behind `/api/scores` (read the top 10, or sign it) |
| `scripts/smoke-leaderboard.mjs` | Smoke test of the high-score table on a Netlify preview and on production, run by hand with the owner's OK |

Design notes and the performance spike are in `docs/feature/rightmove-invaders/spike/`.

## Brand

All artwork is original pixel art; neither the Rightmove logo nor the original Space Invaders sprites are used. The colours in `src/theme/theme.js` approximate the Rightmove brand and should come from the official brand kit. Using the Rightmove name outside an internal context needs brand-team approval.
