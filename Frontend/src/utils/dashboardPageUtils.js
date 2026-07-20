import { formatDateDisplay } from './formatDateTimeDisplay'

export const AT_BERTH_PHASES = ['Pre-Checking', 'Operational', 'Post-Checking']
export const PHASE_EMOJI = { 'Pre-Checking': '📋', Operational: '⚙️', 'Post-Checking': '✅' }

/** Format a local Date to YYYY-MM-DD without UTC conversion. */
export function fmtLocalDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function getTodayRange() {
  const today = fmtLocalDate(new Date())
  return { startDate: today, endDate: today }
}

export function getMonthRange(monthOffset = 0) {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const last = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0)
  return { startDate: fmtLocalDate(first), endDate: fmtLocalDate(last) }
}

export function getRelativeRange(days) {
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - (days - 1))
  return { startDate: fmtLocalDate(start), endDate: fmtLocalDate(end) }
}

export function isTodayOnlyRange(startDate, endDate) {
  const today = fmtLocalDate(new Date())
  return startDate === endDate && startDate === today
}

export function parseDateLocal(isoDate) {
  if (!isoDate) return null
  const d = new Date(isoDate + 'T00:00:00')
  return Number.isNaN(d.getTime()) ? null : d
}

export function parseIso(value) {
  if (value == null || value === '') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatDurationHours(hours) {
  if (hours == null || !Number.isFinite(hours) || hours < 0) return '—'
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`
  if (hours >= 48) return `${(hours / 24).toFixed(1)}d`
  return `${hours.toFixed(1)}h`
}

export function median(values) {
  const arr = Array.isArray(values) ? values.filter((n) => Number.isFinite(n)).slice() : []
  if (arr.length === 0) return null
  arr.sort((a, b) => a - b)
  const mid = Math.floor(arr.length / 2)
  return arr.length % 2 === 1 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2
}

export function formatRelativeTime(iso, t) {
  const d = parseIso(iso)
  if (!d) return '—'
  const sec = Math.floor((Date.now() - d.getTime()) / 1000)
  if (sec < 60) return t('relativeJustNow')
  if (sec < 3600) return t('relativeMinutesAgo', { n: Math.floor(sec / 60) })
  if (sec < 86400) return t('relativeHoursAgo', { n: Math.floor(sec / 3600) })
  return t('relativeDaysAgo', { n: Math.floor(sec / 86400) })
}

export function phaseForCard(status) {
  const s = String(status || '')
  if (s === 'SIGNOFF_REQUESTED' || s === 'SIGNOFF_APPROVED') return null
  if (s === 'IN_PROGRESS') return 'Operational'
  if (s === 'POST_OPS') return 'Post-Checking'
  return 'Pre-Checking'
}

export function phaseForCardDetailed(op, detail) {
  const s = String(op?.status || '')
  if (s === 'SIGNOFF_REQUESTED' || s === 'SIGNOFF_APPROVED') return null
  if (s === 'POST_OPS') return 'Post-Checking'
  if (detail) {
    const postStarted = (detail.subs || []).some(
      (x) => x.phase === 'Post-Checking' && (x.startAt || x.occurredAt)
    )
    if (postStarted) return 'Post-Checking'
    const opsStarted = (detail.acts || []).some((a) => a.entryType === 'activity' && a.startAt)
    if (opsStarted) return 'Operational'
  }
  return phaseForCard(s)
}

export function formatDateRangeLabel(startDate, endDate) {
  const s = parseDateLocal(startDate)
  const e = parseDateLocal(endDate)
  if (!s || !e) return ''
  return `${formatDateDisplay(startDate)} – ${formatDateDisplay(endDate)}`
}

export function formatSlaCount(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}
