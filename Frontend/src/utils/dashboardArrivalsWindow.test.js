import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateArrivalPlan,
  getArrivalsSectionTitle,
  isWaitingToBerth,
  planCommodityShortLabels,
  ARRIVALS_WINDOW_DEFAULT_DAYS,
} from './dashboardArrivalsWindow.js'

function parseIso(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

const NOW = new Date('2026-09-09T12:00:00.000Z').getTime()

describe('evaluateArrivalPlan', () => {
  it('includes any overdue ETA regardless of ETB', () => {
    const r = evaluateArrivalPlan(
      { eta: '2026-08-27T11:00:00.000Z', etb: '2026-09-12T09:30:00.000Z' },
      NOW,
      3,
      parseIso,
    )
    assert.ok(r?.include)
    assert.equal(r.whenKind, 'ETA')
    assert.equal(r.overdue, true)
  })

  it('includes ETA within 3d even when ETB is far out', () => {
    const r = evaluateArrivalPlan(
      { eta: '2026-09-12T11:00:00.000Z', etb: '2026-09-18T01:30:00.000Z' },
      NOW,
      3,
      parseIso,
    )
    assert.ok(r?.include)
    assert.equal(r.whenKind, 'ETA')
  })

  it('excludes future ETA beyond 3d window', () => {
    const r = evaluateArrivalPlan(
      { eta: '2026-09-20T11:00:00.000Z' },
      NOW,
      3,
      parseIso,
    )
    assert.equal(r, null)
  })

  it('includes ETA at day 5 when window is 7d', () => {
    const r = evaluateArrivalPlan(
      { eta: '2026-09-14T11:00:00.000Z' },
      NOW,
      7,
      parseIso,
    )
    assert.ok(r?.include)
  })

  it('excludes ETA at day 10 when window is 7d', () => {
    const r = evaluateArrivalPlan(
      { eta: '2026-09-19T11:00:00.000Z' },
      NOW,
      7,
      parseIso,
    )
    assert.equal(r, null)
  })

  it('includes ETA at day 10 when window is 14d', () => {
    const r = evaluateArrivalPlan(
      { eta: '2026-09-19T11:00:00.000Z' },
      NOW,
      14,
      parseIso,
    )
    assert.ok(r?.include)
  })

  it('falls back to ETB when no ETA and ETB within window', () => {
    const r = evaluateArrivalPlan(
      { eta: null, etb: '2026-09-11T09:00:00.000Z' },
      NOW,
      7,
      parseIso,
    )
    assert.ok(r?.include)
    assert.equal(r.whenKind, 'ETB')
  })

  it('excludes plans that already have TA', () => {
    const r = evaluateArrivalPlan(
      { eta: '2026-09-10T11:00:00.000Z', ta: '2026-09-09T08:00:00.000Z' },
      NOW,
      3,
      parseIso,
    )
    assert.equal(r, null)
  })

  it('excludes when no ETA and ETB beyond window', () => {
    const r = evaluateArrivalPlan(
      { eta: null, etb: '2026-09-20T09:00:00.000Z' },
      NOW,
      7,
      parseIso,
    )
    assert.equal(r, null)
  })
})

describe('isWaitingToBerth', () => {
  it('is true when TA is set and TB is not', () => {
    assert.equal(
      isWaitingToBerth({ ta: '2026-09-08T10:00:00.000Z', tb: null }, parseIso),
      true,
    )
  })

  it('is false when TA is missing', () => {
    assert.equal(isWaitingToBerth({ eta: '2026-09-10T11:00:00.000Z' }, parseIso), false)
  })

  it('is false when TB or sailed is set', () => {
    assert.equal(
      isWaitingToBerth({ ta: '2026-09-08T10:00:00.000Z', tb: '2026-09-09T10:00:00.000Z' }, parseIso),
      false,
    )
    assert.equal(
      isWaitingToBerth({ ta: '2026-09-08T10:00:00.000Z', sailedAt: '2026-09-09T10:00:00.000Z' }, parseIso),
      false,
    )
  })
})

describe('planCommodityShortLabels', () => {
  it('prefers short name and joins unique values', () => {
    const label = planCommodityShortLabels({
      shippingInstructions: [
        {
          breakdown: [
            { commodityShortName: 'CPO', commodityName: 'CRUDE PALM OIL' },
            { commodityShortName: 'CPO', commodityName: 'CRUDE PALM OIL' },
            { commodityName: 'FAME' },
          ],
        },
      ],
    })
    assert.equal(label, 'CPO · FAME')
  })
})

describe('getArrivalsSectionTitle', () => {
  const t = (key) => ({
    v2ArrivalsTitle72h: 'Arriving next 72h',
    v2ArrivalsTitle7d: 'Arriving next 7 days',
    v2ArrivalsTitle14d: 'Arriving next 14 days',
  }[key])

  it('returns dynamic titles per period', () => {
    assert.equal(getArrivalsSectionTitle(3, t), 'Arriving next 72h')
    assert.equal(getArrivalsSectionTitle(7, t), 'Arriving next 7 days')
    assert.equal(getArrivalsSectionTitle(14, t), 'Arriving next 14 days')
  })

  it('defaults to 3d constant', () => {
    assert.equal(ARRIVALS_WINDOW_DEFAULT_DAYS, 3)
  })
})
