/** Helpers for the "Recover ATG readings" dialog on System Health. */

const MINUTE_MS = 60000
const MAX_RANGE_MS = 7 * 24 * 60 * MINUTE_MS - 10 * MINUTE_MS

/** Sources with a remaining gap (or silent now) can be recovered; live and recovered ones cannot. */
export function defaultRecoveryRange(coverage, nowMs = Date.now()) {
  const gaps = coverage?.gaps ?? []
  if (!['gap', 'silent'].includes(coverage?.status) || !gaps.length) return null
  const gap = gaps[gaps.length - 1]
  const endMs = Math.min(new Date(gap.endAt).getTime(), nowMs)
  return { startAt: gap.startAt, endAt: new Date(endMs).toISOString() }
}

const pad = (n) => String(n).padStart(2, '0')

/** ISO instant → value for <input type="datetime-local"> in the browser's timezone. */
export function toDatetimeLocal(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** <input type="datetime-local"> value → ISO instant, or null when empty/invalid. */
export function fromDatetimeLocal(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** @returns {'invalid'|'order'|'too_long'|null} */
export function validateRecoveryRange(startIso, endIso) {
  if (!startIso || !endIso) return 'invalid'
  const span = new Date(endIso).getTime() - new Date(startIso).getTime()
  if (!(span > 0)) return 'order'
  if (span > MAX_RANGE_MS) return 'too_long'
  return null
}

/** Cargo entries that read each tank, keyed by tank code, for the preview table. */
export function entriesByTankCode(usedBy) {
  const map = new Map()
  for (const entry of usedBy ?? []) {
    for (const code of entry.tankCodes ?? []) {
      if (!map.has(code)) map.set(code, [])
      map.get(code).push(entry)
    }
  }
  return map
}
