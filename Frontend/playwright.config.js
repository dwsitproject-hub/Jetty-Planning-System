// @ts-check
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, loadE2eEnv } from './e2e/load-env.js';

loadE2eEnv();

/**
 * E2E checks (login, HttpOnly cookie session, CSRF on POST).
 * Requires: Frontend `npm run dev` on 5173, Backend on 3000, DB up.
 *
 * Credentials: Frontend/.env.e2e or E2E_USERNAME / E2E_PASSWORD
 * (default admin / admin123 after `npm run seed:admin` in Backend).
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.js',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    video: 'on',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
