// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E checks (login, HttpOnly cookie session, CSRF on POST).
 * Requires: Frontend `npm run dev` on 5173, Backend on 3000, DB up.
 *
 * Credentials: E2E_USERNAME / E2E_PASSWORD or defaults admin / admin123 (after seed:admin).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 120_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    video: 'on',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
