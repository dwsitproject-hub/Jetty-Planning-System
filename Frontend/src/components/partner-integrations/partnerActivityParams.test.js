import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SCOPE_ALL, SCOPE_PARTNER, buildApiParams, buildWebhookParams } from './partnerActivityParams.js'

describe('buildWebhookParams', () => {
  it('scopes to the partner and endpoint when scope is partner (Deliveries deep link)', () => {
    assert.deepEqual(buildWebhookParams({ scope: SCOPE_PARTNER, keyId: 2, endpointId: 9, status: '', q: '' }), {
      keyId: 2,
      endpointId: 9,
    })
  })

  it('drops partner and endpoint filters when scope is all partners', () => {
    assert.deepEqual(
      buildWebhookParams({ scope: SCOPE_ALL, keyId: 2, endpointId: 9, status: 'failed', eventType: 'status.changed' }),
      { status: 'failed', eventType: 'status.changed' }
    )
  })

  it('trims the search text and omits blank values', () => {
    assert.deepEqual(buildWebhookParams({ scope: SCOPE_PARTNER, keyId: 1, q: '  OP-10  ' }), { keyId: 1, q: 'OP-10' })
    assert.deepEqual(buildWebhookParams({ scope: SCOPE_PARTNER, keyId: 1, q: '   ' }), { keyId: 1 })
  })
})

describe('buildApiParams', () => {
  it('passes status class, method and route through for the selected partner', () => {
    assert.deepEqual(
      buildApiParams({ scope: SCOPE_PARTNER, keyId: 3, statusClass: 'error', method: 'PATCH', route: '/webhooks' }),
      { keyId: 3, statusClass: 'error', method: 'PATCH', route: '/webhooks' }
    )
  })

  it('omits keyId when viewing all partners', () => {
    assert.deepEqual(buildApiParams({ scope: SCOPE_ALL, keyId: 3, statusClass: '' }), {})
  })
})
