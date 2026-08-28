import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mergeLiveCargoProgressFields, computeCargoProgress } from './cargoQtyDisplay.js'

describe('mergeLiveCargoProgressFields', () => {
  it('returns row unchanged when live summary has no movedQty', () => {
    const row = { cargoMovedQty: 0, cargoFirstLoggedAt: '2026-08-27T09:30:00.000Z' }
    assert.equal(mergeLiveCargoProgressFields(row, null), row)
    assert.equal(mergeLiveCargoProgressFields(row, {}), row)
  })

  it('merges live moved qty, end time for rate, and schedule comparison', () => {
    const row = {
      cargoMovedQty: 0,
      cargoFirstLoggedAt: '2026-08-27T09:30:00.000Z',
      cargoLastLoggedAt: null,
      scheduleComparison: { movedQty: 0, isBehindSchedule: true },
    }
    const live = {
      movedQty: 763,
      isLive: true,
      hasActiveCargo: true,
      isBehindSchedule: false,
      actualPercent: 25,
    }
    const nowMs = new Date('2026-08-28T05:55:00.000Z').getTime()
    const merged = mergeLiveCargoProgressFields(row, live, nowMs)

    assert.equal(merged.cargoMovedQty, 763)
    assert.equal(merged.cargoLastLoggedAt, '2026-08-28T05:55:00.000Z')
    assert.equal(merged.scheduleComparison, live)

    const progress = computeCargoProgress(
      '3,001 MT',
      merged.cargoMovedQty,
      merged.cargoFirstLoggedAt,
      merged.cargoLastLoggedAt
    )
    assert.equal(progress.cargoLine, '763 MT / 3,001 MT')
    assert.ok(progress.ratePerHour > 0)
  })
})
