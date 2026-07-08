import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveCurrentPhaseIndex,
  currentPhaseLabelForVessel,
  getVesselAlongsideEndMs,
  isVesselSailed,
} from './allocationVesselPhase.js'

const PHASES = ['Shipping Instruction', 'Planned berthing', 'At-Berth', 'Clearance']

describe('allocationVesselPhase', () => {
  it('SAILED vessel: phase index past all steps and label Sailed', () => {
    const v = {
      status: 'SAILED',
      shippingInstructionId: 1,
      jetty: '1A',
      tbDateTime: '2026-05-24T16:20:00.000Z',
      castOffDateTime: '2026-06-08T00:43:00.000Z',
    }
    assert.equal(isVesselSailed(v), true)
    assert.equal(deriveCurrentPhaseIndex(v), 4)
    assert.equal(currentPhaseLabelForVessel(v, PHASES), 'Sailed')
  })

  it('SIGNOFF_APPROVED with TB: clearance in progress', () => {
    const v = {
      status: 'SIGNOFF_APPROVED',
      shippingInstructionId: 1,
      jetty: '1A',
      tbDateTime: '2026-05-24T16:20:00.000Z',
    }
    assert.equal(deriveCurrentPhaseIndex(v), 3)
    assert.equal(currentPhaseLabelForVessel(v, PHASES), 'Clearance')
  })

  it('DOCKED with TB: at-berth in progress', () => {
    const v = {
      status: 'DOCKED',
      shippingInstructionId: 1,
      jetty: '1A',
      tbDateTime: '2026-05-24T16:20:00.000Z',
    }
    assert.equal(deriveCurrentPhaseIndex(v), 2)
  })

  it('SAILED: alongside end uses cast-off not now', () => {
    const castOffMs = new Date('2026-06-08T00:43:00.000Z').getTime()
    const nowMs = new Date('2026-06-22T12:00:00.000Z').getTime()
    const end = getVesselAlongsideEndMs(
      {
        status: 'SAILED',
        castOffDateTime: '2026-06-08T00:43:00.000Z',
      },
      nowMs
    )
    assert.equal(end, castOffMs)
  })
})
