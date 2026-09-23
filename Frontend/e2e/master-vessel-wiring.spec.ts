import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';
import {
  futureEtaLocal,
  createPlanOnly,
  planModal,
  fillPlanHeader,
} from './helpers/shipment-plan';
import { API_ORIGIN } from './load-env.js';

/** Master vessels with complete dimensions in local DB (see migration 117+ sync). */
const MASTER_A = '10'; // Ocean Trader
const MASTER_B = '354'; // MT JPS TEST I

test.describe('Master vessel wiring — shipment plans', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('A — Create new linked plan from master vessel dropdown', async ({ page }) => {
    const eta = futureEtaLocal(14);
    await page.goto('/shipment-plans');
    await page.getByRole('button', { name: /new shipment plan/i }).click();
    const modal = planModal(page);
    await expect(modal).toBeVisible({ timeout: 20_000 });

    const vesselField = modal.locator('#sp-vessel');
    await expect(vesselField).toHaveJSProperty('tagName', 'SELECT');

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/shipment-plans') && r.request().method() === 'POST' && r.status() === 201,
        { timeout: 60_000 }
      ),
      (async () => {
        await fillPlanHeader(page, { masterVesselId: MASTER_A, eta });
        await modal.locator('button[type="submit"]').click();
      })(),
    ]);

    const created = await response.json();
    expect(created.masterVesselId).toBe(Number(MASTER_A));
    expect(created.vesselLinkStatus).toBe('linked');
    expect(created.vesselName).toMatch(/ocean trader/i);
    expect(created.vesselLoaM).toBeGreaterThan(0);
    expect(created.vesselGrossTonnage).toBeGreaterThan(0);
    expect(created.vesselDraft).toBeGreaterThan(0);

    await expect(modal).toBeHidden({ timeout: 15_000 });
    await page.goto('/shipment-plans');
    const createdRow = page.locator('table tbody tr').filter({ hasText: created.planReference || `Plan #${created.id}` });
    await expect(createdRow).toBeVisible({ timeout: 20_000 });
    await expect(createdRow.getByText('Legacy', { exact: true })).toHaveCount(0);
  });

  test('B — Legacy plan edit keeps free-text vessel fields', async ({ page }) => {
    await page.goto('/shipment-plans');
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30_000 });

    const legacyRow = page.locator('table tbody tr').filter({ has: page.getByText('Legacy', { exact: true }) }).first();
    await expect(legacyRow).toBeVisible({ timeout: 30_000 });

    const editBtn = legacyRow.getByRole('button', { name: /edit/i }).first();
    const disabled = await editBtn.isDisabled();
    if (disabled) {
      test.skip(true, 'No editable legacy Draft/Rejected plan in list — seed or pick another row');
    }

    await editBtn.click();
    const modal = planModal(page);
    await expect(modal).toBeVisible({ timeout: 20_000 });

    const vesselField = modal.locator('#sp-vessel');
    await expect(vesselField).toHaveJSProperty('tagName', 'INPUT');

    const loa = modal.locator('#sp-vessel-loa');
    await expect(loa).toBeEditable();
    const prevName = await vesselField.inputValue();
    const newName = `${prevName.replace(/\s+$/, '')} E2E`.slice(0, 80);
    await vesselField.fill(newName);

    const [patchResp] = await Promise.all([
      page.waitForResponse(
        (r) => /\/shipment-plans\/\d+$/.test(r.url()) && r.request().method() === 'PATCH' && r.status() === 200,
        { timeout: 60_000 }
      ),
      modal.locator('button[type="submit"]').click(),
    ]);
    const updated = await patchResp.json();
    expect(updated.masterVesselId).toBeNull();
    expect(updated.vesselLinkStatus).toBe('legacy');
    expect(updated.vesselName).toBe(newName);
    await expect(modal).toBeHidden({ timeout: 20_000 });
  });

  test('C — Linked plan re-pick master vessel updates snapshot', async ({ page }) => {
    const eta = futureEtaLocal(16);
    const created = await createPlanOnly(page, { masterVesselId: MASTER_A, eta });
    expect(created.masterVesselId).toBe(Number(MASTER_A));

    await page.goto('/shipment-plans');
    const row = page.locator('table tbody tr').filter({ hasText: created.planReference || `Plan #${created.id}` });
    await expect(row).toBeVisible({ timeout: 20_000 });
    const editBtn = row.getByRole('button', { name: /edit/i }).first();
    await expect(editBtn).toBeEnabled();
    await editBtn.click();

    const modal = planModal(page);
    await expect(modal.locator('#sp-vessel')).toHaveJSProperty('tagName', 'SELECT');
    await modal.locator('#sp-vessel').selectOption(MASTER_B);
    await expect(modal.locator('#sp-vessel-loa')).toHaveValue('150');

    const [patchResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/shipment-plans/${created.id}`) && r.request().method() === 'PATCH' && r.status() === 200,
        { timeout: 60_000 }
      ),
      modal.locator('button[type="submit"]').click(),
    ]);
    const updated = await patchResp.json();
    expect(updated.masterVesselId).toBe(Number(MASTER_B));
    expect(updated.vesselName).toMatch(/jps test i/i);
    await expect(modal).toBeHidden({ timeout: 20_000 });
  });

  test('D — Dashboard and list pages load without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    for (const path of ['/', '/management-dashboard', '/ops-analytics', '/shipment-plans']) {
      await page.goto(path);
      await expect(page.locator('body')).toBeVisible({ timeout: 30_000 });
    }

    await page.goto('/shipment-plans');
    await expect(page.locator('table').first()).toBeVisible({ timeout: 30_000 });
    expect(errors).toEqual([]);
  });

  test('E — API rejects create without master_vessel_id', async ({ page }) => {
    await page.goto('/shipment-plans');
    const cookies = await page.context().cookies();
    const xsrf = cookies.find((c) => c.name === 'jps_xsrf')?.value;

    const res = await page.request.post(`${API_ORIGIN}/api/shipment-plans`, {
      headers: {
        'Content-Type': 'application/json',
        ...(xsrf ? { 'X-XSRF-TOKEN': xsrf } : {}),
      },
      data: {
        vessel_name: 'SHOULD FAIL',
        vessel_loa_m: 120,
        vessel_gross_tonnage: 3500,
        vessel_draft: 6.5,
        eta: futureEtaLocal(20),
        purpose_id: 1,
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(String(body.error || '')).toMatch(/master_vessel_id/i);
  });
});
