import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveActiveVesselRow } from './resolveActiveVesselRow.js'

describe('resolveActiveVesselRow', () => {
  it('finds row by op-* when merged schedule only has plan-* ids', () => {
    const rows = [
      { vesselId: 'plan-10', vesselName: 'Merged plan row', operationId: null },
      { vesselId: 'op-67', vesselName: 'MT HONG BO', operationId: 67, shippingInstruction: 'SI/EUP/1' },
    ]
    const resolved = resolveActiveVesselRow('op-67', rows, [])
    assert.equal(resolved?.vesselName, 'MT HONG BO')
    assert.equal(resolved?.shippingInstruction, 'SI/EUP/1')
  })

  it('falls back to plan queue row by operation id', () => {
    const rows = [{ vesselId: 'plan-10', vesselName: 'Merged only' }]
    const planQueue = [
      { vesselId: 'op-67', vesselName: 'MT HONG BO', operationId: 67, jettyOperationCode: 'LD-1' },
    ]
    const resolved = resolveActiveVesselRow('op-67', rows, planQueue)
    assert.equal(resolved?.jettyOperationCode, 'LD-1')
  })
})
