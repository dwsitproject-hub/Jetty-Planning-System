/** Tooltip when Berthing is blocked — plan not approved yet. */
export const BERTHING_PLAN_GATE_TOOLTIP =
  'Shipment plan must be approved before berthing.';

/** No SIs on plan yet (late-SI scheduling). */
export const BERTHING_NO_SI_TOOLTIP =
  'Add at least one shipping instruction and approve the shipment plan before berthing.';

/** @deprecated use BERTHING_PLAN_GATE_TOOLTIP — kept for locale key compatibility */
export const BERTHING_SI_GATE_TOOLTIP = BERTHING_PLAN_GATE_TOOLTIP;

/**
 * @param {object|null|undefined} row - allocation queue / schedule row
 * @param {{ planCentric?: boolean }} [options]
 * @returns {string|null} disabled reason, or null if Berthing is allowed
 */
export function berthingDisabledReason(row, options = {}) {
  if (!row || !options.planCentric) return null;
  if (row.berthingAllowed === true) return null;
  const hasSi =
    (Array.isArray(row.planQueueSiEntries) && row.planQueueSiEntries.length > 0) ||
    (row.shippingInstructionId != null && row.shippingInstructionId !== '');
  if (!hasSi) return BERTHING_NO_SI_TOOLTIP;
  return BERTHING_PLAN_GATE_TOOLTIP;
}

/** Show late-SI warning in Log arrival update when Berthing is blocked. */
export function showLateSiBerthingGateNotice(row, options = {}) {
  if (!options.planCentric) return false;
  return berthingDisabledReason(row, options) != null;
}

/** Plan-only row: Log Arrival allowed; hide NOR / alongside fields until an operation exists. */
export function isPlanOnlySchedulingRow(row) {
  if (!row) return false;
  return (
    row.shipmentPlanId != null &&
    (row.shippingInstructionId == null || row.shippingInstructionId === '') &&
    (row.operationId == null || row.operationId === '')
  );
}

/** Incoming vs berthed for allocation-plans status filter (plan-centric aware). */
export function getBerthingPlanStatus(row, options = {}) {
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
