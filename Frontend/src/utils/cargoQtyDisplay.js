/**
 * Shared helpers for parsing/formatting cargo quantity display strings and computing
 * moved-vs-total progress. Used by JettySchematic (berth cards) and ganttBarDisplay
 * (Gantt "actual" bars) so both surfaces agree on the same cargo progress numbers.
 */

/**
 * Parse a qty display string ("3.999 MT", "2,500 MT", "1.234,5 KL") into { total, unit }.
 * Handles both id-ID (dot thousands) and en-US (comma thousands) styles; returns null when
 * ambiguous. Only the first line is parsed — multi-commodity totalQtyDisplay strings
 * (one line per commodity) are not split further.
 * @param {string | null | undefined} display
 * @returns {{ total: number, unit: string } | null}
 */
export function parseQtyDisplay(display) {
  if (!display || typeof display !== 'string') return null
  const line = display.split('\n')[0].trim()
  const m = line.match(/([\d.,]+)\s*([A-Za-z]+)?/)
  if (!m) return null
  let numStr = m[1]
  const seps = numStr.match(/[.,]/g) || []
  if (seps.length) {
    const lastSep = Math.max(numStr.lastIndexOf('.'), numStr.lastIndexOf(','))
    const trailing = numStr.length - lastSep - 1
    if (trailing === 3) {
      numStr = numStr.replace(/[.,]/g, '')
    } else {
      const intPart = numStr.slice(0, lastSep).replace(/[.,]/g, '')
      numStr = `${intPart}.${numStr.slice(lastSep + 1)}`
    }
  }
  const total = Number(numStr)
  if (!Number.isFinite(total) || total <= 0) return null
  return { total, unit: m[2] || 'MT' }
}

/**
 * Resolve cargo total qty + unit — prefer numeric SI breakdown qty (source of truth).
 * @param {{ cargoSiQty?: number|null, cargoSiMetric?: string|null, totalQtyDisplay?: string|null }} opts
 * @returns {{ total: number, unit: string } | null}
 */
export function resolveCargoQtyTotal({ cargoSiQty, cargoSiMetric, totalQtyDisplay } = {}) {
  const si = Number(cargoSiQty)
  if (Number.isFinite(si) && si > 0) {
    const unit = cargoSiMetric && String(cargoSiMetric).trim() ? String(cargoSiMetric).trim() : 'MT'
    return { total: si, unit }
  }
  return parseQtyDisplay(totalQtyDisplay)
}

/**
 * @param {number} n
 * @returns {string}
 */
export function formatQtyNumber(n) {
  return Math.round(n).toLocaleString('en-US')
}

/**
 * Average hourly loading/unloading rate: total logged qty divided by the number of hours
 * between the earliest logged Cargo Operations entry's start and the latest entry's end.
 * Purely data-driven — returns 0 when there is no logged qty or no logged time window yet
 * (e.g. nothing logged, or missing timestamps), never divides by zero.
 * @param {number | null | undefined} movedQty
 * @param {string | null | undefined} firstLoggedAt
 * @param {string | null | undefined} lastLoggedAt
 * @returns {number}
 */
export function computeCargoRatePerHour(movedQty, firstLoggedAt, lastLoggedAt) {
  const qty = Number(movedQty) || 0
  if (qty <= 0) return 0
  const startMs = firstLoggedAt ? new Date(firstLoggedAt).getTime() : NaN
  const endMs = lastLoggedAt ? new Date(lastLoggedAt).getTime() : NaN
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0
  const hours = (endMs - startMs) / 3600000
  return hours > 0 ? qty / hours : 0
}

/**
 * Prefer live ATG avgRateTph when available; otherwise derive from logged cargo window.
 * @param {{ avgRateTph?: number|null, movedQty?: number|null, firstLoggedAt?: string|null, lastLoggedAt?: string|null }} params
 * @returns {number}
 */
export function resolveCargoRatePerHour({
  avgRateTph,
  movedQty,
  firstLoggedAt,
  lastLoggedAt,
} = {}) {
  const fromApi = Number(avgRateTph)
  if (Number.isFinite(fromApi) && fromApi > 0) return fromApi
  return computeCargoRatePerHour(movedQty, firstLoggedAt, lastLoggedAt)
}

/**
 * Estimated time remaining to finish remaining cargo: balance / rate (hours → ms).
 * @returns {number|null}
 */
export function computeCargoEtrMs(balance, ratePerHour) {
  const b = Number(balance)
  const r = Number(ratePerHour)
  if (!Number.isFinite(b) || b <= 0 || !Number.isFinite(r) || r <= 0) return null
  return (b / r) * 3600000
}

/**
 * @param {number} balance
 * @param {number} ratePerHour
 * @param {(ms: number) => string|null|undefined} formatDurationFn
 * @param {string} [label]
 * @returns {string|null}
 */
export function formatCargoEtrLine(balance, ratePerHour, formatDurationFn, label = 'ETR') {
  const ms = computeCargoEtrMs(balance, ratePerHour)
  if (ms == null || typeof formatDurationFn !== 'function') return null
  const duration = formatDurationFn(ms)
  if (!duration) return null
  return `${label} ${duration}`
}

/**
 * @param {number} n
 * @returns {string}
 */
export function formatRateNumber(n) {
  const v = Number(n) || 0
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 })
}

/**
 * Compact avg-rate label for dashboards, e.g. "Avg 50 MT/h". Returns null when rate is missing.
 * @param {number | null | undefined} rate
 * @param {string | null | undefined} [unit]
 */
