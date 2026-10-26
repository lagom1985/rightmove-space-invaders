import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const testDir = defineBddConfig({
  features: 'tests/e2e/*/acceptance/*.feature',
  steps: 'tests/e2e/*/acceptance/steps/*.js',
});

// Scenarios tagged @pending are written ahead of the code (DISTILL) and skipped until DELIVER
// enables them one at a time. RUN_PENDING=1 runs them anyway, to check they fail for the right reason.
const pending = process.env.RUN_PENDING ? [] : [/@pending/];

// Desktop browsers only: the game needs a physical keyboard. Two kinds of scenario need no browser, and run once in the
// in-memory project, which is part of the Netlify build gate (npm run build):
// - @in-memory: layer-2 acceptance on in-memory doubles (the sound director, the high-score rules on their own);
// - @server: the high-score table service called from Node, over the real Blobs client on a real Blobs emulator.
const NO_BROWSER = [/@in-memory/, /@server/];
const browser = device => ({ use: { ...devices[device] }, grepInvert: [...NO_BROWSER, ...pending] });

// A browser scenario plays whole games on the fake clock, and Firefox and WebKit play them slower than Chromium: alone,
// the slowest typed-initials scenarios take up to about 36 s in Chromium, 44 s in Firefox and 56 s in WebKit, and a full
// run on a busy machine slows them further (WebKit's took up to 66 s, and two ran into the 90 s limit). The scenarios on
// a high-score table get three times their project's timeout (fixtures.js): 90 s in Chromium as before, 135 s in Firefox
// and 180 s in WebKit, about three times the slowest each takes alone.
const SLOWER_BROWSER_TIMEOUTS = { firefox: 45_000, webkit: 60_000 };

// PORT moves the test server (scripts/serve.mjs reads it too), so two checkouts can run their suites side by side.
const baseURL = `http://localhost:${Number(process.env.PORT) || 4173}`;

export default defineConfig({
  testDir,
  reporter: 'list',
  use: { baseURL },
  // SIGTERM, not Playwright's default SIGKILL, so the server can delete its emulator directory on the way out (DDD-16).
  webServer: { command: 'npm start', url: baseURL, reuseExistingServer: !process.env.CI, gracefulShutdown: { signal: 'SIGTERM', timeout: 2000 } },
  projects: [
    // Unit properties (fast-check) on pure modules: no browser, no @pending/@in-memory filtering.
    { name: 'unit', testDir: 'tests/unit' },
    { name: 'in-memory', grep: NO_BROWSER, grepInvert: pending },
    { name: 'chromium', ...browser('Desktop Chrome') },
    { name: 'firefox', ...browser('Desktop Firefox'), timeout: SLOWER_BROWSER_TIMEOUTS.firefox },
    { name: 'webkit', ...browser('Desktop Safari'), timeout: SLOWER_BROWSER_TIMEOUTS.webkit },
  ],
});
