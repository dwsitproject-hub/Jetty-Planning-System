import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isPlanOnlySchedulingRow,
  isPreOperationSchedulingRow,
  berthingDisabledReason,
  shouldPollLiveCargoProgress,
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

describe('shouldPollLiveCargoProgress', () => {
  it('returns false without an operationId', () => {
    assert.equal(shouldPollLiveCargoProgress({ tbDateTime: '2026-09-12T14:48:00Z' }), false)
  })

  it('returns true for a row classified as berthed', () => {
    const row = { operationId: 15, tbDateTime: '2026-09-12T14:48:00Z' }
    assert.equal(shouldPollLiveCargoProgress(row, { planCentric: true }), true)
  })

  it('returns true when cargo has already opened, even without a berthed status classification', () => {
    // e.g. a multi-SI shipment plan row whose berthing-eligibility status is stale/incoming,
    // but its cargo segment has already started logging (matches the production bug: an
    // actively-unloading vessel whose Gantt bar showed no Avg rate / 0 MT moved).
    const row = {
      operationId: 42,
      status: 'ALLOCATED',
      tbDateTime: null,
      cargoFirstLoggedAt: '2026-09-12T14:48:00Z',
    }
    assert.equal(shouldPollLiveCargoProgress(row, { planCentric: true }), true)
  })

  it('returns false when cargo has opened but the vessel is shifted out', () => {
    const row = {
      operationId: 42,
      status: 'ALLOCATED',
      cargoFirstLoggedAt: '2026-09-12T14:48:00Z',
      shiftingOut: true,
    }
    assert.equal(shouldPollLiveCargoProgress(row, { planCentric: true }), false)
  })

  it('returns false when neither berthed nor cargo-active', () => {
    const row = { operationId: 42, status: 'ALLOCATED' }
    assert.equal(shouldPollLiveCargoProgress(row, { planCentric: true }), false)
  })
})
