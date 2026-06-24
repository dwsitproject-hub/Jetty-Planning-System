import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildActualPhases, formatPhaseDuration, phaseLayout, canRenderSegmentedActualBar } from './actualGanttPhases.js'

const TB = '2026-06-20T08:00:00.000Z'
const START = '2026-06-22T10:00:00.000Z'
const OPS_END = '2026-06-25T16:00:00.000Z'
const CLEARANCE = '2026-06-28T14:00:00.000Z'
const NOW_AFTER_OPS = new Date('2026-06-26T12:00:00.000Z').getTime()

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

  it('canRenderSegmentedActualBar returns layout when milestones valid', () => {
    const out = canRenderSegmentedActualBar(
      {
        tbDateTime: TB,
        operationalStartDateTime: START,
        operationsCompletedDateTime: OPS_END,
        castOffDateTime: CLEARANCE,
        status: 'DOCKED',
      },
      NOW_AFTER_OPS
    )
    assert.ok(out?.phaseModel)
    assert.ok(out.layout.length >= 2)
  })

  it('canRenderSegmentedActualBar returns null when start load missing', () => {
    assert.equal(canRenderSegmentedActualBar({ tbDateTime: TB }, NOW_AFTER_OPS), null)
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
