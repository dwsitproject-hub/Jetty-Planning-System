import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  getBerthPurposeTone,
  getNeedsUpdateReasons,
  getRailReasons,
  isRailEligible,
  canScheduleRailRow,
  buildRailRows,
} from './berthColorState.js'

describe('getBerthPurposeTone', () => {
  it('maps Loading to load and Unloading to unload', () => {
    assert.equal(getBerthPurposeTone('Loading'), 'load')
    assert.equal(getBerthPurposeTone('unloading'), 'unload')
  })

  it('falls back to loadDischarge when purpose is empty', () => {
    assert.equal(getBerthPurposeTone('', 'LOAD'), 'load')
    assert.equal(getBerthPurposeTone(null, 'DISCH'), 'unload')
  })

  it('is neutral for unknown or missing purpose', () => {
    assert.equal(getBerthPurposeTone('Bunkering'), 'neutral')
    assert.equal(getBerthPurposeTone(null, null), 'neutral')
  })
})

describe('getNeedsUpdateReasons', () => {
  it('flags an empty ETC', () => {
    assert.deepEqual(getNeedsUpdateReasons({ missingEtc: true }), ['emptyEtc'])
  })

  it('flags ETC passed only when no actual completion is recorded', () => {
    assert.deepEqual(getNeedsUpdateReasons({ etcOverdue: true, actualCompMs: null }), ['etcPassed'])
    assert.deepEqual(getNeedsUpdateReasons({ etcOverdue: true, actualCompMs: 1 }), [])
  })

  it('returns nothing for a sailed vessel', () => {
    assert.deepEqual(
      getNeedsUpdateReasons({ missingEtc: true, etcOverdue: true, isSailed: true }),
      []
    )
  })

  it('returns nothing when the data is up to date', () => {
    assert.deepEqual(getNeedsUpdateReasons({}), [])
    assert.deepEqual(getNeedsUpdateReasons(), [])
  })
})

const planOnly = (overrides = {}) => ({
  shipmentPlanId: 14,
  operationId: null,
  source: 'incoming-plan',
  vesselName: 'MV Alpha',
  ...overrides,
})

describe('getRailReasons', () => {
  it('reports no jetty and no ETB', () => {
    assert.deepEqual(getRailReasons(planOnly()), ['noJetty', 'noEtb'])
  })

  it('reports only the missing piece', () => {
    assert.deepEqual(getRailReasons(planOnly({ jetty: '2A' })), ['noEtb'])
    assert.deepEqual(getRailReasons(planOnly({ etbDateTime: '2026-07-01T10:00:00Z' })), ['noJetty'])
  })

  it('reports nothing when jetty and ETB are both set', () => {
    assert.deepEqual(
      getRailReasons(planOnly({ jetty: '2A', plannedEtbDateTime: '2026-07-01T10:00:00Z' })),
      []
    )
  })
})

describe('isRailEligible', () => {
  it('includes a new plan with no jetty and no ETB', () => {
    assert.equal(isRailEligible(planOnly()), true)
  })

  it('includes a vessel with a jetty but no ETB', () => {
    assert.equal(isRailEligible(planOnly({ jetty: '2A' })), true)
  })

  it('includes a vessel with an ETB but no jetty', () => {
    assert.equal(isRailEligible(planOnly({ etbDateTime: '2026-07-01T10:00:00Z' })), true)
  })

  it('excludes a vessel that has jetty and ETB even when ETC is empty', () => {
    assert.equal(
      isRailEligible(planOnly({ jetty: '2A', etbDateTime: '2026-07-01T10:00:00Z' })),
      false
    )
  })

  it('excludes berthed, sailed, and shifting-out vessels', () => {
    assert.equal(isRailEligible(planOnly({ tbDateTime: '2026-07-01T11:00:00Z' })), false)
    assert.equal(isRailEligible(planOnly({ status: 'SAILED' })), false)
    assert.equal(isRailEligible(planOnly({ shiftingOut: true })), false)
    assert.equal(
      isRailEligible({ operationId: 9, shipmentPlanId: 14, status: 'DOCKED' }),
      false
    )
  })

  it('handles null safely', () => {
    assert.equal(isRailEligible(null), false)
  })
})

describe('canScheduleRailRow', () => {
  it('needs an operation or a shipment plan to save', () => {
    assert.equal(canScheduleRailRow(planOnly()), true)
    assert.equal(canScheduleRailRow({ operationId: 9 }), true)
    assert.equal(canScheduleRailRow({ vesselName: 'x' }), false)
    assert.equal(canScheduleRailRow(null), false)
  })
})

describe('buildRailRows', () => {
  it('keeps only eligible rows, one per plan, earliest ETA first, no ETA last', () => {
    const rows = [
      planOnly({ shipmentPlanId: 1, vesselName: 'No ETA' }),
      planOnly({ shipmentPlanId: 2, vesselName: 'Late', etaDateTime: '2026-07-05T00:00:00Z' }),
      planOnly({ shipmentPlanId: 3, vesselName: 'Early', etaDateTime: '2026-07-02T00:00:00Z' }),
      planOnly({ shipmentPlanId: 3, vesselName: 'Early duplicate' }),
      planOnly({
        shipmentPlanId: 4,
        vesselName: 'On plan',
        jetty: '1A',
        etbDateTime: '2026-07-03T00:00:00Z',
      }),
    ]
    assert.deepEqual(
      buildRailRows(rows).map((r) => r.vesselName),
      ['Early', 'Late', 'No ETA']
    )
  })

  it('handles non-array input', () => {
    assert.deepEqual(buildRailRows(null), [])
  })
})
