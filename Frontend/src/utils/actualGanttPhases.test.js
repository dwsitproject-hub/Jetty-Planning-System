import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildActualPhases,
  formatPhaseDuration,
  phaseLayout,
  phaseTrackSegments,
  segmentTrackStyleFromMs,
  markerTrackPositions,
  canRenderSegmentedActualBar,
} from './actualGanttPhases.js'

const TB = '2026-06-20T08:00:00.000Z'
const START = '2026-06-22T10:00:00.000Z'
const OPS_END = '2026-06-25T16:00:00.000Z'
const CLEARANCE = '2026-06-28T14:00:00.000Z'
const NOW_AFTER_OPS = new Date('2026-06-26T12:00:00.000Z').getTime()
const WINDOW_START = new Date('2026-06-01T00:00:00.000Z').getTime()
const WINDOW_END = new Date('2026-07-01T00:00:00.000Z').getTime()

describe('formatPhaseDuration', () => {
  it('formats hours under 48h', () => {
    assert.equal(formatPhaseDuration(26 * 60 * 60 * 1000), '26h')
  })

  it('formats days and hours', () => {
    assert.equal(formatPhaseDuration((2 * 24 + 2) * 60 * 60 * 1000), '2d 2h')
  })
})

describe('buildActualPhases', () => {
  it('returns null when operational start missing', () => {
    assert.equal(buildActualPhases({ tbDateTime: TB }, NOW_AFTER_OPS), null)
  })

  it('builds three phases for complete voyage', () => {
    const model = buildActualPhases(
      {
        tbDateTime: TB,
        operationalStartDateTime: START,
        operationsCompletedDateTime: OPS_END,
        castOffDateTime: CLEARANCE,
        status: 'DOCKED',
      },
      NOW_AFTER_OPS
    )
    assert.ok(model)
    assert.equal(model.phases.length, 3)
    assert.equal(model.phases[0].kind, 'berthing')
    assert.equal(model.phases[1].kind, 'atBerthOps')
    assert.equal(model.phases[2].kind, 'clearance')
    assert.equal(model.barEndMs, new Date(CLEARANCE).getTime())
  })

  it('builds two phases when ops not completed yet', () => {
    const model = buildActualPhases(
      {
        tbDateTime: TB,
        operationalStartDateTime: START,
        status: 'IN_PROGRESS',
      },
      NOW_AFTER_OPS
    )
    assert.ok(model)
    assert.equal(model.phases.length, 2)
    assert.equal(model.phases[1].openEnd, true)
    assert.equal(model.phases[1].endMs, model.barEndMs)
    assert.ok(model.phases[1].endMs > new Date(START).getTime())
  })

  it('flags ETC overdue on atBerthOps when before ops end', () => {
    const model = buildActualPhases(
      {
        tbDateTime: TB,
        operationalStartDateTime: START,
        estimatedCompletionDateTime: '2026-06-24T08:00:00.000Z',
        status: 'IN_PROGRESS',
      },
      NOW_AFTER_OPS
    )
    assert.ok(model?.etcOverdue)
    assert.equal(model.etcOverduePhase, 'atBerthOps')
  })

  it('open-end extends only the active phase endMs, not berthing', () => {
    const model = buildActualPhases(
      {
        tbDateTime: TB,
        operationalStartDateTime: START,
        status: 'IN_PROGRESS',
      },
      NOW_AFTER_OPS
    )
    assert.ok(model)
    assert.equal(model.phases[0].openEnd, false)
    assert.equal(model.phases[0].endMs, new Date(START).getTime())
    assert.equal(model.phases[1].openEnd, true)
    assert.equal(model.phases[1].endMs, model.barEndMs)
  })

  it('berthing segment starts at TB timestamp (Warrior-style)', () => {
    const warriorTb = '2026-06-19T09:40:00.000Z'
    const startLoad = '2026-06-21T14:00:00.000Z'
    const model = buildActualPhases(
      {
        tbDateTime: warriorTb,
        operationalStartDateTime: startLoad,
        status: 'IN_PROGRESS',
      },
      new Date('2026-06-24T00:00:00.000Z').getTime()
    )
    assert.equal(model.phases[0].startMs, new Date(warriorTb).getTime())
    assert.equal(model.phases[0].endMs, new Date(startLoad).getTime())
    const windowStart = new Date('2026-06-01T00:00:00.000Z').getTime()
    const windowEnd = new Date('2026-07-01T00:00:00.000Z').getTime()
    const style = segmentTrackStyleFromMs(
      model.phases[0].startMs,
      model.phases[0].endMs,
      windowStart,
      windowEnd - windowStart
    )
    assert.ok(style)
    const expectedLeft = ((new Date(warriorTb).getTime() - windowStart) / (windowEnd - windowStart)) * 100
    assert.ok(Math.abs(parseFloat(style.left) - expectedLeft) < 0.01)
  })
})

