import { formatDateTimeDisplay } from './formatDateTimeDisplay.js'

/** Gantt bar layout constants (keep in sync with allocation.css --gantt-bar-*). */
export const GANTT_BAR_HEIGHT = 56
export const GANTT_BAR_STACK_STEP = 62

/**
 * @param {object | null | undefined} r
 * @returns {string | null}
 */
export function materialDisplayFromRow(r) {
  if (Array.isArray(r?.shippingTable) && r.shippingTable.length) {
    const names = [...new Set(r.shippingTable.map((row) => row.material).filter(Boolean))]
    if (names.length) return names.join(' - ')
  }
  return r?.commodityDisplay || r?.commodity || r?.materialDisplay || null
}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
export function isDisplayValue(v) {
  const s = String(v ?? '').trim()
  return Boolean(s && s !== '—')
}

/**
 * @param {number | null | undefined} barWidthPct 0–100 scale (percentage of timeline)
 * @returns {'narrow' | 'medium' | 'full'}
 */
export function resolveGanttBarDensity(barWidthPct) {
  const pct = barWidthPct == null ? 100 : barWidthPct
  if (pct < 15) return 'narrow'
  if (pct < 35) return 'medium'
  return 'full'
}

/**
 * @param {number | null | undefined} ms
 * @returns {string}
 */
export function formatGanttMilestoneMs(ms) {
  if (ms == null) return '—'
  return formatDateTimeDisplay(new Date(ms).toISOString())
}

/**
 * @param {Array<{ label: string, ms: number | null | undefined }>} entries
 * @returns {string}
 */
export function formatGanttMilestoneLine(entries) {
  return entries
    .map(({ label, ms }) => `${label} ${formatGanttMilestoneMs(ms)}`)
    .join(' · ')
}

/**
 * @param {string | null | undefined} material
 * @param {string | null | undefined} cargo
 * @returns {string | null}
 */
export function formatMaterialQtyLine(material, cargo) {
  const parts = [material, cargo].filter(isDisplayValue)
  if (!parts.length) return null
  return parts.join(' · ')
}

/**
 * @param {object} seg
 * @returns {object}
 */
export function buildPlannedBlockModel(seg) {
  return {
    vesselName: seg.vesselName || '—',
    purposeLabel: seg.purposeLabel || null,
    loadDischarge: seg.loadDischarge ?? null,
    status: seg.status || null,
    etaMs: seg.etaMs ?? null,
    etbMs: seg.plannedEtbMs ?? null,
    etcMs: seg.estCompMs ?? null,
    materialDisplay: seg.materialDisplay || null,
    cargoDisplay: seg.cargoDisplay || null,
    materialQtyLine: formatMaterialQtyLine(seg.materialDisplay, seg.cargoDisplay),
    milestoneLine: formatGanttMilestoneLine([
      { label: 'ETA', ms: seg.etaMs },
      { label: 'ETB', ms: seg.plannedEtbMs },
      { label: 'ETC', ms: seg.estCompMs },
    ]),
  }
}

/**
 * @param {object} seg
 * @param {object | null | undefined} row
 * @returns {object}
 */
export function buildActualBlockModel(seg, row) {
  const actualCompMs =
    seg.actualCompMs ??
    (row ? parseRowActualCompMs(row) : null)

  return {
    vesselName: seg.vesselName || '—',
    purposeLabel: seg.purposeLabel || row?.planPurposeLabel || row?.purpose || null,
    loadDischarge: seg.loadDischarge ?? row?.loadDischarge ?? null,
    status: seg.status || null,
    taMs: seg.taMs ?? null,
    tbMs: seg.tbMs ?? null,
    actualCompMs,
    materialDisplay: seg.materialDisplay || (row ? materialDisplayFromRow(row) : null),
    cargoDisplay: seg.cargoDisplay || row?.totalQtyDisplay || null,
    materialQtyLine: formatMaterialQtyLine(
      seg.materialDisplay || (row ? materialDisplayFromRow(row) : null),
      seg.cargoDisplay || row?.totalQtyDisplay
    ),
    milestoneLine: formatGanttMilestoneLine([
      { label: 'TA', ms: seg.taMs },
      { label: 'TB', ms: seg.tbMs },
      { label: 'Done', ms: actualCompMs },
    ]),
    etcOverdue: Boolean(seg.etcOverdue),
    overMs: seg.overMs ?? null,
    estCompMs: seg.estCompMs ?? null,
  }
}

/**
 * @param {object} row
 * @returns {number | null}
 */
export function parseRowActualCompMs(row) {
  const actComp = row?.actualCompletionDateTime
  const castOff = row?.castOffDateTime
  const parse = (v) => {
    if (v == null || v === '') return null
    const t = new Date(v).getTime()
    return Number.isFinite(t) ? t : null
  }
  return parse(actComp) ?? parse(castOff)
}

/**
 * @param {object} model
 * @param {'planned' | 'actual'} layer
 * @returns {string}
 */
export function ganttDenseBlockAriaLabel(model, layer) {
  const parts = [model.vesselName]
  if (model.purposeLabel) parts.push(model.purposeLabel)
  if (layer === 'planned') {
    parts.push(model.milestoneLine)
  } else {
    parts.push(model.milestoneLine)
  }
  if (model.materialQtyLine) parts.push(model.materialQtyLine)
  return parts.filter(Boolean).join(', ')
}
