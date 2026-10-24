import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const testDir = defineBddConfig({
  features: 'tests/e2e/*/acceptance/*.feature',
  steps: 'tests/e2e/*/acceptance/steps/*.js',
});

// Scenarios tagged @pending are written ahead of the code (DISTILL) and skipped until DELIVER
// enables them one at a time. RUN_PENDING=1 runs them anyway, to check they fail for the right reason.
const pending = process.env.RUN_PENDING ? [] : [/@pending/];

// Desktop browsers only: the game needs a physical keyboard. @in-memory scenarios need no browser.
const browser = device => ({ use: { ...devices[device] }, grepInvert: [/@in-memory/, ...pending] });

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
    { name: 'in-memory', grep: /@in-memory/, grepInvert: pending },
    { name: 'chromium', ...browser('Desktop Chrome') },
    { name: 'firefox', ...browser('Desktop Firefox') },
    { name: 'webkit', ...browser('Desktop Safari') },
  ],
});
