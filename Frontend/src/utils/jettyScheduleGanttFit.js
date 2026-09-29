/** Full-view “Fit all jetties”: share remaining viewport height across every lane row. */

export const GANTT_FIT_MIN_ROW_PX = 44
export const GANTT_FIT_HARD_MIN_ROW_PX = 28
export const GANTT_FIT_BAR_INSET_PX = 3
export const GANTT_FIT_TIGHT_BELOW_PX = 50
export const GANTT_FIT_MINI_BELOW_PX = 42

/**
 * @param {number} rowHeightPx
 * @returns {'full' | 'tight' | 'mini'}
 */
/**
 * Lowest row height that still lets every lane fit in the scrollport.
 * Comfortable floor is 44px; we only go lower when that would overflow.
 * @param {{ availableHeight: number, rowCount: number }} args
 */
export function resolveGanttFitRowMin({ availableHeight, rowCount }) {
  const n = Math.max(1, Number(rowCount) || 1)
  const available = Number(availableHeight)
  if (!Number.isFinite(available) || available <= 0) return GANTT_FIT_HARD_MIN_ROW_PX
  const even = Math.floor(available / n)
  return Math.max(GANTT_FIT_HARD_MIN_ROW_PX, Math.min(GANTT_FIT_MIN_ROW_PX, even))
}

export function resolveGanttFitDensity(rowHeightPx) {
  const h = Number(rowHeightPx)
  if (!Number.isFinite(h) || h < GANTT_FIT_MINI_BELOW_PX) return 'mini'
  if (h < GANTT_FIT_TIGHT_BELOW_PX) return 'tight'
  return 'full'
}

/**
 * Stretch a bar to fill its lane row. Overlapping bars overlay (same top/height)
 * instead of splitting an already-short fitted row — stacking is what made
 * 3A-01 / 3B-01 look like two 16px slivers.
 * `stackIndex` / `stackCount` are accepted so call sites stay unchanged.
 * @param {Record<string, unknown>} posStyle left/width from segmentTrackStyle
 * @param {number} [_stackIndex]
 * @param {number} [_stackCount]
 * @param {Record<string, unknown>} [extra]
 */
export function ganttBarFitStyle(posStyle, _stackIndex, _stackCount, extra = {}) {
  const inset = GANTT_FIT_BAR_INSET_PX
  return {
    ...posStyle,
    top: `${inset}px`,
    height: `calc(100% - ${inset * 2}px)`,
    minHeight: 0,
    ...extra,
  }
}
