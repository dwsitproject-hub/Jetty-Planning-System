import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isPlanOnlySchedulingRow,
  isPreOperationSchedulingRow,
  berthingDisabledReason,
  BERTHING_PLAN_GATE_TOOLTIP,
} from './berthingEligibility.js'

describe('isPreOperationSchedulingRow', () => {
  it('returns true when plan exists and no operation yet, even with SI', () => {
    const row = { shipmentPlanId: 10, shippingInstructionId: 5, operationId: null }
    assert.equal(isPreOperationSchedulingRow(row), true)
    assert.equal(isPlanOnlySchedulingRow(row), true)
  })

  it('returns false when an operation exists', () => {
    assert.equal(isPreOperationSchedulingRow({ shipmentPlanId: 10, operationId: 99 }), false)
  })

  it('returns false without shipmentPlanId', () => {
    assert.equal(isPreOperationSchedulingRow({ shippingInstructionId: 5 }), false)
  })
})

describe('berthingDisabledReason with SI but unapproved plan', () => {
  it('returns plan gate tooltip when SI exists but berthing not allowed', () => {
    const row = {
      shipmentPlanId: 1,
      shippingInstructionId: 2,
      shippingInstruction: 'SI/EUP/2026/1',
      vesselName: 'MV TEST',
      berthingAllowed: false,
    }
    assert.equal(berthingDisabledReason(row, { planCentric: true }), BERTHING_PLAN_GATE_TOOLTIP)
  })
})
