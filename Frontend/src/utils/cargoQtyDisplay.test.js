import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeLiveCargoProgressFields,
  computeCargoProgress,
  resolveCargoQtyTotal,
} from './cargoQtyDisplay.js'

describe('resolveCargoQtyTotal', () => {
  it('prefers numeric SI qty over formatted display text', () => {
    const qty = resolveCargoQtyTotal({
      cargoSiQty: 3001.443,
      cargoSiMetric: 'MT',
      totalQtyDisplay: 'CPO 3.001,443 MT',
    })
    assert.deepEqual(qty, { total: 3001.443, unit: 'MT' })
  })

  it('falls back to parseQtyDisplay when SI qty missing', () => {
    const qty = resolveCargoQtyTotal({ totalQtyDisplay: '2,500 MT' })
    assert.deepEqual(qty, { total: 2500, unit: 'MT' })
  })
})

describe('computeCargoProgress', () => {
  it('uses SI qty for denominator and shows actual moved when over target', () => {
    const progress = computeCargoProgress(
      'CPO 3.001,443 MT',
      3803,
      '2026-08-27T09:30:00.000Z',
      '2026-08-31T03:00:00.000Z',
      { cargoSiQty: 3001.443, cargoSiMetric: 'MT' }
    )
    assert.equal(progress.cargoLine, '3,803 MT / 3,001 MT')
    assert.equal(progress.balanceLine, 'Balance 0 MT')
    assert.ok(progress.ratePerHour > 0)
  })
})

describe('mergeLiveCargoProgressFields', () => {
  it('returns row unchanged when live summary has no movedQty', () => {
    const row = { cargoMovedQty: 0, cargoFirstLoggedAt: '2026-08-27T09:30:00.000Z' }
    assert.equal(mergeLiveCargoProgressFields(row, null), row)
    assert.equal(mergeLiveCargoProgressFields(row, {}), row)
  })

  it('merges hourly moved qty, SI total, end time for rate, and schedule comparison', () => {
    const row = {
      cargoMovedQty: 0,
      cargoSiQty: 3001,
      cargoFirstLoggedAt: '2026-08-27T09:30:00.000Z',
      cargoLastLoggedAt: null,
      scheduleComparison: { movedQty: 0, isBehindSchedule: true },
    }
    const live = {
      movedQty: 3803,
      siQty: 3001.443,
      siMetric: 'MT',
      isLive: true,
      hasActiveCargo: true,
      isBehindSchedule: false,
      actualPercent: 127,
    }
    const nowMs = new Date('2026-08-31T03:00:00.000Z').getTime()
    const merged = mergeLiveCargoProgressFields(row, live, nowMs)

    assert.equal(merged.cargoMovedQty, 3803)
    assert.equal(merged.cargoSiQty, 3001.443)
    assert.equal(merged.cargoSiMetric, 'MT')
    assert.equal(merged.cargoLastLoggedAt, '2026-08-31T03:00:00.000Z')
    assert.equal(merged.scheduleComparison, live)
  })
})
