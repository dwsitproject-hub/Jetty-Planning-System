/**
 * Stops and delays report: colours, labels, the vessel × reason table and the period of the
 * Management Dashboard / report page as API instants.
 */

export const CATEGORY_ORDER = ['terminal', 'vessel', 'kuras_crew', 'external', 'other']
export const CATEGORY_COLORS = {
  terminal: '#1D9E75',
  vessel: '#7F77DD',
  kuras_crew: '#378ADD',
  external: '#D85A30',
  other: '#888780',
}
export const API_MAX_DAYS = 366
const DAY_MS = 86400000

/** Reason label in the app language. */
export function reportReasonLabel(reason, language) {
  const en = reason?.nameEn ?? reason?.reasonNameEn ?? ''
  const id = reason?.nameId ?? reason?.reasonNameId ?? ''
  return String(language || '').startsWith('id') ? id || en : en || id
}

/**
 * Vessel × reason hours (Tj Pura fleet table): columns follow the biggest reasons first.
 * @returns {{ columns: Array<{ code: string, label: string, category: string, total: number }>,
 *   rows: Array<{ operationId: number, vessel: string|null, jetty: string|null, cells: Record<string, number>, total: number }>,
 *   grandTotal: number }}
 */
export function buildVesselReasonMatrix(report, language) {
  const columns = (report?.byReason || []).map((r) => ({
    code: r.code, label: reportReasonLabel(r, language), category: r.category, total: r.hours,
  }))
  const rows = (report?.byVoyage || []).map((v) => ({
    operationId: v.operationId, vessel: v.vessel, jetty: v.jetty, cells: v.byReason || {}, total: v.totalHours,
  }))
  return { columns, rows, grandTotal: report?.summary?.stopHours ?? 0 }
}

/**
 * Dashboard period → API instants. "All data" and very long periods are limited to the API maximum.
 * @param {{ start: number|null, end: number|null }} win
 */
export function dashboardWindowToRange(win, nowMs = Date.now()) {
  const to = win?.end != null ? Math.min(win.end, nowMs) : nowMs
  const earliest = to - API_MAX_DAYS * DAY_MS
  const from = win?.start != null ? Math.max(win.start, earliest) : earliest
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() }
}

/** Local date inputs (YYYY-MM-DD) → API instants; the end day is included. */
export function dateInputsToRange(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00`)
  const to = new Date(`${toDate}T00:00:00`)
  to.setDate(to.getDate() + 1)
  return { from: from.toISOString(), to: to.toISOString() }
}

/** Date input value (local) for an instant. */
export function toDateInput(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
