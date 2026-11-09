import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PENDING_STALE_MS,
  formatDuration,
  httpStatusBadgeClass,
  isPendingStale,
  relativeTime,
  webhookStatusBadgeClass,
} from './partnerActivityFormat.js'

const NOW = Date.parse('2026-10-27T10:00:00.000Z')

describe('partnerActivityFormat', () => {
  it('formatDuration shows milliseconds under a second and seconds above', () => {
    assert.equal(formatDuration(null), '—')
    assert.equal(formatDuration(212), '212 ms')
    assert.equal(formatDuration(1200), '1.2 s')
  })

  it('relativeTime picks a readable unit and handles missing input', () => {
    assert.equal(relativeTime(null, 'en', NOW), null)
    assert.equal(relativeTime('garbage', 'en', NOW), null)
    assert.equal(relativeTime(new Date(NOW - 2 * 60_000).toISOString(), 'en', NOW), '2 minutes ago')
    assert.equal(relativeTime(new Date(NOW - 3 * 3600_000).toISOString(), 'en', NOW), '3 hours ago')
  })

  it('badge classes map statuses to the existing admin badge styles', () => {
    assert.match(webhookStatusBadgeClass('sent'), /--active/)
    assert.match(webhookStatusBadgeClass('failed'), /--error/)
    assert.match(webhookStatusBadgeClass('pending'), /--warning/)
    assert.match(httpStatusBadgeClass(200), /--active/)
    assert.match(httpStatusBadgeClass(404), /--warning/)
    assert.match(httpStatusBadgeClass(503), /--error/)
    assert.match(httpStatusBadgeClass(null), /--inactive/)
  })

  it('isPendingStale flags only pending deliveries older than the threshold', () => {
    const old = new Date(NOW - PENDING_STALE_MS - 1000).toISOString()
    const fresh = new Date(NOW - 30_000).toISOString()
    assert.equal(isPendingStale({ status: 'pending', createdAt: old }, NOW), true)
    assert.equal(isPendingStale({ status: 'pending', createdAt: fresh }, NOW), false)
    assert.equal(isPendingStale({ status: 'sent', createdAt: old }, NOW), false)
  })
})
