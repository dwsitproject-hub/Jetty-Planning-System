import { expect, type Locator, type Page } from '@playwright/test';
import { LATE_SI_BERTHING_TOOLTIP } from './shipment-plan';

/** Navigate to plan-centric Allocation & Berthing queue. */
export async function gotoAllocationPlans(page: Page) {
  await page.goto('/allocation-plans');
  await expect(page.getByRole('heading', { name: /incoming vessel.*berthing/i })).toBeVisible({ timeout: 30_000 });
}

/** Log arrival update modal. */
export function arrivalModal(page: Page): Locator {
  return page.locator('[aria-labelledby="arrival-update-modal-title"]');
}

/** Locate the queue table row for a vessel name. */
export function queueRowForVessel(page: Page, vesselName: string): Locator {
  return page
    .locator('.allocation-table tbody tr, table tbody tr')
    .filter({ has: page.locator('strong').getByText(vesselName, { exact: true }) })
    .first();
}

export function berthingButtonInRow(row: Locator): Locator {
  // Accessible name includes gate tooltip when disabled; match visible label instead.
  return row.locator('button').filter({ hasText: /^Berthing$/ });
}

export function logArrivalButtonInRow(row: Locator): Locator {
  return row.getByRole('button', { name: /log arrival update/i });
}

/** Assign jetty through Log arrival update (late-SI step 2 / normal step 2). */
/** Pick first vacant jetty in Log arrival update modal. */
async function selectVacantArrivalJetty(modal: Locator, preferred?: string) {
  const select = modal.locator('#arrival-jetty');
  if (preferred) {
    const count = await select.locator('option', { hasText: preferred }).count();
    if (count > 0) {
      await select.selectOption(preferred);
      return preferred;
    }
  }
  const options = await select.locator('option').all();
  for (const opt of options) {
    const value = (await opt.getAttribute('value'))?.trim();
    if (value) {
      await select.selectOption(value);
      return value;
    }
  }
  throw new Error('No jetty option in Log arrival update.');
}

export async function assignJettyViaLogArrival(page: Page, vesselName: string, jettyId?: string) {
  await gotoAllocationPlans(page);
  const row = queueRowForVessel(page, vesselName);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await logArrivalButtonInRow(row).click();
  await expect(page.locator('#arrival-update-modal-title')).toBeVisible({ timeout: 15_000 });

  const modal = arrivalModal(page);
  await expect(modal).toBeVisible();
  await expect(modal.locator('#arrival-jetty')).toBeVisible();
  await selectVacantArrivalJetty(modal, jettyId);
  await modal.locator('.modal__footer button.btn--primary').click();
  await expect(modal).toBeHidden({ timeout: 30_000 });
}

/** Hover disabled Berthing CTA and assert the gate tooltip (title attribute). */
export async function assertBerthingDisabledWithTooltip(row: Locator, expected = LATE_SI_BERTHING_TOOLTIP) {
  const btn = berthingButtonInRow(row);
  await expect(btn).toBeDisabled();
  await btn.hover();
  await expect(btn).toHaveAttribute('title', expected);
}

/** Assert Berthing CTA is enabled (late-SI unlocked / normal flow). */
export async function assertBerthingEnabled(row: Locator) {
  const btn = berthingButtonInRow(row);
  await expect(btn).toBeEnabled();
}

/** Try jetty options until Confirm Berthing saves (skips OOS jetty 5). */
async function confirmBerthingWithJettyRetry(berthingModal: Locator, preferred?: string) {
  const select = berthingModal.locator('#berthing-jetty');
  let values = await select.evaluate((sel) =>
    Array.from((sel as HTMLSelectElement).options)
      .map((o) => o.value)
      .filter((v) => v && v !== '5')
  );
  if (preferred) {
    values = [preferred, ...values.filter((v) => v !== preferred)];
  }
  const errors = berthingModal.locator('#berthing-errors li');
  for (const jettyId of values) {
    await select.selectOption(jettyId);
    await berthingModal.locator('.modal__footer button.btn--primary').click();
    try {
      await expect(berthingModal).toBeHidden({ timeout: 12_000 });
      return jettyId;
    } catch {
      if ((await errors.count()) === 0) continue;
    }
  }
  const msgs = await errors.allTextContents();
  throw new Error(msgs.length ? `Confirm Berthing blocked: ${msgs.join('; ')}` : 'Confirm Berthing did not close on any jetty.');
}

/** Open berthing modal and complete TA / TB / ETC plus required photo + remarks. */
export async function completeBerthing(page: Page, vesselName: string, preferredJetty?: string) {
  await gotoAllocationPlans(page);
  const row = queueRowForVessel(page, vesselName);
  await berthingButtonInRow(row).click();
  const berthingModal = page.locator('[aria-labelledby="berthing-confirm-title"]');
  await expect(page.locator('#berthing-confirm-title')).toBeVisible();
  await expect(berthingModal).toBeVisible();
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const etc = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const etcLocal = `${etc.getFullYear()}-${pad(etc.getMonth() + 1)}-${pad(etc.getDate())}T${pad(etc.getHours())}:${pad(etc.getMinutes())}`;

  await berthingModal.locator('#berthing-ta').fill(local);
  await berthingModal.locator('#berthing-tb').fill(local);
  await berthingModal.locator('#berthing-estimated-completion').fill(etcLocal);
  await berthingModal.locator('#berthing-remarks').fill('E2E berthing automation');
  await berthingModal.locator('#berthing-photos').setInputFiles({
    name: 'vessel-e2e.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    ),
  });
  await confirmBerthingWithJettyRetry(berthingModal, preferredJetty);
}
