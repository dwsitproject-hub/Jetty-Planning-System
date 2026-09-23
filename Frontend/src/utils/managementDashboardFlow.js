/**
 * Pure flow KPIs for the Management Dashboard.
 * Wait-to-berth is a mean (TA → TB). Berth time stays a median (TB → cast-off).
 * Average flow rate is mean of per-voyage qty ÷ cargo-ops hours.
 */

export function median(a) {
  const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y)
  if (!s.length) return null
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function mean(a) {
  const s = a.filter((x) => x != null && Number.isFinite(x))
  if (!s.length) return null
  return s.reduce((sum, x) => sum + x, 0) / s.length
}

export function dedupSailedRows(rs) {
  const seen = new Set()
  return rs.filter((r) => {
    const k = `${r.vessel}|${r.tb}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export function voyageFlowRate(r) {
  if (!r || r.opsH == null || !(Number(r.opsH) > 0)) return null
  const qty = Number(r.qty) || 0
  return qty / r.opsH
}

function byPurpose(rows, purpose) {
  return rows.filter((r) => r.purpose === purpose)
}

function metricsFor(dd, sailed) {
  return {
    voyages: dd.length,
    throughput: sailed.reduce((s, r) => s + (Number(r.qty) || 0), 0),
    berth: median(dd.map((r) => r.berth)),
    wait: mean(dd.map((r) => r.wait)),
    rate: mean(dd.map(voyageFlowRate)),
  }
}

/**
 * @param {Array<object>} rows normalized operation rows
 */
export function computeFlow(rows) {
  const sailed = rows.filter((r) => r.status === 'SAILED' && r.castOff)
  const dd = dedupSailedRows(sailed)
  return {
    ...metricsFor(dd, sailed),
    loading: metricsFor(byPurpose(dd, 'Loading'), byPurpose(sailed, 'Loading')),
    unloading: metricsFor(byPurpose(dd, 'Unloading'), byPurpose(sailed, 'Unloading')),
    sailedRows: dd,
    allSailed: sailed,
  }
}
