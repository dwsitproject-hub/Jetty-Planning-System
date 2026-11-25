import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { voyageTimeSegments } from './managementDashboardVesselCharts.js'

describe('voyageTimeSegments', () => {
  const row = { purpose: 'Loading', wait: 48, pre: 6, opsH: 20, berth: 40, cargoDoneToSailH: 5 }

  it('lists the stages of a voyage in order, loading colour on the cargo stage', () => {
    const { segs, total } = voyageTimeSegments(row, false)
    assert.deepEqual(segs.map((s) => s.key), ['wait', 'pre', 'ops', 'idle', 'post'])
    assert.equal(segs.find((s) => s.key === 'ops').cls, 'wf-load')
    assert.equal(segs.find((s) => s.key === 'wait').v, 48)
    assert.equal(total, segs.reduce((s, x) => s + x.v, 0))
  })

  it('leaves out stages with no time', () => {
    const { segs } = voyageTimeSegments({ purpose: 'Unloading', wait: 10, pre: null, opsH: 12, berth: 12 }, false)
    assert.ok(!segs.some((s) => s.key === 'pre'))
    assert.equal(segs.find((s) => s.key === 'ops').cls, 'wf-disch')
  })
})
