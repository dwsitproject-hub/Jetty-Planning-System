import { formatDateTimeDisplay } from './formatDateTimeDisplay.js'
import {
  computeCargoProgress,
  formatAvgFlowRateLabel,
  parseQtyDisplay,
} from './cargoQtyDisplay.js'
import { commodityLongTitle } from './commodityShortTitle.js'
import { computeWaitToBerthMs, waitToBerthTooltipMode } from './waitToBerth.js'

/** Gantt bar layout constants (keep in sync with allocation.css --gantt-bar-*). */
export const GANTT_BAR_HEIGHT = 72
export const GANTT_BAR_STACK_STEP = 78

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

/** Long bars benefit from a pinned label panel while scrolling horizontally (~5+ days in a 28-day window). */
export function isLongGanttBar(rawWidthPct, { minPct = 18 } = {}) {
  const pct = Number(rawWidthPct)
  return Number.isFinite(pct) && pct >= minPct
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
 * Cargo qty line for Gantt bars. On plan-centric bars the commodity is already on the row above,
 * so only the cargo progress text is returned.
 * @param {string | null | undefined} material
 * @param {string | null | undefined} cargo
 * @param {{ planCentric?: boolean }} [options]
 * @returns {string | null}
 */
export function ganttCargoQtyLine(material, cargo, { planCentric = false } = {}) {
  if (planCentric && isDisplayValue(material) && isDisplayValue(cargo)) {
    return String(cargo).trim()
  }
  return formatMaterialQtyLine(material, cargo)
}

/**
 * Compact wait duration (TB − TA) for Gantt bars, e.g. "17.5 d".
 * Always days, one decimal (12 hours → "0.5 d").
 * @param {number | null | undefined} waitMs
 * @returns {string | null}
 */
export function formatWaitDaysFromMs(waitMs) {
  const ms = Number(waitMs)
  if (!Number.isFinite(ms) || ms < 0) return null
  const days = ms / 86400000
  const rounded = Math.round(days * 10) / 10
  return `${rounded.toLocaleString('en-US', { maximumFractionDigits: 1 })} d`
}

/** @deprecated Use formatWaitDaysFromMs — kept for callers that still import hours. */
export function formatWaitHoursFromMs(waitMs) {
  return formatWaitDaysFromMs(waitMs)
}

/**
 * Planned in-bar milestones (ETB / ETC). Arrival (ETA) stays on the tooltip.
 * @param {object} model
 * @returns {Array<{ key: string, label: string, ms: number | null }>}
 */
export function buildGanttPlannedMilestoneEntries(model) {
  return [
    { key: 'ganttBarEtb', label: 'ETB', ms: model.etbMs ?? null },
    { key: 'ganttBarEtc', label: 'ETC', ms: model.etcMs ?? null },
  ]
}

/**
 * Estimate in-bar milestones for actual Gantt bars (ETB / ETC).
 * @param {object} model
 * @returns {Array<{ key: string, label: string, ms: number | null }>}
 */
export function buildGanttEstimateMilestoneEntries(model) {
  const etcMs = model.etcMs ?? model.estCompMs ?? null
  return [
    { key: 'ganttBarEtb', label: 'ETB', ms: model.etbMs ?? null },
    { key: 'ganttBarEtc', label: 'ETC', ms: etcMs },
  ]
}

/**
 * Actual in-bar milestones (TB / TC). Arrival (TA) stays on the tooltip.
 * @param {object} model
 * @returns {Array<{ key: string, label: string, ms: number | null }>}
 */
export function buildGanttActualMilestoneEntries(model) {
  return [
    { key: 'ganttBarTb', label: 'TB', ms: model.tbMs ?? null },
    { key: 'ganttBarActualCompletion', label: 'TC', ms: model.actualCompMs ?? null },
  ]
}

/**
 * Arrival context for tooltips (ETA / TA), not drawn on the bar.
 * @param {object} model
 * @returns {Array<{ key: string, label: string, ms: number | null }>}
 */
export function buildGanttArrivalMilestoneEntries(model) {
  return [
    { key: 'ganttBarEta', label: 'ETA', ms: model.etaMs ?? null },
    { key: 'ganttBarTa', label: 'TA', ms: model.taMs ?? null },
  ]
}

/**
 * Combined estimate + actual entries for medium-density actual bars.
 * @param {object} model
 * @returns {Array<{ key: string, label: string, ms: number | null }>}
 */
export function buildGanttCombinedActualMilestoneEntries(model) {
  return [...buildGanttEstimateMilestoneEntries(model), ...buildGanttActualMilestoneEntries(model)]
}

/**
 * Compact in-bar milestone line (short timestamps, i18n labels).
 * @param {Array<{ key: string, label: string, ms: number | null }>} entries
 * @param {(key: string, opts: { defaultValue: string }) => string} translate
 * @returns {string}
 */
export function formatGanttMilestoneEntriesCompact(entries, translate) {
  return entries
    .map(
      ({ key, label, ms }) =>
        `${translate(key, { defaultValue: label })} ${formatGanttMilestoneShort(ms)}`
    )
    .join(' · ')
}

/**
 * @param {object | null | undefined} row
 * @returns {string}
 */
/** "3d 4h" / "8h 3m" — matches Jetty schematic card duration labels. */
export function formatGanttDurationShort(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null
  const mins = Math.floor(ms / 60000)
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  const rem = mins % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${rem}m`
  return `${rem}m`
}

/**
 * Estimated time remaining from balance ÷ rate (same inputs as schematic ETR).
 * @returns {string|null} duration only, e.g. "8h 3m"
 */
export function resolveGanttEtrDuration(row) {
  if (!row) return null
  const progress = computeCargoProgress(
    row?.totalQtyDisplay || row?.cargoDisplay || null,
    row?.cargoMovedQty,
    row?.cargoFirstLoggedAt,
    row?.cargoLastLoggedAt,
    {
      cargoSiQty: row?.cargoSiQty ?? row?.scheduleComparison?.siQty,
      cargoSiMetric: row?.cargoSiMetric ?? row?.scheduleComparison?.siMetric,
      avgRateTph: row?.scheduleComparison?.avgRateTph,
    }
  )
  if (!progress?.etrMs) return null
  return formatGanttDurationShort(progress.etrMs)
}

/**
 * Modal / detail display for ETR with sailed and completed overrides.
 * @param {object | null | undefined} row
 * @param {{ hasSailed?: boolean, hasCompleted?: boolean, t?: (key: string, opts?: object) => string }} [opts]
 * @returns {string}
 */
export function resolveVesselEtrDisplay(row, { hasSailed = false, hasCompleted = false, t } = {}) {
  if (hasSailed) {
    return t?.('planModalSailed', { defaultValue: 'Sailed' }) ?? 'Sailed'
  }
  if (hasCompleted) {
    return t?.('planModalCompleted', { defaultValue: 'Completed' }) ?? 'Completed'
  }
  return resolveGanttEtrDuration(row) ?? '—'
}

export function resolveGanttAvgRateLine(row) {
  if (!row) return '—'
  const fromApi = Number(row?.scheduleComparison?.avgRateTph)
  const unit =
    row?.cargoSiMetric ||
    row?.scheduleComparison?.siMetric ||
    parseQtyDisplay(row?.totalQtyDisplay)?.unit ||
    'MT'
  if (Number.isFinite(fromApi) && fromApi > 0) {
    return formatAvgFlowRateLabel(fromApi, unit) || '—'
  }
  const progress = computeCargoProgress(
    row?.totalQtyDisplay || row?.cargoDisplay || null,
    row?.cargoMovedQty,
    row?.cargoFirstLoggedAt,
    row?.cargoLastLoggedAt,
    {
      cargoSiQty: row?.cargoSiQty,
      cargoSiMetric: row?.scheduleComparison?.siMetric,
    }
  )
  if (progress?.ratePerHour > 0) {
    return formatAvgFlowRateLabel(progress.ratePerHour, progress.qty.unit) || '—'
  }
  return '—'
}

/**
 * @param {object} seg
 * @param {{ nowMs?: number, planCentric?: boolean }} [options]
 * @returns {object}
 */
export function buildPlannedBlockModel(seg, options = {}) {
  const { nowMs = Date.now(), planCentric = false } = options
  const materialDisplay = seg.materialDisplay || null
  const isWaitingPlanned =
    planCentric &&
    seg.taMs != null &&
    seg.tbMs == null &&
    seg.status !== 'Sailed off'
  const waitMs =
    seg.waitMs != null
      ? seg.waitMs
      : isWaitingPlanned
        ? computeWaitToBerthMs({ taMs: seg.taMs, nowMs, mode: 'waiting' })
        : null
  const waitLine = formatWaitDaysFromMs(waitMs)
  const waitTooltipMode = isWaitingPlanned ? 'waiting' : null
  return {
    vesselName: seg.vesselName || '—',
    purposeLabel: seg.purposeLabel || null,
    loadDischarge: seg.loadDischarge ?? null,
    status: seg.status || null,
    etaMs: seg.etaMs ?? null,
    etbMs: seg.plannedEtbMs ?? null,
    taMs: seg.taMs ?? null,
    tbMs: seg.tbMs ?? null,
    etcMs: seg.estCompMs ?? null,
    materialDisplay,
    commodityTitle: commodityLongTitle(materialDisplay, seg.commodityDisplay),
    cargoDisplay: seg.cargoDisplay || null,
    materialQtyLine: ganttCargoQtyLine(materialDisplay, seg.cargoDisplay, { planCentric }),
    waitLine,
    waitTooltipMode,
    avgRateLine: '—',
    etrDuration: null,
    arrivalLine: formatGanttMilestoneLine(
      [
        { label: 'ETA', ms: seg.etaMs },
        { label: 'TA', ms: null },
      ].filter((e) => e.ms != null)
    ),
    milestoneLine: formatGanttMilestoneLine([
      { label: 'ETB', ms: seg.plannedEtbMs },
      { label: 'ETC', ms: seg.estCompMs },
    ]),
    missingEtc: Boolean(seg.missingEtc),
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
function applyCargoProgress(
  cargoText,
  cargoMovedQty,
  cargoFirstLoggedAt,
  cargoLastLoggedAt,
  row,
  { omitRateLine = false } = {}
) {
  if (!cargoText || typeof cargoText !== 'string') return cargoText ?? null
  const lines = cargoText.split('\n')
  const progress = computeCargoProgress(lines[0], cargoMovedQty, cargoFirstLoggedAt, cargoLastLoggedAt, {
    cargoSiQty: row?.cargoSiQty,
    cargoSiMetric: row?.scheduleComparison?.siMetric,
  })
  if (!progress) return cargoText
  const newFirstLine = omitRateLine ? progress.cargoLine : `${progress.cargoLine} -- ${progress.rateLine}`
  return [newFirstLine, ...lines.slice(1)].join('\n')
}

/**
 * @param {object} seg
 * @param {object | null | undefined} row
 * @param {{ planCentric?: boolean }} [options]
 * @returns {object}
 */
export function buildActualBlockModel(seg, row, options = {}) {
  const { planCentric = false } = options
  const actualCompMs =
    seg.actualCompMs ??
    (row ? parseRowActualCompMs(row) : null)

  const materialDisplay = seg.materialDisplay || (row ? materialDisplayFromRow(row) : null)
  const cargoDisplay = applyCargoProgress(
    seg.cargoDisplay || row?.totalQtyDisplay || null,
    row?.cargoMovedQty,
    row?.cargoFirstLoggedAt,
    row?.cargoLastLoggedAt,
    row,
    { omitRateLine: planCentric }
  )
  const openingSuffix = formatHoseConveyorOnLine(
    row?.openingCargoHandlingMethodName,
    row?.openingHatchStartAt
  )
  const cargoWithOpening =
    openingSuffix && cargoDisplay ? `${cargoDisplay} · ${openingSuffix}` : cargoDisplay

  const waitMs =
    seg.waitMs != null
      ? seg.waitMs
      : computeWaitToBerthMs({
          taMs: seg.taMs,
          tbMs: seg.tbMs,
          etbMs: seg.plannedEtbMs,
          mode: 'berthed',
        })
  const waitLine = formatWaitDaysFromMs(waitMs)
  const waitTooltipMode = waitLine
    ? waitToBerthTooltipMode({
        tbMs: seg.tbMs,
        etbMs: seg.plannedEtbMs,
        mode: 'berthed',
      })
    : null

  const avgRateLine = resolveGanttAvgRateLine(row)
  const etrDuration = planCentric ? resolveGanttEtrDuration(row) : null

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
    etcMs: seg.estCompMs ?? null,
    materialDisplay,
    commodityTitle: commodityLongTitle(materialDisplay, seg.commodityDisplay || row?.commodityDisplay),
    cargoDisplay: cargoWithOpening,
    materialQtyLine: ganttCargoQtyLine(materialDisplay, cargoWithOpening, { planCentric }),
    waitLine,
    waitTooltipMode,
    avgRateLine,
    etrDuration,
    arrivalLine: formatGanttMilestoneLine(
      [
        { label: 'ETA', ms: seg.etaMs },
        { label: 'TA', ms: seg.taMs },
      ].filter((e) => e.ms != null)
    ),
    estimateLine: formatGanttMilestoneLine([
      { label: 'ETB', ms: seg.plannedEtbMs },
      { label: 'ETC', ms: seg.estCompMs },
    ]),
    milestoneLine: formatGanttMilestoneLine([
      { label: 'TB', ms: seg.tbMs },
      { label: 'TC', ms: actualCompMs },
    ]),
    etcOverdue: Boolean(seg.etcOverdue),
    overMs: seg.overMs ?? null,
    estCompMs: seg.estCompMs ?? null,
    missingEtc: Boolean(seg.missingEtc),
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
  if (model.materialDisplay) parts.push(model.materialDisplay)
  if (model.materialQtyLine) parts.push(model.materialQtyLine)
  if (model.waitLine) parts.push(`⌛ ${model.waitLine}`)
  if (model.avgRateLine && model.avgRateLine !== '—') parts.push(model.avgRateLine)
  if (model.etrDuration) parts.push(`ETR ${model.etrDuration}`)
  return parts.filter(Boolean).join(', ')
}

/**
 * Tooltip items for schedule Gantt bars (full text when in-bar content is clipped).
 * @param {object} model from buildPlannedBlockModel / buildActualBlockModel
 * @param {'planned' | 'actual'} layer
 * @param {{ clickHint?: string | null }} [options]
 * @returns {Array<{ primary: string, secondary?: string }>}
 */
export function buildGanttBarTooltipItems(model, layer, options = {}) {
  const items = []
  if (model.purposeLabel) {
    items.push({ primary: 'Purpose', secondary: model.purposeLabel })
  }
  if (layer === 'actual' && model.estimateLine) {
    items.push({ primary: 'Estimate', secondary: model.estimateLine })
  }
  items.push({
    primary: layer === 'planned' ? 'Planned milestones' : 'Actual milestones',
    secondary: model.milestoneLine,
  })
  if (model.etaMs != null || model.taMs != null) {
    items.push({
      primary: 'Arrival',
      secondary: model.arrivalLine,
    })
  }
  if (model.materialQtyLine) {
    items.push({ primary: 'Cargo', secondary: model.materialQtyLine })
  }
  if (model.waitLine) {
    items.push({
      primary: options.waitLabel || 'Waiting days (Berth − Arrival)',
      secondary: model.waitLine,
    })
  }
  items.push({
    primary: 'Avg flow rate',
    secondary: model.avgRateLine || '—',
  })
  if (model.etrDuration) {
    items.push({
      primary: options.etrLabel || 'ETR (balance ÷ rate)',
      secondary: model.etrDuration,
    })
  }
  if (model.status) {
    items.push({ primary: 'Status', secondary: model.status })
  }
  if (options.clickHint) {
    items.push({ primary: options.clickHint })
  }
  return items
}
