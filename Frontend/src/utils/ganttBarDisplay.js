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
 * Compact label for in-bar milestones: "19 Jun 16:00" (no year/seconds) so text stays short
 * and is not truncated. Full date/time remains available in the tooltip.
 * @param {number | null | undefined} ms
 * @returns {string}
 */
export function formatGanttMilestoneShort(ms) {
  if (ms == null) return '—'
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '—'
  const day = d.getDate()
  const mon = d.toLocaleDateString('en-GB', { month: 'short' })
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${day} ${mon} ${hh}:${mm}`
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
 * Build the "material · qty" line, avoiding a duplicated material name.
 * The qty/cargo text (totalQtyDisplay) often already contains the material name
 * (e.g. "CRUDE PALM OIL 2.500 MT"); in that case we show only the cargo line so the
 * material is not repeated. When the cargo is just a quantity (e.g. "5,000 MT") we
 * prefix the material name.
 * @param {string | null | undefined} material
 * @param {string | null | undefined} cargo
 * @returns {string | null}
 */
export function formatMaterialQtyLine(material, cargo) {
  const m = isDisplayValue(material) ? String(material).trim() : ''
  const c = isDisplayValue(cargo) ? String(cargo).trim() : ''
  if (!m && !c) return null
  if (!c) return m
  if (!m) return c
  const cl = c.toLowerCase()
  // Split a multi-material label ("CPO - FAME") into parts and check the cargo already names them.
  const parts = m
    .split(/\s*[-·,/]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
  const cargoNamesMaterial =
    cl.includes(m.toLowerCase()) || (parts.length > 0 && parts.every((p) => cl.includes(p.toLowerCase())))
  if (cargoNamesMaterial) return c
  return `${m} · ${c}`
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
