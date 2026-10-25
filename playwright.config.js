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

// PORT moves the test server (scripts/serve.mjs reads it too), so two checkouts can run their suites side by side.
const baseURL = `http://localhost:${Number(process.env.PORT) || 4173}`;

export default defineConfig({
  testDir,
  reporter: 'list',
  use: { baseURL },
  webServer: { command: 'npm start', url: baseURL, reuseExistingServer: !process.env.CI },
  projects: [
    // Unit properties (fast-check) on pure modules: no browser, no @pending/@in-memory filtering.
    { name: 'unit', testDir: 'tests/unit' },
    { name: 'in-memory', grep: NO_BROWSER, grepInvert: pending },
    { name: 'chromium', ...browser('Desktop Chrome') },
    { name: 'firefox', ...browser('Desktop Firefox') },
    { name: 'webkit', ...browser('Desktop Safari') },
  ],
});
