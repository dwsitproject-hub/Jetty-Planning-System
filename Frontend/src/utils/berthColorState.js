/**
 * Berthing Plan color coding + unallocated rail rules (pure logic, no React).
 *
 * One color per bar, by priority:
 *   red (New, unallocated)  >  warning icon (needs update)  >  blue / green (purpose)
 *
 * - Red only ever appears on the unallocated rail: a vessel with no jetty or no ETB has no bar.
 * - "Needs update" is shown as a warning icon on the bar, not as a color.
 * - Purpose (Unload = blue, Load = green) is the bar color, replacing the Load/Unload pill.
 */
import { resolvePurposeLabel } from './resolvePurposeLabel.js'
import { isBerthPlanSailed } from './berthPlanInterval.js'
import { getBerthingPlanStatus } from './berthingEligibility.js'
import { jettyIdFromScheduleRow, parseMs } from './jettyScheduleOccupancy.js'

/** @typedef {'load' | 'unload' | 'neutral'} BerthPurposeTone */

/**
 * @param {string | null | undefined} purpose purpose label (Loading / Unloading / ...)
 * @param {string | null | undefined} [loadDischarge] LOAD | DISCH fallback
 * @returns {BerthPurposeTone}
 */
export function getBerthPurposeTone(purpose, loadDischarge) {
  const p = resolvePurposeLabel(purpose, loadDischarge)
  if (p === 'Loading') return 'load'
  if (p === 'Unloading') return 'unload'
  return 'neutral'
}

/**
 * Why a vessel on the plan needs its data updated.
 * - emptyEtc:  no ETC / completion recorded for a vessel that is on the plan
 * - etcPassed: ETC is in the past, vessel is not sailed, and no actual completion is recorded
 *
 * @param {{ missingEtc?: boolean, etcOverdue?: boolean, actualCompMs?: number | null, isSailed?: boolean }} input
 * @returns {Array<'emptyEtc' | 'etcPassed'>}
 */
export function getNeedsUpdateReasons({ missingEtc, etcOverdue, actualCompMs, isSailed } = {}) {
  if (isSailed) return []
  /** @type {Array<'emptyEtc' | 'etcPassed'>} */
  const reasons = []
  if (missingEtc) reasons.push('emptyEtc')
  if (etcOverdue && actualCompMs == null) reasons.push('etcPassed')
  return reasons
}

/**
 * Human-readable explanation for the needs-update warning (tooltip / aria).
 * @param {Array<'emptyEtc' | 'etcPassed'> | null | undefined} reasons
 * @param {(key: string, opts?: { defaultValue: string }) => string} t i18n translate (allocation namespace)
 * @returns {string}
 */
export function describeNeedsUpdate(reasons, t) {
  const tr = typeof t === 'function' ? t : (_key, opts) => opts?.defaultValue ?? ''
  const parts = []
  for (const reason of reasons || []) {
    if (reason === 'emptyEtc') {
      parts.push(
        tr('ganttNeedsUpdateEmptyEtc', {
          defaultValue:
            'Estimated completion (ETC) is not set. The bar shows +3 days for display only.',
        })
      )
    } else if (reason === 'etcPassed') {
      parts.push(
        tr('ganttNeedsUpdateEtcPassed', {
          defaultValue:
            'The ETC has passed and no completion is recorded. Update the ETC or the completion.',
        })
      )
    }
  }
  return parts.join(' ')
}

function hasEtb(row) {
  return parseMs(row?.plannedEtbDateTime) != null || parseMs(row?.etbDateTime) != null
}

/**
 * Reasons a vessel cannot be drawn on the Gantt yet.
 * @param {object | null | undefined} row schedule row
 * @returns {Array<'noJetty' | 'noEtb'>}
 */
export function getRailReasons(row) {
  /** @type {Array<'noJetty' | 'noEtb'>} */
  const reasons = []
  if (!jettyIdFromScheduleRow(row)) reasons.push('noJetty')
  if (!hasEtb(row)) reasons.push('noEtb')
  return reasons
}

/**
 * Unallocated rail: pre-berth vessels with no jetty or no ETB (neither can be drawn as a bar).
 * Berthed (TB / docked), sailed, and shifting-out vessels never appear here.
 *
 * @param {object | null | undefined} row schedule row
 * @returns {boolean}
 */
export function isRailEligible(row) {
  if (!row) return false
  if (row.shiftingOut) return false
  if (isBerthPlanSailed(row)) return false
  if (parseMs(row.tbDateTime) != null) return false
  if (getBerthingPlanStatus(row, { planCentric: true }) !== 'incoming') return false
  return getRailReasons(row).length > 0
}

/** The drop can only be saved when the backend can resolve the record (operation or plan). */
export function canScheduleRailRow(row) {
  if (!row) return false
  const hasOp = row.operationId != null && row.operationId !== '' && Number(row.operationId) !== 0
  const hasPlan = row.shipmentPlanId != null && row.shipmentPlanId !== ''
  return hasOp || hasPlan
}

function railKey(row) {
  if (row.shipmentPlanId != null && row.shipmentPlanId !== '') return `plan-${row.shipmentPlanId}`
  if (row.operationId != null && row.operationId !== '') return `op-${row.operationId}`
  return `vessel-${row.vesselId ?? row.vesselName ?? ''}`
}

/**
 * Rail cards: eligible rows only, one per plan/operation, earliest ETA first (no ETA last).
 * @param {object[] | null | undefined} rows
 * @returns {object[]}
 */
export function buildRailRows(rows) {
  const list = Array.isArray(rows) ? rows : []
  const seen = new Set()
  const out = []
  for (const row of list) {
    if (!isRailEligible(row)) continue
    const key = railKey(row)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  out.sort((a, b) => {
    const ea = parseMs(a.etaDateTime) ?? Infinity
    const eb = parseMs(b.etaDateTime) ?? Infinity
    if (ea !== eb) return ea - eb
    return String(a.vesselName ?? '').localeCompare(String(b.vesselName ?? ''))
  })
  return out
}

export { railKey }
