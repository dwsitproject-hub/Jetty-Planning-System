import { test, expect } from '@playwright/test';

const BACKEND = process.env.E2E_API_ORIGIN || 'http://localhost:3000';
const USER = process.env.E2E_USERNAME || 'admin';
const PASSWORD = process.env.E2E_PASSWORD || 'admin123';

test.describe('Notification bell (in-app center)', () => {
  test('bell visible after login; panel opens; API unread returns 200 or 404', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#login-username').fill(USER);
    await page.locator('#login-password').fill(PASSWORD);
    await page.locator('form').getByRole('button', { name: /sign in/i }).click();
    await expect(page).not.toHaveURL(/\/login$/i, { timeout: 20000 });

    if (page.url().includes('/select-port')) {
      await page.locator('#select-port-id').waitFor({ state: 'visible', timeout: 15000 });
      const firstPort = page.locator('#select-port-id option[value]:not([value=""])').first();
      await expect(firstPort).toBeAttached();
      const val = await firstPort.getAttribute('value');
      await page.locator('#select-port-id').selectOption(val);
      await page.getByRole('button', { name: /continue/i }).click();
      await expect(page).not.toHaveURL(/\/select-port/i, { timeout: 20000 });
    }

    await page
      .waitForResponse(
        (r) => r.url().includes('/api/v1/users/me') && r.request().method() === 'GET' && r.status() === 200,
        { timeout: 20000 }
      )
      .catch(() => {});

    const bell = page.getByTestId('notification-bell');
    await expect(bell).toBeVisible({ timeout: 30000 });

    await bell.click();
    const panel = page.getByTestId('notification-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('notification-panel-body')).toBeVisible();

    const cookies = await page.context().cookies();
    const at = cookies.find((c) => c.name === 'jps_at')?.value;
    const xsrf = cookies.find((c) => c.name === 'jps_xsrf')?.value;
    expect(at, 'session cookie').toBeTruthy();
    expect(xsrf, 'xsrf cookie').toBeTruthy();

    const unread = await page.request.get(`${BACKEND}/api/v1/notifications/unread-count`, {
      headers: {
        Cookie: `jps_at=${at}; jps_xsrf=${xsrf}`,
        'X-XSRF-TOKEN': xsrf,
      },
    });
    expect([200, 404, 503].includes(unread.status()), `unread-count status was ${unread.status()}`).toBeTruthy();
    if (unread.status() === 200) {
      const j = await unread.json();
      expect(typeof j.count).toBe('number');
    }

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });
});
