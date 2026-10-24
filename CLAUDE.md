# Make the Right Move

Rightmove-themed Space Invaders-style browser game. Vanilla Canvas2D + ES modules, no runtime dependencies, no bundler (`npm run build` only copies `index.html` and `src/` to `dist/` for Netlify). Run with `npm start` (http://localhost:4173); test with `npm test` (Playwright + playwright-bdd, Chromium/Firefox/WebKit).

## Development Paradigm

This project follows the **object-oriented** paradigm. Use @nw-software-crafter for implementation.

In this codebase that means small ES modules exposing factory functions (`createKeyboard`, `createRenderer`, …) that return objects with private state, with game rules in `src/game.js` acting on one state object. Game rules never import browser adapters (canvas, Web Audio, storage UI); adapters are wired together in `src/main.js`.

## Docs

- Product SSOT: `docs/product/` (jobs, personas, journeys, architecture brief and ADRs).
- Per-feature waves: `docs/feature/{feature-id}/feature-delta.md` and `slices/`.
- Repo docs are written in English.

## Mutation Testing Strategy

Mutation testing is **disabled**. Test quality validated through code review and CI coverage.
