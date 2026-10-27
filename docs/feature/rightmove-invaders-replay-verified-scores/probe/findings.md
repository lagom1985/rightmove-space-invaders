# Probe: can the server replay a game, and is it the same game everywhere?

**Date**: 2026-10-26 · **Wave**: DISCUSS (evidence for the slices and for DESIGN) · **Base**: `main` at `4d17123` · **Not production code**

The [forged-scores RCA](../../../analysis/root-cause-analysis-forged-high-scores.md) (S3) assumes three things that nobody had measured:
1. A seeded copy of the rules replays to the same game in Node (the function) and in the three browser engines.
2. Replaying a long game is cheap enough for a function: "a 10-minute game is 72,000 steps … well within a function's run time".
3. The input log is "a few KB for a long game".

This probe measures all three. It ran against a **patched copy** of `src/game/` in a scratch folder. Nothing under `src/` changed.

## Method

- **The patch** (`patch_probe.py`), applied to a copy of `game.js` and `shields.js`:
  - every gameplay draw (enemy fire, Dream Home timer, direction and bonus, shield erosion) calls a seeded sfc32 generator instead of `Math.random`;
  - the particles (`burst`) keep `Math.random` and can be switched off;
  - shield erosion compares squared distances (`dx*dx + dy*dy` against `r*r` and `(r - 1.2)²`) instead of `Math.hypot`, with the original kept behind a flag for comparison.
- **The bot** (`replay.js`): a greedy player. It walks under the nearest living hurdle (or the Dream Home), keeps Space held, and steps aside from a bolt about to land. Before each step it decides the three controls the rules read (left, right, fire), and logs each change as `[step, bits]`.
- **The replayer** (`replay.js`): starts a fresh copy of the rules with the same seed, plays the log back step by step at `STEP = 1/120`, and stops at game over.
- **The fingerprint**: an FNV hash of the gameplay state (state, score, lives, level, pin, formation, shot, bolts, Dream Home, timers, hurdles alive and every shield cell), taken every 10 simulated seconds and at the end.
- **Runs**:
  - `node-run.mjs`: plays the bot in Node, then replays each log in Node without particles (timed) and with them.
  - `browser-run.mjs`: replays the same logs in Chromium, Firefox and WebKit through Playwright, then compares every fingerprint with Node's.
  - `sizes.mjs`: the hypot comparison and the log sizes. A bot that decides only every 6 or 12 steps (50 or 100 ms) stands in for human pace.
- **Machine**: Apple M4 Pro; Node 22.20.0; Playwright 1.62.1 with Chromium 151.0.7922.34, Firefox 153.0 and WebKit 26.5.

## Results

### 1. Determinism: identical in Node and in all three engines

7 bot games: seeds 1–5 with 3 homes, and seeds 11–12 with 30 homes for longer games. All 7 replayed **identically, fingerprint for fingerprint**, in Node, Chromium, Firefox and WebKit, to the same score, the same level and the same game-over step.

| Seed | Homes | Steps | Game time | Level reached | Deposit | Node = Chromium = Firefox = WebKit |
|---|---|---|---|---|---|---|
| 1 | 3 | 91,263 | 12.7 min | 4 | £47,800 | yes |
| 2 | 3 | 71,393 | 9.9 min | 3 | £36,100 | yes |
| 3 | 3 | 26,197 | 3.6 min | 1 | £12,800 | yes |
| 4 | 3 | 99,262 | 13.8 min | 5 | £56,500 | yes |
| 5 | 3 | 31,139 | 4.3 min | 1 | £20,200 | yes |
| 11 | 30 | 101,066 | 14.0 min | 5 | £51,950 | yes |
| 12 | 30 | 120,005 | 16.7 min | 6 | £62,800 | yes |

**Squared distances in place of `Math.hypot`**: seeds 1, 2 and 4 played the same game, fingerprint for fingerprint, with either. The change takes away an engine-dependent function and leaves gameplay as it is.

