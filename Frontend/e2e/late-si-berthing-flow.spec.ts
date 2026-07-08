import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';
import {
  uniqueVessel,
  futureEtaLocal,
  createPlanOnly,
  createPlanWithSi,
  submitAndApprovePlan,
  addSiApproveLatePlan,
  LATE_SI_BERTHING_TOOLTIP_SPEC,
} from './helpers/shipment-plan';
import {
  gotoAllocationPlans,
  queueRowForVessel,
  assignJettyViaLogArrival,
  assertBerthingDisabledWithTooltip,
  assertBerthingEnabled,
  completeBerthing,
  logArrivalButtonInRow,
} from './helpers/allocation';

test.use({
  video: 'on',
  contextOptions: {
    recordVideo: {
      dir: 'videos/post-pentest/',
      size: { width: 1280, height: 720 },
    },
  },
});

test.describe('Normal vs Late SI berthing gate', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Test Case 1 — Happy Path (Normal Flow): approved SI → jetty → berthing TA/TB/ETC', async ({ page }) => {
    const vessel = uniqueVessel('E2E-NORMAL');
    const eta = futureEtaLocal(10);
    const siRef = `SI-E2E-NORMAL-${Date.now()}`;

    const created = await createPlanWithSi(page, { vessel, eta, siRef });
    await submitAndApprovePlan(page, created.id);

    await assignJettyViaLogArrival(page, vessel, '2B');

    const row = queueRowForVessel(page, vessel);
    await assertBerthingEnabled(row);
    await completeBerthing(page, vessel, '2B');
    // Berthing success = Confirm Berthing modal closed (asserted inside completeBerthing).
  });

  test.describe.serial('Late SI flow (blocked → unlocked)', () => {
    let lateVessel = '';
    let latePlanId = 0;

    test('Test Case 2 — Late SI blocked: plan without SI → jetty → disabled Berthing + tooltip', async ({ page }) => {
      lateVessel = uniqueVessel('E2E-LATE');
      const eta = futureEtaLocal(12);

      const created = await createPlanOnly(page, { vessel: lateVessel, eta });
      latePlanId = created.id;

      await assignJettyViaLogArrival(page, lateVessel, '2B');

      await gotoAllocationPlans(page);
      const row = queueRowForVessel(page, lateVessel);
      await expect(row).toBeVisible({ timeout: 30_000 });
      await logArrivalButtonInRow(row).click();
      await expect(page.locator('#arrival-update-modal-title')).toBeVisible();
      const modal = page.locator('[aria-labelledby="arrival-update-modal-title"]');
      await modal.locator('.modal__footer button.btn--secondary').click();
      await expect(modal).toBeHidden();

      await assertBerthingDisabledWithTooltip(row, LATE_SI_BERTHING_TOOLTIP_SPEC);
    });

    test('Test Case 3 — Late SI unlocked: add & approve SI → Berthing enabled → complete arrival', async ({ page }) => {
      test.skip(!latePlanId, 'Depends on Test Case 2 plan id');

      const siRef = `SI-E2E-LATE-${Date.now()}`;
      await addSiApproveLatePlan(page, latePlanId, siRef);

      await gotoAllocationPlans(page);
      const row = queueRowForVessel(page, lateVessel);
      await assertBerthingEnabled(row);
      await completeBerthing(page, lateVessel, '2B');
    });
  });
});
