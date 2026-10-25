# Make the Right Move

Rightmove-themed Space Invaders-style browser game. Vanilla Canvas2D + ES modules, no runtime dependencies in the browser (the shared high-score table's Netlify Function, `netlify/functions/scores.mjs`, uses `@netlify/blobs`), no bundler (`npm run build` only copies `index.html` and `src/` to `dist/` for Netlify). Run with `npm start` (http://localhost:4173); test with `npm test` (Playwright + playwright-bdd, Chromium/Firefox/WebKit).

## Development Paradigm

This project follows the **object-oriented** paradigm. Use @nw-software-crafter for implementation.

In this codebase that means small ES modules exposing factory functions (`createKeyboard`, `createRenderer`, …) that return objects with private state, with game rules in `src/game/game.js` acting on one state object. Game rules never import browser adapters (canvas, Web Audio, storage UI); adapters are wired together in `src/main.js`.

`src/` is organised by layer: `main.js` (composition root), `game/` (rules and state, no browser APIs), `sound/` (director, synth and the sound recipes, which are data), `view/` (canvas and DOM status mirror), `platform/` (keyboard, `localStorage` and the high-score table client) and `theme/` (visual and game data: hurdles, colours, art, ladder; it imports nothing). `game/` imports only from `game/` and `theme/`; persistence is injected from `main.js` (`applySettings`, `applyBestStore`), so there is no exception for storage. Across the server boundary: `src/**` never imports `netlify/**` or `@netlify/*`; `netlify/**` may import only `src/game/high-scores.js` from `src/`; `high-scores.js` imports nothing (ADR-006).

## Docs

- Product SSOT: `docs/product/` (jobs, personas, journeys, architecture brief and ADRs).
- Per-feature waves: `docs/feature/{feature-id}/feature-delta.md` and `slices/`.
- Repo docs are written in English.

## Mutation Testing Strategy

Mutation testing is **disabled**. Test quality validated through code review and CI coverage.
