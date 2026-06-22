import { test, expect } from '@playwright/test';

const USER = process.env.E2E_USERNAME || 'admin';
const PASSWORD = process.env.E2E_PASSWORD || 'admin123';

async function signIn(page) {
  await page.goto('/login');
  await page.locator('#login-username').fill(USER);
  await page.locator('#login-password').fill(PASSWORD);
  await page.locator('form').getByRole('button', { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login$/i, { timeout: 20000 });
}

test.describe('P1 — SAILED pipeline + cast-off validation', () => {
  test('API: depart rejects future cast_off_at', async ({ page }) => {
    await signIn(page);
    const ready = await page.request.get('/api/v1/operations?status=SIGNOFF_APPROVED');
    expect(ready.status()).toBe(200);
    const ops = await ready.json();
    if (!Array.isArray(ops) || ops.length === 0) {
      test.skip(true, 'No SIGNOFF_APPROVED operations in local DB');
    }
    const opId = ops[0].id;
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const depart = await page.request.post(`/api/v1/operations/${opId}/depart`, {
      data: { cast_off_at: future },
    });
    expect(depart.status()).toBe(400);
    const body = await depart.json();
    expect(body.error).toMatch(/future/i);
  });

  test('Clearance UI: future CAST Off shows validation error', async ({ page }) => {
    await signIn(page);
    await page.goto('/verification');
    await expect(page.getByRole('heading', { level: 1, name: 'Clearance' })).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: /ready to sail/i }).click();

    const viewBtn = page.getByRole('button', { name: /view/i }).first();
    if (!(await viewBtn.isVisible().catch(() => false))) {
      test.skip(true, 'No Ready to Sail operation in local DB');
    }
    await viewBtn.click();

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });
    const castInput = page.locator('#clearance-cast-off');
    await expect(castInput).toBeVisible();

    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    const futureLocal = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`;
    await castInput.fill(futureLocal);

    await page.getByRole('button', { name: /record depart/i }).click();
    await expect(page.getByText(/cannot be in the future/i)).toBeVisible({ timeout: 5000 });
  });

  test('Clearance UI: Sailed filter opens read-only modal', async ({ page }) => {
    await signIn(page);
    await page.goto('/verification');
    await page.getByRole('button', { name: /sailed \(\d+\)/i }).click();

    const viewBtn = page.locator('table tbody tr').first().getByRole('button', { name: /^view$/i });
    if (!(await viewBtn.isVisible().catch(() => false))) {
      test.skip(true, 'No SAILED operations in local DB');
    }
    await viewBtn.click();

    await expect(page.locator('.modal').filter({ hasText: /\(Sailed\)/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/already sailed|read-only/i)).toBeVisible();
    await expect(page.locator('#clearance-cast-off')).toBeDisabled();
  });

  test('Allocation UI: SAILED vessel modal shows Current: Sailed', async ({ page }) => {
    await signIn(page);
    await page.goto('/allocation-plans');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });

    const schematicTab = page.getByRole('tab', { name: /schematic|jetty layout/i }).first();
    if (await schematicTab.isVisible()) await schematicTab.click();

    const dateInput = page.locator('input[type="date"]').first();
    if (await dateInput.isVisible()) {
      await dateInput.fill('2026-05-10');
    }

    const vesselSlot = page.locator('.jetty-schematic__slot--load, .jetty-schematic__slot--disch').first();
    if (!(await vesselSlot.isVisible().catch(() => false))) {
      test.skip(true, 'No occupied schematic slot on seed date');
    }
    await vesselSlot.click();

    const dialog = page.locator('.modal');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog.getByText(/current:\s*sailed/i)).toBeVisible();
    await expect(dialog.getByText(/current:\s*at-berth/i)).toHaveCount(0);
  });
});
