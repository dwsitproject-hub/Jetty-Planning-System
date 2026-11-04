import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildIncomingByJettyForDate,
  defaultLegacyMonthDateRangeInputs,
  defaultPlanCentricDateRangeInputs,
  isAlongsideOccupiedOnDate,
  parseDateInputEndExclusive,
  parseDateInputStart,
  splitVacantArrivalQueue,
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

  it('keeps a later ETA as upcoming and a same-day ETA as incoming', () => {
    const dateYmd = '2026-11-04'
    const asOfMs = parseDateInputStart(dateYmd) + 8 * 60 * 60 * 1000
    const etaToday = new Date(parseDateInputStart(dateYmd) + 6 * 60 * 60 * 1000).toISOString()
    const etaLater = new Date(parseDateInputEndExclusive(dateYmd) + 14 * 60 * 60 * 1000).toISOString()
    const byJetty = buildIncomingByJettyForDate(
      [
        { vesselName: 'MT. SC GARNET', vesselId: 'g', jetty: 'A', etaDateTime: etaLater, shipmentPlanId: 2 },
        { vesselName: 'MV SEN TREASURE', vesselId: 's', jetty: 'B', etaDateTime: etaToday, shipmentPlanId: 1 },
        { vesselName: 'MV. MP2', vesselId: 'm', jetty: 'A', etaDateTime: new Date(parseDateInputEndExclusive(dateYmd) + 30 * 60 * 60 * 1000).toISOString(), shipmentPlanId: 3 },
      ],
      dateYmd,
      asOfMs
    )
    assert.equal(byJetty.B.length, 1)
    assert.equal(byJetty.B[0].name, 'MV SEN TREASURE')
    assert.equal(byJetty.B[0].kind, 'incoming')
    assert.deepEqual(
      byJetty.A.map((e) => e.name),
      ['MT. SC GARNET', 'MV. MP2']
    )
    assert.deepEqual(
      byJetty.A.map((e) => e.kind),
      ['upcoming', 'upcoming']
    )
  })
})

describe('splitVacantArrivalQueue', () => {
  const entry = (key, kind) => ({ key, kind, name: key })

  it('shows the next upcoming vessel when nobody is due that day', () => {
    const { visible, rest } = splitVacantArrivalQueue([
      entry('g', 'upcoming'),
      entry('m', 'upcoming'),
      entry('l', 'upcoming'),
    ])
    assert.deepEqual(visible.map((e) => e.key), ['g'])
    assert.deepEqual(rest.map((e) => e.key), ['m', 'l'])
  })

  it('shows two due arrivals before any later one', () => {
    const { visible, rest } = splitVacantArrivalQueue([
      entry('a', 'incoming'),
      entry('b', 'incoming'),
      entry('c', 'incoming'),
      entry('d', 'upcoming'),
    ])
    assert.deepEqual(visible.map((e) => e.key), ['a', 'b'])
    assert.deepEqual(rest.map((e) => e.key), ['c', 'd'])
  })

  it('fills a free slot with the next upcoming vessel', () => {
    const { visible, rest } = splitVacantArrivalQueue([
      entry('a', 'incoming'),
      entry('d', 'upcoming'),
      entry('e', 'upcoming'),
    ])
    assert.deepEqual(visible.map((e) => e.key), ['a', 'd'])
    assert.deepEqual(rest.map((e) => e.key), ['e'])
  })
})

describe('defaultPlanCentricDateRangeInputs', () => {
  it('spans 14 days before and after the reference day', () => {
    const ref = new Date('2026-06-15T12:00:00Z')
    const { from, to } = defaultPlanCentricDateRangeInputs(ref)
    assert.equal(from, '2026-06-01')
    assert.equal(to, '2026-06-29')
  })
})

describe('defaultLegacyMonthDateRangeInputs', () => {
  it('covers the reference calendar month', () => {
    const ref = new Date('2026-06-15T12:00:00Z')
    const { from, to } = defaultLegacyMonthDateRangeInputs(ref)
    assert.equal(from, '2026-06-01')
    assert.equal(to, '2026-06-30')
  })
})
