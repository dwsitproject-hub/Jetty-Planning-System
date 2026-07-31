import { formatDateTimeDisplay } from './formatDateTimeDisplay.js'
import { computeCargoProgress } from './cargoQtyDisplay.js'

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
  return r?.commodityShortDisplay || r?.commodityDisplay || r?.commodity || r?.materialDisplay || null
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
 * Opening (hose/conveyor on) label for schematic cards and schedule bars.
 * @param {string | null | undefined} methodName e.g. "Hose" or "Conveyor"
 * @param {string | null | undefined} startAtIso ISO timestamp from opening_hatch start_at
 * @returns {string | null}
 */
export function formatHoseConveyorOnLine(methodName, startAtIso) {
  if (startAtIso == null || startAtIso === '') return null
  const ms = new Date(startAtIso).getTime()
  if (!Number.isFinite(ms)) return null
  const method = String(methodName || '').trim().toLowerCase()
  let label = 'Hose on'
  if (method === 'conveyor') label = 'Conveyor on'
  else if (method === 'hose') label = 'Hose on'
  else if (methodName && String(methodName).trim()) label = `${String(methodName).trim()} on`
  return `${label} ${formatGanttMilestoneShort(ms)}`
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
 * Replace a cargo display's first line with the "<moved> <unit> / <total> <unit> -- Rate
 * <rate> <unit> / Hour" progress form (e.g. "CRUDE PALM OIL 2,500 MT" becomes
 * "500 MT / 2,500 MT -- Rate 30 MT / Hour"). The commodity name itself is deliberately dropped
 * from this line (same as the allocation schematic card's cargoLine) so `formatMaterialQtyLine`
 * can prefix it with the short commodity name without risking a duplicated/mismatched name when
 * the short and full commodity names differ. Only the first line is enhanced — a multi-commodity
 * display (one line per commodity) keeps its remaining lines unchanged, matching the same
 * single-commodity limitation as the allocation schematic card.
 * @param {string | null | undefined} cargoText
 * @param {number | null | undefined} cargoMovedQty
 * @param {string | null | undefined} [cargoFirstLoggedAt]
 * @param {string | null | undefined} [cargoLastLoggedAt]
 * @returns {string | null}
 */
function applyCargoProgress(cargoText, cargoMovedQty, cargoFirstLoggedAt, cargoLastLoggedAt) {
  if (!cargoText || typeof cargoText !== 'string') return cargoText ?? null
  const lines = cargoText.split('\n')
  const progress = computeCargoProgress(lines[0], cargoMovedQty, cargoFirstLoggedAt, cargoLastLoggedAt)
  if (!progress) return cargoText
  const newFirstLine = `${progress.cargoLine} -- ${progress.rateLine}`
  return [newFirstLine, ...lines.slice(1)].join('\n')
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

  const materialDisplay = seg.materialDisplay || (row ? materialDisplayFromRow(row) : null)
  const cargoDisplay = applyCargoProgress(
    seg.cargoDisplay || row?.totalQtyDisplay || null,
    row?.cargoMovedQty,
    row?.cargoFirstLoggedAt,
    row?.cargoLastLoggedAt
  )
  const openingSuffix = formatHoseConveyorOnLine(
    row?.openingCargoHandlingMethodName,
    row?.openingHatchStartAt
  )
  const cargoWithOpening =
    openingSuffix && cargoDisplay ? `${cargoDisplay} · ${openingSuffix}` : cargoDisplay

  return {
    vesselName: seg.vesselName || '—',
    purposeLabel: seg.purposeLabel || row?.planPurposeLabel || row?.purpose || null,
    loadDischarge: seg.loadDischarge ?? row?.loadDischarge ?? null,
    status: seg.status || null,
    etaMs: seg.etaMs ?? null,
    etbMs: seg.plannedEtbMs ?? null,
    taMs: seg.taMs ?? null,
    tbMs: seg.tbMs ?? null,
    actualCompMs,
    materialDisplay,
    cargoDisplay: cargoWithOpening,
    materialQtyLine: formatMaterialQtyLine(materialDisplay, cargoWithOpening),
    estimateLine: formatGanttMilestoneLine([
      { label: 'ETA', ms: seg.etaMs },
      { label: 'ETB', ms: seg.plannedEtbMs },
    ]),
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
  if (layer === 'actual' && model.estimateLine) parts.push(model.estimateLine)
  parts.push(model.milestoneLine)
  if (model.materialQtyLine) parts.push(model.materialQtyLine)
  return parts.filter(Boolean).join(', ')
}
