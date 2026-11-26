import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultRecoveryRange,
  entriesByTankCode,
  fromDatetimeLocal,
  toDatetimeLocal,
  validateRecoveryRange,
} from './atgSourceRecovery.js'

const NOW = Date.parse('2026-11-26T10:00:00Z')

describe('defaultRecoveryRange', () => {
  it('uses the latest gap of a source with a gap', () => {
    const range = defaultRecoveryRange(
      {
        status: 'gap',
        gaps: [
          { startAt: '2026-11-25T01:00:00.000Z', endAt: '2026-11-25T02:00:00.000Z' },
          { startAt: '2026-11-25T15:27:00.000Z', endAt: '2026-11-26T00:11:00.000Z' },
        ],
      },
      NOW
    )
    assert.deepEqual(range, { startAt: '2026-11-25T15:27:00.000Z', endAt: '2026-11-26T00:11:00.000Z' })
  })

  it('caps an ongoing gap at now', () => {
    const range = defaultRecoveryRange(
      { status: 'silent', gaps: [{ startAt: '2026-11-26T05:00:00.000Z', endAt: '2026-11-26T12:00:00.000Z' }] },
      NOW
    )
    assert.equal(range.endAt, '2026-11-26T10:00:00.000Z')
  })

  it('offers nothing for live or recovered sources', () => {
    assert.equal(defaultRecoveryRange({ status: 'live', gaps: [] }, NOW), null)
    assert.equal(defaultRecoveryRange({ status: 'recovered', gaps: [], recoveredRanges: [{}] }, NOW), null)
    assert.equal(defaultRecoveryRange(null, NOW), null)
  })
})

describe('datetime-local conversion', () => {
  it('round-trips to the minute', () => {
    const iso = '2026-11-25T15:27:00.000Z'
    assert.equal(fromDatetimeLocal(toDatetimeLocal(iso)), iso)
  })

  it('returns empty or null for bad input', () => {
    assert.equal(toDatetimeLocal('not a date'), '')
    assert.equal(fromDatetimeLocal(''), null)
    assert.equal(fromDatetimeLocal('nope'), null)
  })
})

describe('validateRecoveryRange', () => {
  it('accepts a normal range', () => {
    assert.equal(validateRecoveryRange('2026-11-25T15:00:00Z', '2026-11-26T00:30:00Z'), null)
  })

  it('rejects missing, reversed, and over-long ranges', () => {
    assert.equal(validateRecoveryRange(null, '2026-11-26T00:30:00Z'), 'invalid')
    assert.equal(validateRecoveryRange('2026-11-26T00:30:00Z', '2026-11-25T15:00:00Z'), 'order')
    assert.equal(validateRecoveryRange('2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z'), 'too_long')
  })
})

describe('entriesByTankCode', () => {
  it('groups entries under each tank they use', () => {
    const a = { operationId: 1, entryNo: 2, tankCodes: ['3203', '3502'] }
    const b = { operationId: 2, entryNo: 1, tankCodes: ['3203'] }
    const map = entriesByTankCode([a, b])
    assert.deepEqual(map.get('3203'), [a, b])
    assert.deepEqual(map.get('3502'), [a])
    assert.equal(map.get('9999'), undefined)
  })
})
