import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_BERTH_TAIL_MS,
  getBerthPlanEndMs,
  getBerthPlanStartMs,
  intervalsOverlap,
  isBerthPlanMissingEtc,
  validateBerthPlanJettyAssignment,
} from './berthPlanInterval.js'

const ETB_A = new Date('2026-06-10T08:00:00').toISOString()
const ETC_A = new Date('2026-06-15T18:00:00').toISOString()
const ETB_B = new Date('2026-06-12T10:00:00').toISOString()
const ETB_C = new Date('2026-06-20T08:00:00').toISOString()

describe('berthPlanInterval', () => {
  it('getBerthPlanStartMs prefers TB over ETB and ignores ETA', () => {
    assert.equal(
      getBerthPlanStartMs({ tbDateTime: ETB_A, etbDateTime: ETB_B, etaDateTime: ETB_C }),
      new Date(ETB_A).getTime()
    )
    assert.equal(getBerthPlanStartMs({ etaDateTime: ETB_C, etbDateTime: ETB_B }), new Date(ETB_B).getTime())
    assert.equal(getBerthPlanStartMs({ etaDateTime: ETB_C }), null)
  })

  it('isBerthPlanMissingEtc when ETB set and no ETC', () => {
    assert.equal(isBerthPlanMissingEtc({ etbDateTime: ETB_A }), true)
    assert.equal(isBerthPlanMissingEtc({ etbDateTime: ETB_A, estimatedCompletionDateTime: ETC_A }), false)
    assert.equal(isBerthPlanMissingEtc({ etbDateTime: ETB_A, status: 'SAILED' }), false)
  })

  it('getBerthPlanEndMs display mode adds +3 days', () => {
    const start = getBerthPlanStartMs({ etbDateTime: ETB_A })
    assert.equal(getBerthPlanEndMs({ etbDateTime: ETB_A }, { mode: 'display' }), start + DEFAULT_BERTH_TAIL_MS)
  })

  it('intervalsOverlap detects half-open overlap', () => {
    assert.equal(intervalsOverlap(0, 10, 5, 15), true)
    assert.equal(intervalsOverlap(0, 10, 10, 20), false)
  })

  it('CHANG LONG without ETC blocks ALINYA on same jetty', () => {
    const schedule = [
      { vesselId: 'a', vesselName: 'MT CHANG LONG 79', jetty: '3A', etbDateTime: ETB_A },
      { vesselId: 'b', vesselName: 'MT ALINYA', jetty: '3A', etbDateTime: ETB_B },
    ]
    const result = validateBerthPlanJettyAssignment({
      candidate: schedule[1],
      scheduleRows: schedule,
      jettyShortId: '3A',
      jettyCapacity: 1,
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'missing_etc')
    assert.match(result.message, /CHANG LONG/)
  })

  it('CHANG LONG with ETC allows ALINYA when ETB is after ETC', () => {
    const schedule = [
      {
        vesselId: 'a',
        vesselName: 'MT CHANG LONG 79',
        jetty: '3A',
        etbDateTime: ETB_A,
        estimatedCompletionDateTime: ETC_A,
      },
      { vesselId: 'b', vesselName: 'MT ALINYA', jetty: '3A', etbDateTime: ETB_C },
    ]
    const result = validateBerthPlanJettyAssignment({
      candidate: schedule[1],
      scheduleRows: schedule,
      jettyShortId: '3A',
      jettyCapacity: 1,
    })
    assert.equal(result.ok, true)
  })

  it('double-bank jetty allows two non-overlapping plans', () => {
    const schedule = [
      {
        vesselId: 'a',
        vesselName: 'Vessel A',
        jetty: '1B',
        etbDateTime: ETB_A,
        estimatedCompletionDateTime: ETC_A,
      },
      {
        vesselId: 'b',
        vesselName: 'Vessel B',
        jetty: '1B',
        etbDateTime: ETB_C,
        estimatedCompletionDateTime: new Date('2026-06-25T18:00:00').toISOString(),
      },
    ]
    const result = validateBerthPlanJettyAssignment({
      candidate: schedule[1],
      scheduleRows: schedule,
      jettyShortId: '1B',
      jettyCapacity: 2,
    })
    assert.equal(result.ok, true)
  })
})
