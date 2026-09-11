import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  countSailedWithinDays,
  isIsoInLocalDateRange,
  isWithinSailedLookback,
  sailedLookbackTime,
  SAILED_LOOKBACK_DAY_OPTIONS,
} from './clearanceSailedLookback.js'

const NOW = new Date('2026-09-11T12:00:00.000Z')

describe('clearanceSailedLookback', () => {
  it('exposes 3 / 7 / 14 day options', () => {
    assert.deepEqual(SAILED_LOOKBACK_DAY_OPTIONS, [3, 7, 14])
  })

  it('prefers sailedAt then castOffAt', () => {
    assert.equal(
      sailedLookbackTime({ sailedAt: '2026-09-10T08:00:00.000Z', castOffAt: '2026-09-09T08:00:00.000Z' })?.toISOString(),
      '2026-09-10T08:00:00.000Z',
    )
    assert.equal(
      sailedLookbackTime({ castOffAt: '2026-09-09T08:00:00.000Z' })?.toISOString(),
      '2026-09-09T08:00:00.000Z',
    )
    assert.equal(sailedLookbackTime({}), null)
  })

  it('treats null days as All (always in window)', () => {
    assert.equal(isWithinSailedLookback({ sailedAt: '2020-01-01T00:00:00.000Z' }, null, NOW), true)
    assert.equal(isWithinSailedLookback({}, 3, NOW), false)
  })

  it('filters by 3 / 7 / 14 day windows', () => {
    const within3 = { sailedAt: '2026-09-09T12:00:00.000Z' }
    const within7 = { sailedAt: '2026-09-05T12:00:00.000Z' }
    const within14 = { sailedAt: '2026-08-29T12:00:00.000Z' }
    const older = { sailedAt: '2026-08-20T12:00:00.000Z' }

    assert.equal(isWithinSailedLookback(within3, 3, NOW), true)
    assert.equal(isWithinSailedLookback(within7, 3, NOW), false)
    assert.equal(isWithinSailedLookback(within7, 7, NOW), true)
    assert.equal(isWithinSailedLookback(within14, 7, NOW), false)
    assert.equal(isWithinSailedLookback(within14, 14, NOW), true)
    assert.equal(isWithinSailedLookback(older, 14, NOW), false)
  })

  it('counts only SAILED rows in the window', () => {
    const rows = [
      { apiStatus: 'SAILED', sailedAt: '2026-09-10T00:00:00.000Z' },
      { apiStatus: 'SAILED', sailedAt: '2026-09-01T00:00:00.000Z' },
      { apiStatus: 'SIGNOFF_APPROVED', sailedAt: '2026-09-10T00:00:00.000Z' },
    ]
    assert.equal(countSailedWithinDays(rows, null, NOW), 2)
    assert.equal(countSailedWithinDays(rows, 3, NOW), 1)
    assert.equal(countSailedWithinDays(rows, 14, NOW), 2)
  })
})

describe('isIsoInLocalDateRange', () => {
  const iso = new Date(2026, 7, 29, 15, 30).toISOString()

  it('passes when no bounds are set', () => {
    assert.equal(isIsoInLocalDateRange(iso, '', ''), true)
    assert.equal(isIsoInLocalDateRange(null, '', ''), true)
  })

  it('includes the from and to calendar days', () => {
    assert.equal(isIsoInLocalDateRange(iso, '2026-08-29', '2026-08-29'), true)
    assert.equal(isIsoInLocalDateRange(iso, '2026-08-28', '2026-08-30'), true)
  })

  it('excludes dates outside the range and missing timestamps', () => {
    assert.equal(isIsoInLocalDateRange(iso, '2026-08-30', ''), false)
    assert.equal(isIsoInLocalDateRange(iso, '', '2026-08-28'), false)
    assert.equal(isIsoInLocalDateRange(null, '2026-08-29', ''), false)
  })
})
