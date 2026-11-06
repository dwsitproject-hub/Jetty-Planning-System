import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { checkHighlights } from './adminOpsCheckHighlights.js'

describe('checkHighlights', () => {
  it('sums stale sources across ports for ATG sync', () => {
    const h = checkHighlights({
      id: 'atg_sync',
      details: { ports: [{ staleCount: 1, totalEnabled: 3 }, { staleCount: 0, totalEnabled: 1 }] },
    })
    assert.deepEqual(h, [{ labelKey: 'adminOpsKeyStaleSources', value: '1 / 4' }])
  })

  it('shows open gap operations for ATG cargo coverage', () => {
    const h = checkHighlights({ id: 'atg_cargo_gaps', details: { openOperations: 2, liveWithRecentGap: 1 } })
    assert.equal(h[0].value, '2')
    assert.equal(h[1].value, '1')
  })

  it('marks a missing Synology heartbeat for translation', () => {
    const h = checkHighlights({ id: 'synology_mount', details: { writable: true, heartbeat: null } })
    assert.deepEqual(h[1], { labelKey: 'adminOpsKeyHeartbeat', value: 'none', translateValue: true })
  })

  it('returns nothing for unknown checks or errored details', () => {
    assert.deepEqual(checkHighlights({ id: 'other', details: {} }), [])
    assert.deepEqual(checkHighlights({ id: 'datahub', details: { error: 'x' } }), [])
  })
})
