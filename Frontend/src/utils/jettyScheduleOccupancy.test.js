import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildIncomingByJettyForDate,
  isAlongsideOccupiedOnDate,
  toDateInputValue,
} from './jettyScheduleOccupancy.js'

const TB = '2026-05-11T00:20:00.000Z'
const CAST_OFF = '2026-06-05T06:04:00.000Z'
const NOW_AFTER_SAIL = new Date('2026-06-05T14:00:00.000Z').getTime()

describe('isAlongsideOccupiedOnDate', () => {
  const sailedRow = {
    status: 'SAILED',
    tbDateTime: TB,
    castOffDateTime: CAST_OFF,
    actualCompletionDateTime: CAST_OFF,
  }

  it('today: hides vessel after cast-off (point-in-time)', () => {
    const todayYmd = toDateInputValue(new Date(NOW_AFTER_SAIL))
    assert.equal(isAlongsideOccupiedOnDate(sailedRow, todayYmd, NOW_AFTER_SAIL), false)
  })

  it('today: shows vessel before cast-off (point-in-time)', () => {
    const todayYmd = toDateInputValue(new Date('2026-06-05T05:00:00.000Z'))
    const asOf = new Date('2026-06-05T05:30:00.000Z').getTime()
    assert.equal(isAlongsideOccupiedOnDate(sailedRow, todayYmd, asOf), true)
  })

  it('past day: shows vessel for full calendar day it was alongside', () => {
    assert.equal(
      isAlongsideOccupiedOnDate(sailedRow, '2026-06-04', NOW_AFTER_SAIL),
      true
    )
  })

  it('past day before berthing: not occupied', () => {
    assert.equal(
      isAlongsideOccupiedOnDate(sailedRow, '2026-05-10', NOW_AFTER_SAIL),
      false
    )
  })

  it('today: active vessel with past ETC still alongside (open end = now)', () => {
    const nowMs = new Date('2026-06-05T14:00:00.000Z').getTime()
    const todayYmd = toDateInputValue(new Date(nowMs))
    const atBerthRow = {
      status: 'DOCKED',
      tbDateTime: TB,
      estimatedCompletionDateTime: '2026-05-11T10:20:00.000Z',
    }
    assert.equal(isAlongsideOccupiedOnDate(atBerthRow, todayYmd, nowMs), true)
  })
})

describe('buildIncomingByJettyForDate', () => {
  it('excludes SAILED vessel that cast off earlier the same local day (UTC date still previous day)', () => {
    const nowMs = new Date('2026-09-01T11:18:00+08:00').getTime()
    const todayYmd = toDateInputValue(new Date(nowMs))
    const row = {
      vesselName: 'MT METRO MARITIM VIII',
      jetty: '2B',
      status: 'SAILED',
      etaDateTime: '2026-08-22T04:00:00.000Z',
      etbDateTime: '2026-08-29T14:00:00.000Z',
      tbDateTime: '2026-08-29T15:00:00.000Z',
      castOffDateTime: '2026-08-31T19:55:00.000Z',
      actualCompletionDateTime: '2026-08-31T19:55:00.000Z',
    }
    assert.deepEqual(buildIncomingByJettyForDate([row], todayYmd, nowMs), {})
  })

  it('excludes SAILED vessel without cast-off/completion timestamps', () => {
    const nowMs = Date.now()
    const todayYmd = toDateInputValue(new Date(nowMs))
    const row = {
      vesselName: 'MT EXAMPLE',
      jetty: '2B',
      status: 'SAILED',
      etaDateTime: '2026-08-22T04:00:00.000Z',
      etbDateTime: '2026-08-29T14:00:00.000Z',
    }
    assert.deepEqual(buildIncomingByJettyForDate([row], todayYmd, nowMs), {})
  })
})
