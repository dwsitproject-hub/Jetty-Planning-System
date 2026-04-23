import '../styles/purpose-badge.css'

/** Normalize for badges, filters, and sort (Allocation may only set loadDischarge). */
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

/**
 * Same visual as At-Berth: green Loading, blue Unloading.
 * Optionally pass loadDischarge when purpose string is empty (allocation rows).
 */
export default function PurposeBadge({ purpose, loadDischarge }) {
  const p = resolvePurposeLabel(purpose, loadDischarge)
  if (!p) return <>—</>
  if (p !== 'Loading' && p !== 'Unloading') return <>{p}</>
  return (
    <span className="loading-list__badge loading-list__badge--purpose" data-purpose={p}>
      {p}
    </span>
  )
}
