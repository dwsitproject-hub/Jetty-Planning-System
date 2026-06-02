import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computePipelinePartition } from './dashboardPipelinePartition.js'

describe('computePipelinePartition', () => {
  it('counts Draft and Submitted as shipment request even when jettyId is set', () => {
    const plans = [
      { id: 1, approvalStatus: 'Draft', jettyId: null, tb: null, sailedAt: null },
      { id: 2, approvalStatus: 'Submitted', jettyId: 5, tb: null, sailedAt: null },
    ]
    const r = computePipelinePartition(plans, [])
    assert.equal(r.shipmentRequest, 2)
    assert.equal(r.plannedBerthing, 0)
    assert.equal(r.incoming, 0)
    assert.equal(r.planPipelineTotal, 2)
    assert.equal(r.partitionBalanced, true)
  })

  it('counts only Approved plans with jetty as planned berthing', () => {
    const plans = [
      { id: 1, approvalStatus: 'Approved', jettyId: 3, tb: null, sailedAt: null },
      { id: 2, approvalStatus: 'Submitted', jettyId: 3, tb: null, sailedAt: null },
    ]
    const r = computePipelinePartition(plans, [])
    assert.equal(r.plannedBerthing, 1)
    assert.equal(r.shipmentRequest, 1)
    assert.equal(r.incoming, 0)
  })

  it('excludes rejected from pipeline sum but keeps planCountTotal', () => {
    const plans = [
      { id: 1, approvalStatus: 'Draft', jettyId: null, tb: null, sailedAt: null },
      { id: 2, approvalStatus: 'Rejected', jettyId: null, tb: null, sailedAt: null },
    ]
    const r = computePipelinePartition(plans, [])
    assert.equal(r.planCountTotal, 2)
    assert.equal(r.planPipelineTotal, 1)
    assert.equal(r.rejectedPlans, 1)
    assert.equal(r.shipmentRequest, 1)
    assert.equal(r.partitionBalanced, true)
  })
})
