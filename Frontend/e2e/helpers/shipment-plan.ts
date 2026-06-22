import { expect, type Locator, type Page } from '@playwright/test';

/** Diagram spec string (target copy). */
export const LATE_SI_BERTHING_TOOLTIP_SPEC =
  'Please make sure SI is submitted and approved.';

/** Current app implementation (berthingEligibility.js — no SI on plan). */
export const LATE_SI_BERTHING_TOOLTIP =
  'Add at least one shipping instruction and approve the shipment plan before berthing.';

export function uniqueVessel(prefix: string) {
  return `${prefix}-${Date.now()}`;
}

export function futureEtaLocal(daysAhead = 7) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Shipment plan create/edit modal — stable class hook. */
export function planModal(page: Page): Locator {
  return page.locator('.modal--shipment-plan-form');
}

/** Open the combined create-plan modal on /shipment-plans. */
export async function openCreatePlanModal(page: Page) {
  await page.goto('/shipment-plans');
  await page.getByRole('button', { name: /new shipment plan/i }).click();
  const modal = planModal(page);
  await expect(modal).toBeVisible({ timeout: 20_000 });
  await expect(modal.locator('#sp-vessel')).toBeVisible();
}

/** Fill shared plan header fields (purpose, vessel, ETA). */
export async function fillPlanHeader(page: Page, opts: { vessel: string; eta: string; purposeLabel?: string }) {
  const modal = planModal(page);
  const purposeSelect = modal.locator('#sp-purpose');
  await expect(purposeSelect).toBeEnabled({ timeout: 20_000 });
  // Wait until lookup options are hydrated (more than the blank "—" option).
  await expect(async () => {
    expect(await purposeSelect.locator('option').count()).toBeGreaterThan(1);
  }).toPass({ timeout: 20_000 });

  if (opts.purposeLabel) {
    await purposeSelect.selectOption({ label: opts.purposeLabel });
  } else {
    // First real purpose after the blank option.
    await purposeSelect.selectOption({ index: 1 });
  }
  await expect(purposeSelect).not.toHaveValue('');

  await modal.locator('#sp-vessel').fill(opts.vessel);
  await modal.locator('#sp-eta').fill(opts.eta);
}

/** Add one SI draft card and fill minimum required fields. */
export async function addSiDraftToOpenModal(page: Page, siRef: string) {
  const modal = planModal(page);
  const addSiBtn = modal.locator('button').filter({ hasText: /Add another shipping instruction/i });
  await expect(addSiBtn).toBeEnabled({ timeout: 20_000 });
  await addSiBtn.click();

  await expect(modal.locator('#sp-si-0-siRef')).toBeVisible({ timeout: 15_000 });
  await modal.locator('#sp-si-0-siRef').fill(siRef);

  const row = modal.locator('tbody tr').first();
  const commoditySelect = row.locator('select').nth(1);
  await expect(commoditySelect).toBeEnabled();
  await commoditySelect.selectOption({ index: 1 });
  await row.locator('input[type="number"]').fill('1000');
  const metricSelect = row.locator('select').nth(2);
  await expect(metricSelect).toBeEnabled();
  await metricSelect.selectOption({ index: 1 });
}

/** Save plan without any SI draft cards (late-SI path step 1). */
export async function createPlanOnly(page: Page, opts: { vessel: string; eta: string }) {
  await openCreatePlanModal(page);
  await fillPlanHeader(page, opts);
  const modal = planModal(page);
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/shipment-plans') && r.request().method() === 'POST' && r.status() === 201,
      { timeout: 60_000 }
    ),
    modal.locator('button[type="submit"]').click(),
  ]);
  const created = await response.json();
  await expect(modal).toBeHidden({ timeout: 15_000 });
  return created as { id: number; planReference?: string };
}

/** Create plan + one SI in the combined modal (normal flow step 1). */
export async function createPlanWithSi(page: Page, opts: { vessel: string; eta: string; siRef: string }) {
  await openCreatePlanModal(page);
  await fillPlanHeader(page, opts);
  await addSiDraftToOpenModal(page, opts.siRef);
  const modal = planModal(page);
  const planResponse = page.waitForResponse(
    (r) => r.url().includes('/shipment-plans') && r.request().method() === 'POST' && r.status() === 201,
    { timeout: 60_000 }
  );
  await modal.locator('button[type="submit"]').click();
  const response = await planResponse;
  // Plan + SI saves may take multiple API round-trips before the modal closes.
  await expect(modal).toBeHidden({ timeout: 90_000 });
  return (await response.json()) as { id: number; planReference?: string };
}

/** Open plan hub, submit for approval, and approve on the approval page. */
export async function submitAndApprovePlan(page: Page, planId: number) {
  await page.goto(`/shipment-plans/${planId}`);
  await page.getByRole('button', { name: /submit for approval/i }).click();
  await expect(page.getByText(/submitted/i).first()).toBeVisible({ timeout: 20_000 });

  await page.goto(`/shipment-plans/approval/${planId}`);
  await page.locator('#sp-approval-certify').check();
  await page.locator('#sp-approval-reason').fill('E2E automated approval');
  await page.getByRole('button', { name: /approve plan/i }).click();
  await expect(page.getByText(/approved/i).first()).toBeVisible({ timeout: 20_000 });
}

/** Late SI step 3: add SI to an existing draft plan via deep link, then submit + approve. */
export async function addSiApproveLatePlan(page: Page, planId: number, siRef: string) {
  await page.goto(`/shipment-plans?shipment_plan_id=${planId}`);
  const modal = planModal(page);
  await expect(modal).toBeVisible({ timeout: 20_000 });
  await addSiDraftToOpenModal(page, siRef);
  await modal.locator('button[type="submit"]').click();
  await expect(modal).toBeHidden({ timeout: 30_000 });
  await submitAndApprovePlan(page, planId);
}
