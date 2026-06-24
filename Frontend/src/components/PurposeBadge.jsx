import '../styles/purpose-badge.css'
import { resolvePurposeLabel } from '../utils/resolvePurposeLabel.js'

export { resolvePurposeLabel }

/**
 * Same visual as At-Berth: green Loading, blue Unloading.
 * Optionally pass loadDischarge when purpose string is empty (allocation rows).
 * @param {{ purpose?: string, loadDischarge?: string, abbrev?: boolean }} props
 */
export default function PurposeBadge({ purpose, loadDischarge, abbrev = false }) {
  const p = resolvePurposeLabel(purpose, loadDischarge)
  if (!p) return <>—</>
  if (p !== 'Loading' && p !== 'Unloading') return <>{p}</>
  const label = abbrev ? (p === 'Loading' ? 'LDG' : 'ULD') : p
  return (
    <span
      className="loading-list__badge loading-list__badge--purpose"
      data-purpose={p}
      title={abbrev ? p : undefined}
    >
      {label}
    </span>
  )
}
