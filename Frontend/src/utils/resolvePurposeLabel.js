/** Normalize purpose for badges, filters, Gantt labels, and sort. */
export function resolvePurposeLabel(purpose, loadDischarge) {
  const raw = (purpose ?? '').toString().trim()
  if (raw) {
    const lower = raw.toLowerCase()
    if (lower === 'loading') return 'Loading'
    if (lower === 'unloading') return 'Unloading'
    return raw
  }
  if (loadDischarge === 'LOAD') return 'Loading'
  if (loadDischarge === 'DISCH') return 'Unloading'
  return ''
}
