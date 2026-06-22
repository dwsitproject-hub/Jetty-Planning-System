import { expect, type Page } from '@playwright/test';

const USER = process.env.E2E_USERNAME || 'admin';
const PASSWORD = process.env.E2E_PASSWORD || 'admin1234';

/** Sign in via the login form and wait until the app shell loads. */
export async function login(page: Page, username = USER, password = PASSWORD) {
  await page.goto('/login');
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill(password);
  await page.locator('form').getByRole('button', { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login$/i, { timeout: 30_000 });
}
