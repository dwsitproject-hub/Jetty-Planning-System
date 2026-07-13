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
 * Compute moved/total cargo progress from a totalQtyDisplay string and an actual moved
 * quantity (sum of logged cargo load lines). Purely data-driven: no fallback to
 * completion_percent or operation status, so 0 logged lines always shows as 0 moved.
 * @param {string | null | undefined} totalQtyDisplay
 * @param {number | null | undefined} cargoMovedQty
 * @returns {{ qty: { total: number, unit: string }, done: number, cargoLine: string, balanceLine: string } | null}
 */
export function computeCargoProgress(totalQtyDisplay, cargoMovedQty) {
  const qty = parseQtyDisplay(totalQtyDisplay)
  if (!qty) return null
  const moved = Number(cargoMovedQty) || 0
  const done = Math.max(0, Math.min(qty.total, moved))
  return {
    qty,
    done,
    cargoLine: `${formatQtyNumber(done)} ${qty.unit} / ${formatQtyNumber(qty.total)} ${qty.unit}`,
    balanceLine: `Balance ${formatQtyNumber(qty.total - done)} ${qty.unit}`,
  }
}
