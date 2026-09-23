import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeScrollLeftToCenterDay,
  computeTodayDayIndex,
  scrollGanttContainerToToday,
  JETTY_SCHEDULE_ID_COL_PX,
} from './jettyScheduleGanttScroll.js'

describe('computeScrollLeftToCenterDay', () => {
  const idCol = JETTY_SCHEDULE_ID_COL_PX
  const dayCol = 72

  it('centers a mid-month day column', () => {
    const dayIndex = 14
    const viewport = 800
    const targetCenter = idCol + dayIndex * dayCol + dayCol / 2
    const expected = targetCenter - viewport / 2
    assert.equal(
      computeScrollLeftToCenterDay({
        dayIndex,
        idColWidthPx: idCol,
        dayColWidthPx: dayCol,
        viewportWidthPx: viewport,
        maxScrollLeftPx: 5000,
      }),
      expected
    )
  })

  it('clamps at scroll start for early-month days', () => {
    assert.equal(
      computeScrollLeftToCenterDay({
        dayIndex: 0,
        idColWidthPx: idCol,
        dayColWidthPx: dayCol,
        viewportWidthPx: 800,
        maxScrollLeftPx: 5000,
      }),
      0
    )
  })

  it('clamps at max scroll for late-month days', () => {
    const maxScroll = 1200
    const scrollLeft = computeScrollLeftToCenterDay({
      dayIndex: 29,
      idColWidthPx: idCol,
      dayColWidthPx: dayCol,
      viewportWidthPx: 800,
      maxScrollLeftPx: maxScroll,
    })
    assert.equal(scrollLeft, maxScroll)
  })

  it('returns null for invalid day index', () => {
    assert.equal(
      computeScrollLeftToCenterDay({
        dayIndex: -1,
        viewportWidthPx: 800,
      }),
      null
    )
    assert.equal(
      computeScrollLeftToCenterDay({
        dayIndex: NaN,
        viewportWidthPx: 800,
      }),
      null
    )
  })
})

describe('computeTodayDayIndex', () => {
  it('returns day offset within the window', () => {
    const windowStart = new Date(2026, 8, 1).getTime()
    const windowEnd = new Date(2026, 9, 1).getTime()
    const now = new Date(2026, 8, 23, 15, 30).getTime()
    assert.equal(computeTodayDayIndex(windowStart, windowEnd, now), 22)
  })

  it('returns null when today is outside the window', () => {
    const windowStart = new Date(2026, 9, 1).getTime()
    const windowEnd = new Date(2026, 10, 1).getTime()
    const now = new Date(2026, 8, 23).getTime()
    assert.equal(computeTodayDayIndex(windowStart, windowEnd, now), null)
  })
})

describe('scrollGanttContainerToToday', () => {
  it('returns false when the container has no width (hidden tab)', () => {
    const el = { clientWidth: 0, scrollWidth: 1000, scrollLeft: 0 }
    const windowStart = new Date(2026, 8, 1).getTime()
    const windowEnd = new Date(2026, 9, 1).getTime()
    const now = new Date(2026, 8, 23).getTime()
    assert.equal(
      scrollGanttContainerToToday(el, { windowStartMs: windowStart, windowEndMs: windowEnd, nowMs: now }),
      false
    )
    assert.equal(el.scrollLeft, 0)
  })

  it('sets scrollLeft when the container is visible', () => {
    const el = { clientWidth: 800, scrollWidth: 3000, scrollLeft: 0 }
    const windowStart = new Date(2026, 8, 1).getTime()
    const windowEnd = new Date(2026, 9, 1).getTime()
    const now = new Date(2026, 8, 23).getTime()
    assert.equal(
      scrollGanttContainerToToday(el, { windowStartMs: windowStart, windowEndMs: windowEnd, nowMs: now }),
      true
    )
    assert.ok(el.scrollLeft > 0)
  })
})
