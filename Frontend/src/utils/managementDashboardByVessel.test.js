import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { groupVoyagesByVessel, summarizeVessels, vesselGroupKey } from './managementDashboardByVessel.js'

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
    assert.equal(one.vessel, 'BG. ONE')
    assert.equal(one.callCount, 2)
    assert.equal(one.loadCalls, 1)
    assert.equal(one.unloadCalls, 1)
    assert.equal(one.wait, 15)
    assert.equal(one.pre, 3)
    assert.deepEqual(one.jetties, ['J2', 'J1'])
    assert.equal(one.voyages[0].id, 2, 'latest berthing first')
    assert.equal(out.find((v) => v.key === 'name:BG TWO').vessel, 'BG TWO')
  })

  it('counts ops on the same call once for timings', () => {
    const [v] = groupVoyagesByVessel([
      row({ id: 1, vessel: 'A', tb: 't1', wait: 10 }),
      row({ id: 2, vessel: 'A', tb: 't1', wait: 10 }),
      row({ id: 3, vessel: 'A', tb: 't2', wait: 40 }),
    ])
    assert.equal(v.callCount, 2)
    assert.equal(v.wait, 25)
  })

  it('averages the voyage rates simply and skips voyages without a rate', () => {
    const [v] = groupVoyagesByVessel([
      row({ id: 1, vessel: 'A', tb: 't1', voyageRateMtH: 300, voyageActiveRateMtH: 320 }),
      row({ id: 2, vessel: 'A', tb: 't2', voyageRateMtH: 100, voyageActiveRateMtH: 120 }),
      row({ id: 3, vessel: 'A', tb: 't3' }),
    ])
    assert.equal(v.rate, 200)
    assert.equal(v.activeRate, 220)
  })

  it('gives the slowest and fastest voyage rate behind each average', () => {
    const [v] = groupVoyagesByVessel([
      row({ id: 1, vessel: 'A', tb: 't1', voyageRateMtH: 300 }),
      row({ id: 2, vessel: 'A', tb: 't2', voyageRateMtH: 100 }),
      row({ id: 3, vessel: 'A', tb: 't3' }),
    ])
    assert.deepEqual(v.rateRange, { min: 100, max: 300, n: 2 })
    assert.equal(v.activeRateRange, null)
  })

  it('uses the pumped rate as the active rate when the breakdown is on', () => {
    const bd = (rate) => ({ normal: { rateMtH: rate }, downtime: { hours: 1 } })
    const [v] = groupVoyagesByVessel([
      row({ id: 1, vessel: 'A', tb: 't1', voyageActiveRateMtH: 999, rateBreakdown: bd(200) }),
      row({ id: 2, vessel: 'A', tb: 't2', voyageActiveRateMtH: 999, rateBreakdown: bd(100) }),
    ])
    assert.equal(v.activeRate, 150)
  })

  it('totals downtime once per call across the vessel, null without a breakdown', () => {
    const bd = (hours) => ({ downtime: { hours } })
    const [v] = groupVoyagesByVessel([
      row({ id: 1, vessel: 'A', tb: 't1', rateBreakdown: bd(3) }),
      row({ id: 2, vessel: 'A', tb: 't1', rateBreakdown: bd(3) }),
      row({ id: 3, vessel: 'A', tb: 't2', rateBreakdown: bd(4.5) }),
      row({ id: 4, vessel: 'A', tb: 't3' }),
    ])
    assert.equal(v.downtimeH, 7.5)
    const [none] = groupVoyagesByVessel([row({ id: 5, vessel: 'B', tb: 't1' })])
    assert.equal(none.downtimeH, null)
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

describe('summarizeVessels', () => {
  it('totals the fleet and averages every voyage rate', () => {
    const out = summarizeVessels(groupVoyagesByVessel([
      row({ id: 1, vessel: 'A', tb: 't1', voyageRateMtH: 300, voyageActiveRateMtH: 320 }),
      row({ id: 2, vessel: 'A', tb: 't2', voyageRateMtH: 100, voyageActiveRateMtH: 120 }),
      row({ id: 3, vessel: 'B', tb: 't3', voyageRateMtH: 200, voyageActiveRateMtH: 250 }),
    ]))
    assert.equal(out.vessels, 2)
    assert.equal(out.voyages, 3)
    assert.equal(out.rate, 200)
    assert.equal(out.activeRate, 230)
    assert.equal(out.rateScaleMax, 320)
    assert.equal(out.moved, null)
  })
})
