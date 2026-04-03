import { test, expect } from '@playwright/test';

const BACKEND = process.env.E2E_API_ORIGIN || 'http://localhost:3000';
const USER = process.env.E2E_USERNAME || 'admin';
const PASSWORD = process.env.E2E_PASSWORD || 'admin123';

test.describe('session cookie + CSRF (local dev)', () => {
  test('login via UI, API sees cookies; logout POST sends CSRF', async ({ page }) => {
    await page.goto('/login');

    await page.locator('#login-username').fill(USER);
    await page.locator('#login-password').fill(PASSWORD);
    await page.locator('form').getByRole('button', { name: /sign in/i }).click();

    await expect(page).not.toHaveURL(/\/login$/i, { timeout: 20000 });

    const cookies = await page.context().cookies();
    const apiHost = new URL(BACKEND).hostname;
    const hasAt = cookies.some((c) => c.name === 'jps_at' && c.httpOnly);
    const hasXsrf = cookies.some((c) => c.name === 'jps_xsrf' && !c.httpOnly);
    expect(hasAt, 'HttpOnly jps_at should be set after login').toBeTruthy();
    expect(hasXsrf, 'readable jps_xsrf for double-submit').toBeTruthy();

    const me = await page.request.get(`${BACKEND}/api/v1/users/me`);
    expect(me.status(), '/users/me should work with cookie session').toBe(200);

    const xsrf = cookies.find((c) => c.name === 'jps_xsrf')?.value;
    expect(xsrf).toBeTruthy();

    const logout = await page.request.post(`${BACKEND}/api/v1/auth/logout`, {
      headers: {
        'X-XSRF-TOKEN': xsrf,
        'Content-Type': 'application/json',
      },
      data: {},
    });
    expect(logout.status(), 'logout POST should accept CSRF + cookies').toBe(204);

    const meAfter = await page.request.get(`${BACKEND}/api/v1/users/me`);
    expect(meAfter.status(), 'after logout /users/me should be unauthenticated').toBe(401);
  });
});
