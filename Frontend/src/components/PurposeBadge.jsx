import '../styles/purpose-badge.css'
import { resolvePurposeLabel } from '../utils/resolvePurposeLabel.js'

export { resolvePurposeLabel }

/**
 * Same visual as At-Berth: green Loading, blue Unloading.
 * Optionally pass loadDischarge when purpose string is empty (allocation rows).
 * @param {{ purpose?: string, loadDischarge?: string, abbrev?: boolean, short?: 'gantt' }} props
 */
export default function PurposeBadge({ purpose, loadDischarge, abbrev = false, short }) {
  const p = resolvePurposeLabel(purpose, loadDischarge)
  if (!p) return <>—</>
  if (p !== 'Loading' && p !== 'Unloading') return <>{p}</>
  let label = p
  if (short === 'gantt') {
    label = p === 'Loading' ? 'Load' : 'Unload'
  } else if (abbrev) {
    label = p === 'Loading' ? 'LDG' : 'ULD'
  }
  return (
    <span
      className="loading-list__badge loading-list__badge--purpose"
      data-purpose={p}
      title={short === 'gantt' || abbrev ? p : undefined}
    >
      {label}
    </span>
  )
}
