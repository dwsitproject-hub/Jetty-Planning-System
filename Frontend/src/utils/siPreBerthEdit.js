import {
  BERTHING_INVALID_SI_REF_TOOLTIP,
  isSiReferenceValidForBerthing,
} from './siReferenceValidation.js'

const AT_BERTH_STATUSES = new Set([
  'DOCKED',
  'IN_PROGRESS',
  'POST_OPS',
  'SIGNOFF_REQUESTED',
  'SIGNOFF_APPROVED',
])

/** @param {object|null|undefined} row */
export function isRowPreBerth(row) {
  if (!row) return false
  if (Boolean(row.tbDateTime)) return false
  const opStatus = String(row?.status || '').toUpperCase()
  if (AT_BERTH_STATUSES.has(opStatus)) return false
  return true
}

/** @param {object|null|undefined} row */
export function resolvePrimarySiIdFromRow(row) {
  if (row?.shippingInstructionId != null && row.shippingInstructionId !== '') {
    return Number(row.shippingInstructionId)
  }
  if (Array.isArray(row?.planQueueSiEntries) && row.planQueueSiEntries.length > 0) {
    const entry = row.planQueueSiEntries.find(
      (e) => e.shippingInstructionId != null && e.shippingInstructionId !== ''
    )
    if (entry) return Number(entry.shippingInstructionId)
  }
  return null
}

/** @param {object|null|undefined} row */
export function canEditSiPreBerth(row) {
  if (!isRowPreBerth(row)) return false
  const siId = resolvePrimarySiIdFromRow(row)
  return siId != null && Number.isFinite(siId)
}

/** @param {object|null|undefined} plan */
export function planIsPreBerth(plan) {
  if (!plan) return false
  if (plan.tb || plan.dockingStartTime) return false
  if (plan.hasBerthedOperation === true) return false
  return true
}

/** @param {object|null|undefined} plan */
export function resolveFirstSiIdFromPlan(plan) {
  const sis = plan?.shippingInstructions
  if (Array.isArray(sis) && sis.length > 0 && sis[0]?.id != null) {
    return Number(sis[0].id)
  }
  return null
}

/** @param {object|null|undefined} plan */
export function planHubCanEditSi(plan) {
  if (!plan) return false
  const status = plan.approvalStatus || ''
  if (status !== 'Approved' && status !== 'Submitted') return false
  if (!planIsPreBerth(plan)) return false
  return Array.isArray(plan.shippingInstructions) && plan.shippingInstructions.length > 0
}

/** @param {object|null|undefined} plan */
export function planListCanEditPlanPreBerth(plan) {
  if (!plan) return false
  const status = plan.approvalStatus || ''
  if (status !== 'Approved' && status !== 'Submitted') return false
  return planIsPreBerth(plan)
}

/** @param {object|null|undefined} plan */
export function canOpenPreBerthCombinedEdit(plan) {
  return planListCanEditPlanPreBerth(plan)
}

/** @param {object|null|undefined} row */
export function resolvePlanIdFromRow(row) {
  const pid = row?.shipmentPlanId ?? row?.id
  if (pid == null || !Number.isFinite(Number(pid))) return null
  return Number(pid)
}

/** @param {object|null|undefined} plan */
export function planHubCanEditPlan(plan) {
  return planListCanEditPlanPreBerth(plan)
}

/** @param {object|null|undefined} row */
export function canEditPlanPreBerthFromRow(row) {
  if (!isRowPreBerth(row)) return false
  const pid = row?.shipmentPlanId
  return pid != null && Number.isFinite(Number(pid))
}

/** @param {object|null|undefined} plan */
export function planListCanEditSiPreBerth(plan) {
  if (!plan) return false
  const status = plan.approvalStatus || ''
  if (status !== 'Approved' && status !== 'Submitted') return false
  if (!planIsPreBerth(plan)) return false
  const n = plan.siCount ?? (plan.shippingInstructions || []).length
  return n > 0
}

/**
 * @param {{ planReopened?: boolean, saved?: object, vesselName?: string }} result
 * @param {(key: string, opts?: object) => string} t
 */
/**
 * Toast after saving the combined pre-berth modal (plan + existing SIs).
 * @param {{ planReopened?: boolean, vesselName?: string, siDrafts?: object[] }} result
 * @param {(key: string, opts?: object) => string} t
 */
export function preBerthCombinedSaveToastMessage(result, t) {
  if (result?.planReopened) {
    return t('preBerthEditPlanReopened', {
      defaultValue: 'Plan reopened for re-approval due to SI changes.',
    })
  }
  const vessel = result?.vesselName ?? ''
  for (const d of result?.siDrafts || []) {
    const ref = String(d.form?.referenceNumber ?? '').trim()
    if (ref && isSiReferenceValidForBerthing(ref, vessel)) {
      return t('preBerthEditSavedBerthing', {
        defaultValue: 'SI updated — berthing is now available.',
      })
    }
  }
  return t('preBerthEditPlanSaved', { defaultValue: 'Shipment plan updated.' })
}

export function siPreBerthSaveToastMessage(result, t) {
  if (result?.planReopened) {
    return t('preBerthEditPlanReopened', {
      defaultValue: 'Plan reopened for re-approval due to SI changes.',
    })
  }
  const ref = String(result?.saved?.referenceNumber ?? '').trim()
  const vessel = result?.vesselName ?? result?.saved?.vesselName ?? ''
  if (ref && isSiReferenceValidForBerthing(ref, vessel)) {
    return t('preBerthEditSavedBerthing', {
      defaultValue: 'SI updated — berthing is now available.',
    })
  }
  return t('preBerthEditSaved', { defaultValue: 'Shipping instruction updated.' })
}

/**
 * @param {object|null|undefined} row
 * @param {string|null|undefined} berthingBlockReason
 */
export function shouldShowSiPreBerthEditLink(row, berthingBlockReason) {
  if (!canEditSiPreBerth(row)) return false
  if (berthingBlockReason === BERTHING_INVALID_SI_REF_TOOLTIP) return true
  if (berthingBlockReason && row?.berthingAllowed === false) return true
  return false
}

/** @param {object|null|undefined} row */
export function shouldShowPlanPreBerthEditLink(row, berthingBlockReason) {
  if (!canEditPlanPreBerthFromRow(row)) return false
  if (berthingBlockReason) return true
  if (row?.berthingAllowed === false) return true
  return false
}
