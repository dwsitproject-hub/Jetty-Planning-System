/** Official SI number for printed form: stored reference, else legacy synthetic. */
export function getPrintedSiNumber(si) {
  if (!si) return '—'
  if (si.referenceNumber) return si.referenceNumber
  const raw = (si.siId || si.id || '003').toString()
  const id = raw.replace(/\D/g, '') || '003'
  const y = new Date().getFullYear()
  return `SI/EUP/${y}/1/${id.padStart(3, '0')}`
}

/** Freight line: prefer freight_terms field, then Incoterm heuristic. */
export function formatFreightForSi(si) {
  if (!si) return '—'
  if (si.freightTerms) {
    const m = {
      PREPAID: 'PREPAID',
      COLLECT: 'COLLECT',
      AS_PER_CHARTER_PARTY: 'AS PER CHARTER PARTY',
      OTHER: 'OTHER',
    }
    return m[si.freightTerms] || String(si.freightTerms).replace(/_/g, ' ')
  }
  if (si.term === 'CIF') return 'PREPAID'
  return si.term || '—'
}

/**
 * Human-readable B/L split line from SI breakdown rows (e.g. "1 × 4,000 MT" or multi-line).
 * @param {{ qty?: unknown, metricCode?: string }[]} breakdown
 */
export function formatBlSplitFromBreakdown(breakdown) {
  const rows = Array.isArray(breakdown) ? breakdown : []
  if (rows.length === 0) return '—'
  const parts = rows.map((r) => {
    const q = r.qty != null && r.qty !== '' ? Number(r.qty) : NaN
    const m = (r.metricCode || '?').toUpperCase()
    if (Number.isNaN(q)) return null
    return `${q.toLocaleString('id-ID')} ${m}`
  }).filter(Boolean)
  if (parts.length === 0) return `${rows.length} line(s)`
  if (parts.length === 1) return `1 × ${parts[0]}`
  return parts.map((p, i) => `${i + 1} × ${p}`).join(' · ')
}