### 2. Replay cost: about 1,500 steps a millisecond

| Engine | Time to replay the games above (no particles) | Rate |
|---|---|---|
| Node 22 | 30–68 ms (60–68 ms for 12–17 min) | 840–1,770 steps/ms |
| Chromium | 17–51 ms | |
| WebKit | 19–62 ms | |
| Firefox | 36–144 ms | |

- The RCA's 72,000 steps (10 minutes) take about **50 ms** in Node.
- A 60-minute game (432,000 steps) extrapolates to about **0.3 s** in Node, on this machine. Netlify's function CPU is slower and unmeasured: that is K22, on a preview.
- The particles add 3–8 % in Node. Skipping them on the server is a matter of correctness (their draws must not touch the gameplay sequence), not of cost.

### 3. The log: larger than "a few KB", and compressible

| Bot pace | Key changes per second | Naive JSON `[[step, bits], …]` | Compact text (step delta in base 36 + one letter for the bits) | gzip of the compact text |
|---|---|---|---|---|
| Every step (frantic, a program) | 26–33 | about 19 KB a minute | **3.2–4.0 KB a minute** | about 0.35 KB a minute |
| Every 50 ms | 12–13 | about 7.7 KB a minute | **1.5–1.6 KB a minute** | about 0.2 KB a minute |
| Every 100 ms (about a fast human) | 6.5–7 | about 3.8 KB a minute | **0.8–0.9 KB a minute** | about 0.17 KB a minute |

- At human pace, a 60-minute game is about **50–100 KB** of compact text. A program that changes keys every step needs about 4 KB a minute, so 240 KB for an hour.
- The body cap of 1 KB (DDD-5) can't carry any of this. DESIGN sets the new cap and the encoding.

### 4. Choosing the seed (added after the first review cycle)

`seeds.mjs` plays the same greedy bot on 100 seeds (1000–1099, 3 homes):

| | Deposit |
|---|---|
| Lowest | £8,150 |
| 25th percentile | £32,650 |
| Median | £46,100 |
| 75th percentile | £55,100 |
| 90th percentile | £64,300 |
| Highest | £75,100 (seed 1048, 16.3 minutes, level 7) |
| Longest game | 17.2 minutes (seed 1099, £72,150, level 7) |
| Best of 10 seeds, averaged over 10 groups | £67,300 (+46 % over the median) |

- Per minute of game time: £2,800 to £4,700, median £3,900. Most of the spread is in how long the bot survives, not in how fast it scores.
- So a program that tries many seeds and keeps the best gains about half again over a typical seed. A seed chosen by the server would cap the choice at the seeds the rate limit hands out, about 10 a minute, which already reaches best-of-10.
- At £2,800–£4,700 a minute, a 60-minute game would be worth £170,000–£280,000, so the £250,000 ceiling could refuse a long honest game.

## What the probe does not show

- **Real human logs.** The paces above are bots. A human holds keys longer, so the 100 ms bot is a fair upper bound, but not a measurement. DISTILL's browser scenarios produce real key timings, from synthetic key events.
- **Netlify's CPU.** Node on an M4 Pro is not a function instance. K22 measures a 60-minute record on a deploy preview.
- **The real code.** The probe patched a copy. DELIVER's seeded rules and the recorded-games corpus (K21) make the same comparison on the code that ships.
- **Engines other than these versions**, older Safari for example. The patch uses only `+ - * /`, comparisons, `Math.floor/ceil/round/abs/min/max/sign`, `Math.imul` and bit operations, all of which ECMAScript defines exactly. That is the argument for other engines. The probe is the evidence for these three.

## Reproduce

```bash
cp -R src/game src/theme <probe-dir>/src/ && python3 -I patch_probe.py <probe-dir>/src/game
node node-run.mjs 3 1 2 3 4 5 && node node-run.mjs 30 11 12
node browser-run.mjs <repo>/package.json games-3.json games-30.json
node sizes.mjs
node seeds.mjs 100
```
