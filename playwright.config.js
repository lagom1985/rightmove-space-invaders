import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const testDir = defineBddConfig({
  features: 'tests/e2e/*/acceptance/*.feature',
  steps: 'tests/e2e/*/acceptance/steps/*.js',
});

// Desktop browsers only: the game needs a physical keyboard.
export default defineConfig({
  testDir,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4173' },
  webServer: { command: 'npm start', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
