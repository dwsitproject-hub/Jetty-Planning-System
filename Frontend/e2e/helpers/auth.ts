import { expect, type Page } from '@playwright/test';
import { E2E_USER, E2E_PASSWORD } from '../load-env.js';

/** Pick the first available port when the session requires it. */
export async function selectPortIfNeeded(page: Page) {
  if (!page.url().includes('/select-port')) return;
  await page.locator('#select-port-id').waitFor({ state: 'visible', timeout: 15_000 });
  const firstPort = page.locator('#select-port-id option[value]:not([value=""])').first();
  await expect(firstPort).toBeAttached();
  const val = await firstPort.getAttribute('value');
  await page.locator('#select-port-id').selectOption(val!);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page).not.toHaveURL(/\/select-port/i, { timeout: 20_000 });
}

/** Sign in via the login form and wait until the app shell loads. */
export async function login(page: Page, username = E2E_USER, password = E2E_PASSWORD) {
  await page.goto('/login');
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill(password);
  await page.locator('form').getByRole('button', { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login$/i, { timeout: 30_000 });
  await selectPortIfNeeded(page);
}