export function formatAvgFlowRateLabel(rate, unit = 'MT') {
  const v = Number(rate)
  if (!Number.isFinite(v) || v <= 0) return null
  const u = unit && String(unit).trim() ? String(unit).trim() : 'MT'
  return `Avg ${formatRateNumber(v)} ${u}/h`
}

export const formatAvgFlowRateLine = formatAvgFlowRateLabel

/**
 * Compute moved/total cargo progress from a totalQtyDisplay string and an actual moved
 * quantity (sum of logged cargo load lines). Purely data-driven: no fallback to
 * completion_percent or operation status, so 0 logged lines always shows as 0 moved.
 *
 * Exception: when a cargo segment has opened (`cargoFirstLoggedAt` set) but has neither
 * closed yet (`cargoLastLoggedAt` null) nor received a live ATG rate (`avgRateTph`), the
 * static `cargoMovedQty` snapshot is structurally unable to reflect an in-progress segment
 * (the backing DB aggregate only sums/maxes *closed* load lines — see
 * `Backend/src/routes/allocation.js` `cargo_agg`). In that window we don't yet know the real
 * moved qty, so we return `null` (pending) instead of asserting a confident "0 MT moved" that
 * is very likely stale/wrong once live data catches up.
 * @param {string | null | undefined} totalQtyDisplay
 * @param {number | null | undefined} cargoMovedQty
 * @param {string | null | undefined} [cargoFirstLoggedAt] earliest logged Cargo Operations entry's started_at
 * @param {string | null | undefined} [cargoLastLoggedAt] latest logged Cargo Operations entry's ended_at
 * @param {{ cargoSiQty?: number|null, cargoSiMetric?: string|null, avgRateTph?: number|null }} [qtyOpts]
 * @returns {{ qty: { total: number, unit: string }, done: number, balance: number, ratePerHour: number, etrMs: number|null, cargoLine: string, balanceLine: string, rateLine: string } | null}
 */
export function computeCargoProgress(
  totalQtyDisplay,
  cargoMovedQty,
  cargoFirstLoggedAt,
  cargoLastLoggedAt,
  qtyOpts = {}
) {
  const qty = resolveCargoQtyTotal({
    cargoSiQty: qtyOpts.cargoSiQty,
    cargoSiMetric: qtyOpts.cargoSiMetric,
    totalQtyDisplay,
  })
  if (!qty) return null
  const moved = Number(cargoMovedQty) || 0
  const hasLiveRate = Number(qtyOpts.avgRateTph) > 0
  const isPending = moved <= 0 && Boolean(cargoFirstLoggedAt) && !cargoLastLoggedAt && !hasLiveRate
  if (isPending) return null
  const done = Math.max(0, moved)
  const balance = Math.max(0, qty.total - moved)
  const ratePerHour = resolveCargoRatePerHour({
    avgRateTph: qtyOpts.avgRateTph,
    movedQty: moved,
    firstLoggedAt: cargoFirstLoggedAt,
    lastLoggedAt: cargoLastLoggedAt,
  })
  const etrMs = computeCargoEtrMs(balance, ratePerHour)
  return {
    qty,
    done,
    balance,
    ratePerHour,
    etrMs,
    cargoLine: `${formatQtyNumber(done)} ${qty.unit} / ${formatQtyNumber(qty.total)} ${qty.unit}`,
    balanceLine: balance > 0 ? `Balance ${formatQtyNumber(balance)} ${qty.unit}` : `Balance 0 ${qty.unit}`,
    rateLine: `Rate ${formatRateNumber(ratePerHour)} ${qty.unit} / Hour`,
  }
}

/**
 * Merge live at-berth cargo progress (ATG) into an overview/schematic vessel row.
 * @param {object|null|undefined} row
 * @param {object|null|undefined} liveSummary from GET /operations/at-berth/cargo-progress
 * @param {number} [nowMs]
 */
export function mergeLiveCargoProgressFields(row, liveSummary, nowMs = Date.now()) {
  if (!row || liveSummary?.movedQty == null) return row
  const isLive = Boolean(liveSummary?.isLive || liveSummary?.hasActiveCargo)
  return {
    ...row,
    cargoMovedQty: Number(liveSummary.movedQty) || 0,
    cargoSiQty: liveSummary.siQty != null ? Number(liveSummary.siQty) : row.cargoSiQty,
    cargoSiMetric: liveSummary.siMetric ?? row.cargoSiMetric ?? null,
    cargoLastLoggedAt:
      isLive && row.cargoFirstLoggedAt
        ? new Date(nowMs).toISOString()
        : row.cargoLastLoggedAt,
    scheduleComparison: liveSummary,
  }
}

/**
 * Apply mergeLiveCargoProgressFields across an array of rows (e.g. a Gantt's schedule list),
 * keyed by each row's operationId. Rows without a matching live summary pass through unchanged.
 * @param {Array<object>|null|undefined} rows
 * @param {Record<string, object>|null|undefined} cargoProgressByOpId
 * @param {number} [nowMs]
 * @returns {Array<object>}
 */
export function mergeLiveCargoProgressIntoRows(rows, cargoProgressByOpId, nowMs = Date.now()) {
  if (!Array.isArray(rows)) return rows ?? []
  if (!cargoProgressByOpId || !Object.keys(cargoProgressByOpId).length) return rows
  return rows.map((row) => {
    const opId = row?.operationId
    if (opId == null) return row
    const live = cargoProgressByOpId[String(opId)]
    if (!live) return row
    return mergeLiveCargoProgressFields(row, live, nowMs)
  })
}
