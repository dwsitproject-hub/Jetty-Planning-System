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
 * @param {number} n
 * @returns {string}
 */
export function formatRateNumber(n) {
  const v = Number(n) || 0
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 })
}

/**
 * Compute moved/total cargo progress from a totalQtyDisplay string and an actual moved
 * quantity (sum of logged cargo load lines). Purely data-driven: no fallback to
 * completion_percent or operation status, so 0 logged lines always shows as 0 moved.
 * @param {string | null | undefined} totalQtyDisplay
 * @param {number | null | undefined} cargoMovedQty
 * @param {string | null | undefined} [cargoFirstLoggedAt] earliest logged Cargo Operations entry's started_at
 * @param {string | null | undefined} [cargoLastLoggedAt] latest logged Cargo Operations entry's ended_at
 * @returns {{ qty: { total: number, unit: string }, done: number, ratePerHour: number, cargoLine: string, balanceLine: string, rateLine: string } | null}
 */
export function computeCargoProgress(totalQtyDisplay, cargoMovedQty, cargoFirstLoggedAt, cargoLastLoggedAt) {
  const qty = parseQtyDisplay(totalQtyDisplay)
  if (!qty) return null
  const moved = Number(cargoMovedQty) || 0
  const done = Math.max(0, Math.min(qty.total, moved))
  const ratePerHour = computeCargoRatePerHour(moved, cargoFirstLoggedAt, cargoLastLoggedAt)
  return {
    qty,
    done,
    ratePerHour,
    cargoLine: `${formatQtyNumber(done)} ${qty.unit} / ${formatQtyNumber(qty.total)} ${qty.unit}`,
    balanceLine: `Balance ${formatQtyNumber(qty.total - done)} ${qty.unit}`,
    rateLine: `Rate ${formatRateNumber(ratePerHour)} ${qty.unit} / Hour`,
  }
}
