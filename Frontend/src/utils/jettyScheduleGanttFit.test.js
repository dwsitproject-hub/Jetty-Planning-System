import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  GANTT_FIT_BAR_INSET_PX,
  GANTT_FIT_HARD_MIN_ROW_PX,
  GANTT_FIT_MAX_ROW_PX,
  GANTT_FIT_MIN_ROW_PX,
  ganttBarFitStyle,
  resolveGanttFitDensity,
  resolveGanttFitRowMin,
} from './jettyScheduleGanttFit.js'

describe('resolveGanttFitRowMin', () => {
  it('shares leftover height equally up to the 72px cap', () => {
    assert.equal(resolveGanttFitRowMin({ availableHeight: 700, rowCount: 11 }), 63)
  })

  it('caps at 72px so few jetties do not stretch into giant bars', () => {
    assert.equal(resolveGanttFitRowMin({ availableHeight: 900, rowCount: 5 }), GANTT_FIT_MAX_ROW_PX)
  })

  it('lowers the floor just enough so all rows share the viewport', () => {
    assert.equal(resolveGanttFitRowMin({ availableHeight: 407, rowCount: 11 }), 37)
  })

  it('does not shrink below the hard readable minimum', () => {
    assert.equal(resolveGanttFitRowMin({ availableHeight: 200, rowCount: 11 }), GANTT_FIT_HARD_MIN_ROW_PX)
    assert.equal(resolveGanttFitRowMin({ availableHeight: 0, rowCount: 4 }), GANTT_FIT_HARD_MIN_ROW_PX)
  })
})

describe('resolveGanttFitDensity', () => {
  it('keeps the 3-row card when the fitted row is tall enough', () => {
    assert.equal(resolveGanttFitDensity(72), 'full')
    assert.equal(resolveGanttFitDensity(50), 'full')
  })

  it('drops the volume row when the fitted row is mid-height', () => {
    assert.equal(resolveGanttFitDensity(49), 'tight')
    assert.equal(resolveGanttFitDensity(42), 'tight')
  })

  it('keeps vessel + product only on very short rows', () => {
    assert.equal(resolveGanttFitDensity(41), 'mini')
    assert.equal(resolveGanttFitDensity(GANTT_FIT_MIN_ROW_PX), 'tight')
    assert.equal(resolveGanttFitDensity(Number.NaN), 'mini')
  })
})

describe('ganttBarFitStyle', () => {
  const pos = { left: '10%', width: '20%' }

  it('fills the lane with a 3px inset', () => {
    assert.deepEqual(ganttBarFitStyle(pos, 0, 1), {
      left: '10%',
      width: '20%',
      top: `${GANTT_FIT_BAR_INSET_PX}px`,
      height: 'calc(100% - 6px)',
      minHeight: 0,
    })
  })

  it('overlays overlapping bars at the same height instead of splitting the row', () => {
    const second = ganttBarFitStyle(pos, 1, 2, { '--etc-overdue-start': '40%' })
    assert.equal(second.top, `${GANTT_FIT_BAR_INSET_PX}px`)
    assert.equal(second.height, 'calc(100% - 6px)')
    assert.equal(second['--etc-overdue-start'], '40%')
  })
})
