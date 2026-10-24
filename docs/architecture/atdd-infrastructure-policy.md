# ATDD Infrastructure Policy

Per `nw-distill` § Project Infrastructure Policy. One file per project: apply it if it exists, write it if it's absent, and rewrite it with `--policy=fresh`. Git history is the audit trail. Agreed with the user on 2026-10-23 (DISTILL, rightmove-invaders-sound; revised after the final review gate).

## Driving
| Port | Mechanism | Note |
|---|---|---|
| Keyboard in the game page | Playwright `page.keyboard` against the real page served by `npm start`, in Chromium, Firefox and WebKit | Real browser input pipeline |
| Window focus and tab visibility | `blur` on `window`; `visibilitychange` with `document.visibilityState` overridden to `hidden` | Real listeners; no frame runs before the assertion |
| Sound director `handle(event)` | Direct call from Node step definitions (project `in-memory`) | Layer-2 acceptance for states that are slow to reach by playing |

## Driven internal (real)
| Port | Mechanism | Note |
|---|---|---|
| Persistence (localStorage) | Real browser storage, fresh BrowserContext per scenario | Blocked storage is simulated with an init script that makes `localStorage` throw |
| High-score table (`/api/scores`) | The real Netlify Function and the real `@netlify/blobs` client, mounted by `scripts/serve.mjs` against the local `BlobsServer` emulator (fresh temp directory per server start) | Added 2026-10-24 (SPIKE, rightmove-invaders-leaderboard). One table per scenario through a `test-board` cookie, which only the local server reads; "another computer" is a second BrowserContext with the same cookie. The emulator is not production: it returns no etags on reads and is not atomic, so nothing etag-based is proven locally |
| Accessibility tree (status mirror) | Real DOM, read via `role=status` and `[data-hud]` | |
| Screen (canvas) | Real canvas, not asserted on | **Waiver (user, D10)**: HUD indicator and controls line are a manual check in DELIVER |

## Driven external / non-deterministic (fake)
| Port | Fake | Note |
|---|---|---|
| Clock | Playwright `page.clock` (`install` → `pauseAt` → `runFor`) | Fast-forwards the game; the Web Audio clock still runs on real time, so tests assert on what started, never durations |
| Randomness (`Math.random`) | Seeded PRNG (mulberry32, fixed seed) installed by an init script before the page loads | Every run plays the same game; property tests use fast-check seed 20261023 unless `FC_SEED` is set |
| Audio output (Web Audio) | **Real** Web Audio in the headless browsers, observed through the synth's journal (ADR-003) | Deliberately real: local and free; verified headless in all three engines, and its clock runs on real time under the fake clock. Cursors use the journal `seq`, never the array index (the journal keeps the last 100). Director scenarios use an in-memory cue model and a reference plan instead. On the synth-only test page, `window.synth` is a test-only hook |
