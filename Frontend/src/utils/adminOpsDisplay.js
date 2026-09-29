/** Display helpers for System Health Dashboard (admin ops checks). */

export const STATUS_ORDER = {
  unhealthy: 0,
  degraded: 1,
  unknown: 2,
  healthy: 3,
  disabled: 4,
}

export function sortChecksBySeverity(checks) {
  return [...(checks ?? [])].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)
  )
}

export function countChecksByStatus(checks) {
  const counts = { unhealthy: 0, degraded: 0, unknown: 0, healthy: 0, disabled: 0 }
  for (const c of checks ?? []) {
    if (counts[c.status] != null) counts[c.status] += 1
  }
  return counts
}

export function isNeedsAttention(status) {
  return status === 'unhealthy' || status === 'degraded' || status === 'unknown'
}

export function formatWhen(value) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export function formatRelativeTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  const t = d.getTime()
  if (Number.isNaN(t)) return '—'
  const sec = Math.round((Date.now() - t) / 1000)
  if (sec < 45) return 'just now'
  if (sec < 90) return '1 minute ago'
  if (sec < 3600) return `${Math.round(sec / 60)} minutes ago`
  if (sec < 7200) return '1 hour ago'
  if (sec < 86400) return `${Math.round(sec / 3600)} hours ago`
  if (sec < 172800) return '1 day ago'
  if (sec < 604800) return `${Math.round(sec / 86400)} days ago`
  if (sec < 1209600) return '1 week ago'
  return `${Math.round(sec / 604800)} weeks ago`
}

export function formatCount(n) {
  const num = Number(n)
  if (!Number.isFinite(num)) return '—'
  return num.toLocaleString()
}

export function shortBatchId(batchId) {
  if (!batchId || typeof batchId !== 'string') return '—'
  if (batchId.length <= 12) return batchId
  return `${batchId.slice(0, 8)}…`
}

export function statusBadgeClass(status) {
  switch (status) {
    case 'healthy':
      return 'admin-status-badge admin-status-badge--active'
    case 'degraded':
      return 'admin-status-badge admin-status-badge--warning'
    case 'unhealthy':
      return 'admin-status-badge admin-status-badge--error'
    case 'unknown':
      return 'admin-status-badge admin-status-badge--unknown'
    case 'disabled':
      return 'admin-status-badge admin-status-badge--inactive'
    default:
      return 'admin-status-badge admin-status-badge--inactive'
  }
}

export function cardStatusClass(status) {
  switch (status) {
    case 'healthy':
      return 'admin-ops-card--healthy'
    case 'degraded':
      return 'admin-ops-card--degraded'
    case 'unhealthy':
      return 'admin-ops-card--unhealthy'
    case 'unknown':
      return 'admin-ops-card--unknown'
    case 'disabled':
      return 'admin-ops-card--disabled'
    default:
      return 'admin-ops-card--unknown'
  }
}

export function heroStatusClass(status) {
  switch (status) {
    case 'healthy':
      return 'admin-ops-hero--healthy'
    case 'degraded':
      return 'admin-ops-hero--degraded'
    case 'unhealthy':
      return 'admin-ops-hero--unhealthy'
    default:
      return 'admin-ops-hero--unknown'
  }
}