describe('phaseTrackSegments', () => {
  it('clips phases to the Gantt window', () => {
    const model = buildActualPhases(
      {
        tbDateTime: TB,
        operationalStartDateTime: START,
        operationsCompletedDateTime: OPS_END,
        castOffDateTime: CLEARANCE,
        status: 'DOCKED',
      },
      NOW_AFTER_OPS
    )
    const narrowStart = new Date('2026-06-23T00:00:00.000Z').getTime()
    const narrowEnd = new Date('2026-06-27T00:00:00.000Z').getTime()
    const segments = phaseTrackSegments(model, narrowStart, narrowEnd)
    assert.equal(segments.length, 2)
    assert.equal(segments[0].kind, 'atBerthOps')
    assert.equal(segments[0].startMs, narrowStart)
    assert.equal(segments[1].kind, 'clearance')
  })

  it('returns empty when all phases fall outside the window', () => {
    const model = buildActualPhases(
      {
        tbDateTime: TB,
        operationalStartDateTime: START,
        operationsCompletedDateTime: OPS_END,
        castOffDateTime: CLEARANCE,
        status: 'DOCKED',
      },
      NOW_AFTER_OPS
    )
    const futureStart = new Date('2026-08-01T00:00:00.000Z').getTime()
    const futureEnd = new Date('2026-09-01T00:00:00.000Z').getTime()
    assert.equal(phaseTrackSegments(model, futureStart, futureEnd).length, 0)
  })

  it('marks first and last indices on clipped segments', () => {
    const model = buildActualPhases(
      {
        tbDateTime: TB,
        operationalStartDateTime: START,
        operationsCompletedDateTime: OPS_END,
        castOffDateTime: CLEARANCE,
        status: 'DOCKED',
      },
      NOW_AFTER_OPS
    )
    const segments = phaseTrackSegments(model, WINDOW_START, WINDOW_END)
    assert.equal(segments.length, 3)
    assert.equal(segments[0].isFirst, true)
    assert.equal(segments[0].isLast, false)
    assert.equal(segments[2].isFirst, false)
    assert.equal(segments[2].isLast, true)
  })
})

describe('segmentTrackStyleFromMs', () => {
  it('positions a segment as percentage of the visible window', () => {
    const totalMs = WINDOW_END - WINDOW_START
    const style = segmentTrackStyleFromMs(
      new Date(TB).getTime(),
      new Date(START).getTime(),
      WINDOW_START,
      totalMs
    )
    assert.ok(style)
    assert.ok(style.left.endsWith('%'))
    assert.ok(style.width.endsWith('%'))
    assert.ok(style.rawWidthPct > 0)
  })
})

describe('markerTrackPositions', () => {
  it('returns leftPct for each milestone', () => {
    const model = buildActualPhases(
      {
        tbDateTime: TB,
        operationalStartDateTime: START,
        operationsCompletedDateTime: OPS_END,
        castOffDateTime: CLEARANCE,
        status: 'DOCKED',
      },
      NOW_AFTER_OPS
    )
    const totalMs = WINDOW_END - WINDOW_START
    const markers = markerTrackPositions(model, WINDOW_START, totalMs)
    assert.ok(markers.length >= 3)
    assert.equal(markers[0].index, 0)
    assert.ok(markers[0].leftPct >= 0 && markers[0].leftPct <= 100)
  })
})

describe('canRenderSegmentedActualBar', () => {
  it('returns trackSegments when milestones valid', () => {
    const out = canRenderSegmentedActualBar(
      {
        tbDateTime: TB,
        operationalStartDateTime: START,
        operationsCompletedDateTime: OPS_END,
        castOffDateTime: CLEARANCE,
        status: 'DOCKED',
      },
      NOW_AFTER_OPS,
      WINDOW_START,
      WINDOW_END
    )
    assert.ok(out?.phaseModel)
    assert.ok(out.trackSegments.length >= 2)
  })

  it('returns null when start load missing', () => {
    assert.equal(
      canRenderSegmentedActualBar({ tbDateTime: TB }, NOW_AFTER_OPS, WINDOW_START, WINDOW_END),
      null
    )
  })
})

describe('phaseLayout', () => {
  it('computes left and width percentages', () => {
    const phases = [
      { key: 'a', startMs: 0, endMs: 50 },
      { key: 'b', startMs: 50, endMs: 100 },
    ]
    const layout = phaseLayout(phases, 0, 100)
    assert.equal(layout.length, 2)
    assert.equal(layout[0].leftPct, 0)
    assert.equal(layout[0].widthPct, 50)
    assert.equal(layout[1].leftPct, 50)
    assert.equal(layout[1].widthPct, 50)
  })
})
