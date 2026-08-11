import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  canEditSiPreBerth,
  canOpenPreBerthCombinedEdit,
  isRowPreBerth,
  planHubCanEditSi,
  planIsPreBerth,
  planListCanEditPlanPreBerth,
  planListCanEditSiPreBerth,
  resolveFirstSiIdFromPlan,
  resolvePlanIdFromRow,
  resolvePrimarySiIdFromRow,
  canEditPlanPreBerthFromRow,
} from './siPreBerthEdit.js'

describe('siPreBerthEdit', () => {
  it('isRowPreBerth rejects berthed rows', () => {
    assert.equal(isRowPreBerth({ tbDateTime: '2026-01-01T10:00:00Z' }), false)
    assert.equal(isRowPreBerth({ status: 'DOCKED' }), false)
    assert.equal(isRowPreBerth({ status: 'INCOMING' }), true)
  })

  it('resolvePrimarySiIdFromRow prefers shippingInstructionId', () => {
    assert.equal(resolvePrimarySiIdFromRow({ shippingInstructionId: 42 }), 42)
    assert.equal(
      resolvePrimarySiIdFromRow({
        planQueueSiEntries: [{ shippingInstructionId: 7 }],
      }),
      7
    )
    assert.equal(resolvePrimarySiIdFromRow({}), null)
  })

  it('canEditSiPreBerth requires pre-berth and SI id', () => {
    assert.equal(
      canEditSiPreBerth({ shippingInstructionId: 1, status: 'INCOMING' }),
      true
    )
    assert.equal(
      canEditSiPreBerth({ shippingInstructionId: 1, tbDateTime: '2026-01-01' }),
      false
    )
  })

  it('planIsPreBerth uses plan tb / dockingStartTime', () => {
    assert.equal(planIsPreBerth({ approvalStatus: 'Approved' }), true)
    assert.equal(planIsPreBerth({ tb: '2026-01-01T10:00:00Z' }), false)
    assert.equal(planIsPreBerth({ dockingStartTime: '2026-01-01T10:00:00Z' }), false)
  })

  it('planHubCanEditSi allows Approved pre-berth with SIs', () => {
    assert.equal(
      planHubCanEditSi({
        approvalStatus: 'Approved',
        shippingInstructions: [{ id: 1 }],
      }),
      true
    )
    assert.equal(
      planHubCanEditSi({
        approvalStatus: 'Draft',
        shippingInstructions: [{ id: 1 }],
      }),
      false
    )
    assert.equal(
      planHubCanEditSi({
        approvalStatus: 'Approved',
        tb: '2026-01-01',
        shippingInstructions: [{ id: 1 }],
      }),
      false
    )
  })

  it('planListCanEditSiPreBerth mirrors list eligibility', () => {
    assert.equal(
      planListCanEditSiPreBerth({
        approvalStatus: 'Submitted',
        siCount: 2,
      }),
      true
    )
    assert.equal(
      planListCanEditSiPreBerth({
        approvalStatus: 'Approved',
        siCount: 0,
      }),
      false
    )
  })

  it('resolveFirstSiIdFromPlan returns first child id', () => {
    assert.equal(
      resolveFirstSiIdFromPlan({
        shippingInstructions: [{ id: 9 }, { id: 10 }],
      }),
      9
    )
  })

  it('planListCanEditPlanPreBerth allows Approved pre-berth without SI', () => {
    assert.equal(
      planListCanEditPlanPreBerth({ approvalStatus: 'Approved', siCount: 0 }),
      true
    )
    assert.equal(
      planListCanEditPlanPreBerth({ approvalStatus: 'Approved', tb: '2026-01-01' }),
      false
    )
  })

  it('canOpenPreBerthCombinedEdit mirrors planListCanEditPlanPreBerth', () => {
    assert.equal(canOpenPreBerthCombinedEdit({ approvalStatus: 'Approved' }), true)
    assert.equal(canOpenPreBerthCombinedEdit({ approvalStatus: 'Draft' }), false)
  })

  it('resolvePlanIdFromRow uses shipmentPlanId or id', () => {
    assert.equal(resolvePlanIdFromRow({ shipmentPlanId: 3 }), 3)
    assert.equal(resolvePlanIdFromRow({ id: 5 }), 5)
    assert.equal(resolvePlanIdFromRow({}), null)
  })

  it('canEditPlanPreBerthFromRow uses shipmentPlanId', () => {
    assert.equal(canEditPlanPreBerthFromRow({ shipmentPlanId: 3, status: 'INCOMING' }), true)
    assert.equal(canEditPlanPreBerthFromRow({ tbDateTime: '2026-01-01' }), false)
  })
})
