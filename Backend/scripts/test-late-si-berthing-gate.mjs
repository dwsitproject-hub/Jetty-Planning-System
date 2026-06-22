/**
 * Late SI / berthing gate — pure helper checks (no DB/API required).
 * Run: node scripts/test-late-si-berthing-gate.mjs
 */
const BERTHING_KEYS = [
  'taDateTime',
  'tbDateTime',
  'pobDateTime',
  'sobDateTime',
  'estimatedCompletionDateTime',
  'actualCompletionDateTime',
];

function bodyHasBerthingArrivalFields(b) {
  return BERTHING_KEYS.some(
    (k) => Object.prototype.hasOwnProperty.call(b, k) && b[k] != null && String(b[k]).trim() !== ''
  );
}

/** Plan-centric: berthingAllowed when plan Approved + si_count > 0 */
function attachBerthingEligibility(row, berthingByPlan) {
  const pid = row.shipmentPlanId != null ? Number(row.shipmentPlanId) : null;
  let berthingAllowed = false;
  if (pid != null && Number.isFinite(pid)) {
    berthingAllowed = berthingByPlan.get(pid) === true;
  }
  return { ...row, berthingAllowed };
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

const planMap = new Map([
  [1, false],
  [2, true],
]);

assert(!attachBerthingEligibility({ shipmentPlanId: 1 }, planMap).berthingAllowed, 'plan not approved');
assert(attachBerthingEligibility({ shipmentPlanId: 2 }, planMap).berthingAllowed, 'approved plan with SIs');

assert(!bodyHasBerthingArrivalFields({ jetty: '1A', etaDateTime: '2026-06-01T10:00' }), 'plan fields only');
assert(bodyHasBerthingArrivalFields({ tbDateTime: '2026-06-01T12:00' }), 'tb blocks plan-only');

const BERTHING_PLAN_GATE_TOOLTIP = 'Shipment plan must be approved before berthing.';
const BERTHING_NO_SI_TOOLTIP =
  'Add at least one shipping instruction and approve the shipment plan before berthing.';

function berthingDisabledReason(row, options = {}) {
  if (!row || !options.planCentric) return null;
  if (row.berthingAllowed === true) return null;
  const hasSi =
    (Array.isArray(row.planQueueSiEntries) && row.planQueueSiEntries.length > 0) ||
    (row.shippingInstructionId != null && row.shippingInstructionId !== '');
  if (!hasSi) return BERTHING_NO_SI_TOOLTIP;
  return BERTHING_PLAN_GATE_TOOLTIP;
}

function showLateSiBerthingGateNotice(row, options = {}) {
  if (!options.planCentric) return false;
  return berthingDisabledReason(row, options) != null;
}

function isPlanOnlySchedulingRow(row) {
  if (!row) return false;
  return (
    row.shipmentPlanId != null &&
    (row.shippingInstructionId == null || row.shippingInstructionId === '') &&
    (row.operationId == null || row.operationId === '')
  );
}

function getBerthingPlanStatus(row, options = {}) {
  const planCentric = Boolean(options.planCentric);
  if (row?.shiftingOut) return 'incoming';
  const noOperation =
    row?.operationId == null || row?.operationId === '' || Number(row?.operationId) === 0;
  if (planCentric && noOperation) {
    if (row?.source === 'incoming-plan' || row?.source === 'incoming-si') return 'incoming';
    if (isPlanOnlySchedulingRow(row)) return 'incoming';
  }
  const hasTb = Boolean(row?.tbDateTime);
  const opStatus = String(row?.status || '').toUpperCase();
  if (
    hasTb ||
    opStatus === 'DOCKED' ||
    opStatus === 'IN_PROGRESS' ||
    opStatus === 'POST_OPS' ||
    opStatus === 'SIGNOFF_REQUESTED' ||
    opStatus === 'SIGNOFF_APPROVED'
  ) {
    return 'berthed';
  }
  return 'incoming';
}

assert(
  getBerthingPlanStatus(
    { source: 'incoming-plan', shipmentPlanId: 5, tbDateTime: '2026-06-01T12:00' },
    { planCentric: true }
  ) === 'incoming',
  'incoming-plan with plan TB stays incoming until operation'
);
assert(
  getBerthingPlanStatus(
    { source: 'operation', operationId: 1, tbDateTime: '2026-06-01T12:00' },
    { planCentric: true }
  ) === 'berthed',
  'operation with TB is berthed'
);

assert(
  showLateSiBerthingGateNotice({ shipmentPlanId: 1, berthingAllowed: false }, { planCentric: true }),
  'notice when plan not approved / no SI'
);
assert(
  showLateSiBerthingGateNotice(
    {
      shipmentPlanId: 19,
      planQueueSiEntries: [{ siStatus: 'Draft' }, { siStatus: 'Draft' }],
      berthingAllowed: false,
    },
    { planCentric: true }
  ),
  'notice when plan not approved even if SIs exist'
);
assert(
  !showLateSiBerthingGateNotice(
    {
      shipmentPlanId: 19,
      planQueueSiEntries: [{ siStatus: 'Approved' }, { siStatus: 'Approved' }],
      berthingAllowed: true,
    },
    { planCentric: true }
  ),
  'no notice when plan approved with SIs'
);
assert(
  berthingDisabledReason(
    { shipmentPlanId: 19, planQueueSiEntries: [{ label: 'SI-1' }], berthingAllowed: true },
    { planCentric: true }
  ) == null,
  'berthing enabled when berthingAllowed true regardless of siStatus mirror'
);

function planCentricQueueRowHasSi(row) {
  if (!row) return false;
  if (row.source === 'incoming-plan') return false;
  if (Array.isArray(row.planQueueSiEntries) && row.planQueueSiEntries.length > 0) return true;
  if (row.source === 'incoming-si') return true;
  const sid = row.shippingInstructionId;
  if (sid != null && sid !== '' && Number.isFinite(Number(sid))) return true;
  return false;
}

function rowPassesAllocationStatusFilter(row, rowStatus, statusFilter, isPlanCentric) {
  if (rowStatus === 'berthed') return Boolean(statusFilter.showBerthed);
  if (rowStatus !== 'incoming') return false;
  if (!statusFilter.showIncoming) return false;
  if (!isPlanCentric) return true;
  const slice = statusFilter.incomingSlice || 'all';
  if (slice === 'all') return true;
  const hasSi = planCentricQueueRowHasSi(row);
  if (slice === 'noSi') return !hasSi;
  if (slice === 'hasSi') return hasSi;
  return true;
}

const planFilterNoSi = { showIncoming: true, showBerthed: false, incomingSlice: 'noSi' };
const planFilterHasSi = { showIncoming: true, showBerthed: false, incomingSlice: 'hasSi' };

assert(
  rowPassesAllocationStatusFilter(
    { source: 'incoming-plan', shipmentPlanId: 20 },
    'incoming', planFilterNoSi, true
  ),
  'noSi: plan-only row'
);
assert(
  !rowPassesAllocationStatusFilter(
    { source: 'incoming-si', shipmentPlanId: 19, planQueueSiEntries: [{ shippingInstructionId: 20 }] },
    'incoming', planFilterNoSi, true
  ),
  'noSi: plan with SIs excluded'
);
assert(
  rowPassesAllocationStatusFilter(
    { source: 'incoming-si', shipmentPlanId: 19, planQueueSiEntries: [{ shippingInstructionId: 20 }] },
    'incoming', planFilterHasSi, true
  ),
  'hasSi: plan with SIs included'
);

console.log('test-late-si-berthing-gate: ok');
