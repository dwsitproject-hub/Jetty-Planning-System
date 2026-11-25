import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { groupVoyagesByVessel, vesselGroupKey } from './managementDashboardByVessel.js'

const row = (o) => ({ sailedInPeriod: true, commodity: '', purpose: 'Loading', ...o })

describe('vesselGroupKey', () => {
  it('uses the Master Vessel id, else the cleaned-up name', () => {
    assert.equal(vesselGroupKey({ masterVesselId: '7', vessel: 'X' }), 'mv:7')
    assert.equal(vesselGroupKey({ vessel: ' bg.  Luminor 9 ' }), 'name:BG. LUMINOR 9')
    assert.equal(vesselGroupKey({}), 'name:—')
  })
})

describe('groupVoyagesByVessel', () => {
  it('puts loading and unloading calls of one Master Vessel in one row', () => {
    const out = groupVoyagesByVessel([
      row({ id: 1, masterVesselId: '7', masterVesselName: 'BG. ONE', vessel: 'BG ONE', tb: '2026-11-01T00:00:00Z', jetty: 'J1', wait: 10, pre: 2 }),
      row({ id: 2, masterVesselId: '7', masterVesselName: 'BG. ONE', vessel: 'B.G. ONE', purpose: 'Unloading', tb: '2026-11-10T00:00:00Z', jetty: 'J2', wait: 20, pre: 4 }),
      row({ id: 3, vessel: 'BG TWO', tb: '2026-11-05T00:00:00Z', jetty: 'J1', wait: 5 }),
    ])
    assert.equal(out.length, 2)
    const one = out.find((v) => v.key === 'mv:7')
    assert.equal(one.linked, true)
    assert.equal(one.vessel, 'BG. ONE')
    assert.equal(one.callCount, 2)
    assert.equal(one.loadCalls, 1)
    assert.equal(one.unloadCalls, 1)
    assert.equal(one.wait, 15)
    assert.equal(one.pre, 3)
    assert.deepEqual(one.jetties, ['J2', 'J1'])
    assert.equal(one.voyages[0].id, 2, 'latest berthing first')
    assert.equal(out.find((v) => v.key === 'name:BG TWO').linked, false)
  })

  it('counts ops on the same call once for timings and weights rates by hours', () => {
    const [v] = groupVoyagesByVessel([
      row({ id: 1, vessel: 'A', tb: 't1', wait: 10, voyageMovedQty: 1000, voyageLoggedHours: 10, voyageActiveHours: 8 }),
      row({ id: 2, vessel: 'A', tb: 't1', wait: 10, voyageMovedQty: 1000, voyageLoggedHours: 10, voyageActiveHours: 8 }),
      row({ id: 3, vessel: 'A', tb: 't2', wait: 40, voyageMovedQty: 3000, voyageLoggedHours: 30, voyageActiveHours: 20 }),
    ])
    assert.equal(v.callCount, 2)
    assert.equal(v.wait, 25)
    assert.equal(v.rate, 5000 / 40)
    assert.equal(v.activeRate, 5000 / 28)
  })

  it('shows a vessel still alongside and leaves rates empty without hours', () => {
    const [v] = groupVoyagesByVessel([
      row({ id: 1, vessel: 'A', tb: 't1', castOff: '2026-11-02T00:00:00Z' }),
      row({ id: 2, vessel: 'A', tb: 't2', sailedInPeriod: false, status: 'IN_PROGRESS' }),
    ])
    assert.equal(v.alongside.id, 2)
    assert.equal(v.lastCastOff, '2026-11-02T00:00:00Z')
    assert.equal(v.rate, null)
    assert.equal(v.movedTotal, null)
  })
})
