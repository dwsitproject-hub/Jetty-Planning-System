/** Sticky jetty-id column width — matches `--jetty-schedule-id-col` in allocation.css */
export const JETTY_SCHEDULE_ID_COL_PX = 200

/** Gap between the sticky jetty-id column and a pinned long-bar label panel. */
export const GANTT_LONG_BAR_PIN_PADDING_PX = 6

/**
 * Horizontal translate for a long Gantt bar label so it stays just right of the jetty-id column
 * while the bar scrolls. Sticky CSS cannot do this inside absolutely positioned bars.
 * @returns {number} pixels to translate right (>= 0)
 */
export function computeGanttPinTranslateX({
  barViewportLeftPx,
  barWidthPx,
  pinWidthPx,
  idColWidthPx = JETTY_SCHEDULE_ID_COL_PX,
  pinPaddingPx = GANTT_LONG_BAR_PIN_PADDING_PX,
}) {
  if (!Number.isFinite(barViewportLeftPx) || !Number.isFinite(barWidthPx)) return 0
  const targetLeft = idColWidthPx + pinPaddingPx
  const shift = Math.max(0, targetLeft - barViewportLeftPx)
  const pinW = Number.isFinite(pinWidthPx) && pinWidthPx > 0 ? pinWidthPx : 0
  const maxShift = Math.max(0, barWidthPx - pinW - pinPaddingPx)
  return Math.min(shift, maxShift)
}

/** Apply translateX to every long-bar label pin inside a Gantt scroll container. */
export function applyGanttLongBarPinTransforms(scrollEl, { enabled = true } = {}) {
  if (!scrollEl) return
  const scrollRect = scrollEl.getBoundingClientRect()
  const pins = scrollEl.querySelectorAll('.jetty-schedule-gantt__bar--long .gantt-dense-block__pin')
  pins.forEach((pin) => {
    if (!enabled) {
      pin.style.transform = ''
      return
    }
    const bar = pin.closest('.jetty-schedule-gantt__bar--long')
    if (!bar) return
    const barRect = bar.getBoundingClientRect()
    const tx = computeGanttPinTranslateX({
      barViewportLeftPx: barRect.left - scrollRect.left,
      barWidthPx: barRect.width,
      pinWidthPx: pin.offsetWidth,
    })
    pin.style.transform = tx > 0 ? `translateX(${tx}px)` : ''
  })
}

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
