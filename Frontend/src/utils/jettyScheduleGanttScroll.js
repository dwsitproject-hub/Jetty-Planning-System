/** Sticky jetty-id column width — matches `--jetty-schedule-id-col` in allocation.css */
export const JETTY_SCHEDULE_ID_COL_PX = 200

const MS_PER_DAY = 86400000

/**
 * 0-based day column index for local midnight of `nowMs` within a Gantt window.
 * @returns {number|null} null when today falls outside the window
 */
export function computeTodayDayIndex(windowStartMs, windowEndMs, nowMs) {
  if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || !Number.isFinite(nowMs)) {
    return null
  }
  if (nowMs < windowStartMs || nowMs >= windowEndMs) return null
  const startOfToday = new Date(nowMs)
  startOfToday.setHours(0, 0, 0, 0)
  const dayIndex = Math.floor((startOfToday.getTime() - windowStartMs) / MS_PER_DAY)
  return dayIndex >= 0 ? dayIndex : null
}

/**
 * Horizontal scroll offset that centers a day column in the Gantt viewport.
 * @returns {number|null} null when inputs are invalid
 */
export function computeScrollLeftToCenterDay({
  dayIndex,
  idColWidthPx = JETTY_SCHEDULE_ID_COL_PX,
  dayColWidthPx = 72,
  viewportWidthPx,
  maxScrollLeftPx = 0,
}) {
  if (!Number.isFinite(dayIndex) || dayIndex < 0) return null
  if (!Number.isFinite(viewportWidthPx) || viewportWidthPx <= 0) return null
  if (!Number.isFinite(idColWidthPx) || idColWidthPx < 0) return null
  if (!Number.isFinite(dayColWidthPx) || dayColWidthPx <= 0) return null

  const targetCenter = idColWidthPx + dayIndex * dayColWidthPx + dayColWidthPx / 2
  const raw = targetCenter - viewportWidthPx / 2
  const maxScroll = Number.isFinite(maxScrollLeftPx) && maxScrollLeftPx > 0 ? maxScrollLeftPx : 0
  return Math.max(0, Math.min(maxScroll, raw))
}

/**
 * Apply centered-today scroll on a Gantt scroll container.
 * @returns {boolean} true when scrollLeft was applied
 */
export function scrollGanttContainerToToday(
  el,
  {
    windowStartMs,
    windowEndMs,
    nowMs,
    idColWidthPx = JETTY_SCHEDULE_ID_COL_PX,
    dayColWidthPx = 72,
  } = {}
) {
  if (!el || el.clientWidth <= 0) return false
  const dayIndex = computeTodayDayIndex(windowStartMs, windowEndMs, nowMs)
  if (dayIndex == null) return false
  const scrollLeft = computeScrollLeftToCenterDay({
    dayIndex,
    idColWidthPx,
    dayColWidthPx,
    viewportWidthPx: el.clientWidth,
    maxScrollLeftPx: Math.max(0, el.scrollWidth - el.clientWidth),
  })
  if (scrollLeft == null) return false
  el.scrollLeft = scrollLeft
  return true
}
