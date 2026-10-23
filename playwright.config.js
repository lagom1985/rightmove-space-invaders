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

export default defineConfig({
  testDir,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4173' },
  webServer: { command: 'npm start', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'in-memory', grep: /@in-memory/, grepInvert: pending },
    { name: 'chromium', ...browser('Desktop Chrome') },
    { name: 'firefox', ...browser('Desktop Firefox') },
    { name: 'webkit', ...browser('Desktop Safari') },
  ],
});
