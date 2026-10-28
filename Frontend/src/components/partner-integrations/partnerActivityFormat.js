export const WINDOW_PRESETS = [
  { hours: 1, label: '1h' },
  { hours: 24, label: '24h' },
  { hours: 168, label: '7d' },
  { hours: 720, label: '30d' },
]

export const DEFAULT_WINDOW_HOURS = 24
/** A pending webhook older than this is highlighted (worker not keeping up). */
export const PENDING_STALE_MS = 2 * 60 * 1000

export function formatWhen(value) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export function formatDuration(ms) {
  if (ms == null) return '—'
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

const RELATIVE_UNITS = [
  { unit: 'second', seconds: 1, max: 60 },
  { unit: 'minute', seconds: 60, max: 3600 },
  { unit: 'hour', seconds: 3600, max: 86400 },
  { unit: 'day', seconds: 86400, max: Infinity },
]

/** "2 minutes ago" in the UI language; null when there is no timestamp. */
export function relativeTime(iso, locale, nowMs = Date.now()) {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const diffSec = Math.round((then - nowMs) / 1000)
  const abs = Math.abs(diffSec)
  const { unit, seconds } = RELATIVE_UNITS.find((u) => abs < u.max)
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(diffSec / seconds), unit)
}

export function webhookStatusBadgeClass(status) {
  if (status === 'sent') return 'admin-status-badge admin-status-badge--active'
  if (status === 'failed') return 'admin-status-badge admin-status-badge--error'
  return 'admin-status-badge admin-status-badge--warning'
}

export function httpStatusBadgeClass(code) {
  if (code == null) return 'admin-status-badge admin-status-badge--inactive'
  if (code < 400) return 'admin-status-badge admin-status-badge--active'
  if (code < 500) return 'admin-status-badge admin-status-badge--warning'
  return 'admin-status-badge admin-status-badge--error'
}

export function isPendingStale(item, nowMs = Date.now()) {
  if (item.status !== 'pending') return false
  const created = new Date(item.createdAt).getTime()
  return !Number.isNaN(created) && nowMs - created > PENDING_STALE_MS
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    window.prompt('Copy', text)
    return false
  }
}
