import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateArrivalPlan,
  getArrivalsSectionTitle,
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
