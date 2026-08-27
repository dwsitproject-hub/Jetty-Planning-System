import { test, expect } from '@playwright/test';
import { API_ORIGIN, E2E_USER, E2E_PASSWORD } from './load-env.js';

test.describe('session cookie + CSRF (local dev)', () => {
  test('login via UI, API sees cookies; logout POST sends CSRF', async ({ page }) => {
    await page.goto('/login');

    await page.locator('#login-username').fill(E2E_USER);
    await page.locator('#login-password').fill(E2E_PASSWORD);
    await page.locator('form').getByRole('button', { name: /sign in/i }).click();

    await expect(page).not.toHaveURL(/\/login$/i, { timeout: 20000 });

    const cookies = await page.context().cookies();
    const hasAt = cookies.some((c) => c.name === 'jps_at' && c.httpOnly);
    const hasXsrf = cookies.some((c) => c.name === 'jps_xsrf' && !c.httpOnly);
    expect(hasAt, 'HttpOnly jps_at should be set after login').toBeTruthy();
    expect(hasXsrf, 'readable jps_xsrf for double-submit').toBeTruthy();

    const me = await page.request.get(`${API_ORIGIN}/api/v1/users/me`);
    expect(me.status(), '/users/me should work with cookie session').toBe(200);

    const xsrf = cookies.find((c) => c.name === 'jps_xsrf')?.value;
    expect(xsrf).toBeTruthy();

    const logout = await page.request.post(`${API_ORIGIN}/api/v1/auth/logout`, {
      headers: {
        'X-XSRF-TOKEN': xsrf,
        'Content-Type': 'application/json',
      },
      data: {},
    });
    expect(logout.status(), 'logout POST should accept CSRF + cookies').toBe(204);

    const meAfter = await page.request.get(`${API_ORIGIN}/api/v1/users/me`);
    expect(meAfter.status(), 'after logout /users/me should be unauthenticated').toBe(401);
  });
});
