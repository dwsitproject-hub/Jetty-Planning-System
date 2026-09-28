import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeLiveCargoProgressFields,
  mergeLiveCargoProgressIntoRows,
  computeCargoProgress,
  computeCargoEtrMs,
  resolveCargoRatePerHour,
  resolveCargoQtyTotal,
  formatAvgFlowRateLabel,
  formatAvgFlowRateLine,
  formatCargoEtrLine,
} from './cargoQtyDisplay.js'

function formatDurationShort(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null
  const mins = Math.floor(ms / 60000)
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  const rem = mins % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${rem}m`
  return `${rem}m`
}

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

describe('resolveCargoRatePerHour', () => {
  it('prefers avgRateTph over logged-window rate', () => {
    assert.equal(
      resolveCargoRatePerHour({
        avgRateTph: 95.5,
        movedQty: 731,
        firstLoggedAt: '2026-09-23T10:00:00.000Z',
        lastLoggedAt: '2026-09-24T12:00:00.000Z',
      }),
      95.5
    )
  })

  it('falls back to logged-window rate when avgRateTph missing', () => {
    const rate = resolveCargoRatePerHour({
      movedQty: 100,
      firstLoggedAt: '2026-09-23T10:00:00.000Z',
      lastLoggedAt: '2026-09-23T12:00:00.000Z',
    })
    assert.equal(rate, 50)
  })
})

describe('computeCargoEtrMs', () => {
  it('computes balance divided by rate in milliseconds', () => {
    const ms = computeCargoEtrMs(769, 95.5)
    assert.ok(ms != null)
    assert.ok(Math.abs(ms - (769 / 95.5) * 3600000) < 1)
    assert.equal(formatCargoEtrLine(769, 95.5, formatDurationShort), 'ETR 8h 3m')
  })

  it('returns null when balance or rate is zero', () => {
    assert.equal(computeCargoEtrMs(0, 95.5), null)
    assert.equal(computeCargoEtrMs(769, 0), null)
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
    assert.equal(progress.balance, 0)
    assert.equal(progress.etrMs, null)
    assert.ok(progress.ratePerHour > 0)
  })

  it('includes etrMs when balance and avgRateTph are positive', () => {
    const progress = computeCargoProgress(
      '1,500 MT',
      731,
      '2026-09-23T10:00:00.000Z',
      '2026-09-24T12:00:00.000Z',
      { cargoSiQty: 1500, cargoSiMetric: 'MT', avgRateTph: 95.5 }
    )
    assert.equal(progress.balance, 769)
    assert.equal(progress.ratePerHour, 95.5)
    assert.ok(progress.etrMs != null)
    assert.equal(formatCargoEtrLine(progress.balance, progress.ratePerHour, formatDurationShort), 'ETR 8h 3m')
  })

  it('returns null (pending) when a segment has opened but not closed and no live rate arrived yet', () => {
    // Matches the production bug: an actively-unloading vessel whose static snapshot has
    // cargoMovedQty=0 (SUM only counts closed load lines) and cargoLastLoggedAt=null (segment
    // still open), with no live scheduleComparison.avgRateTph merged in yet. Asserting a
    // confident "0 MT moved" here would be misleading — the real value is unknown, not zero.
    const progress = computeCargoProgress('2,000 MT', 0, '2026-09-12T14:48:00.000Z', null, {})
    assert.equal(progress, null)
  })

  it('still reports a confident zero when no cargo activity has started at all', () => {
    // No cargoFirstLoggedAt at all — genuinely "nothing logged yet", distinct from "logged but
    // not caught up with live data yet". Existing (pre-fix) behavior must be preserved.
    const progress = computeCargoProgress('2,000 MT', 0, null, null, {})
    assert.equal(progress.cargoLine, '0 MT / 2,000 MT')
    assert.equal(progress.balanceLine, 'Balance 2,000 MT')
  })

  it('does not treat an already-closed segment (cargoLastLoggedAt set) as pending', () => {
    const progress = computeCargoProgress(
      '2,000 MT',
      0,
      '2026-09-12T14:48:00.000Z',
      '2026-09-12T20:00:00.000Z',
      {}
    )
    assert.equal(progress.cargoLine, '0 MT / 2,000 MT')
  })

  it('does not treat a row with a live avgRateTph as pending', () => {
    const progress = computeCargoProgress('2,000 MT', 0, '2026-09-12T14:48:00.000Z', null, {
      avgRateTph: 42,
    })
    assert.equal(progress.cargoLine, '0 MT / 2,000 MT')
    assert.equal(progress.ratePerHour, 42)
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

describe('mergeLiveCargoProgressIntoRows', () => {
  it('merges live data into rows keyed by operationId, leaving unmatched rows untouched', () => {
    const rows = [
      { vesselId: 'op-111', operationId: 111, cargoMovedQty: 0, cargoFirstLoggedAt: '2026-09-24T17:24:00.000Z', cargoLastLoggedAt: null },
      { vesselId: 'op-122', operationId: 122, cargoMovedQty: 1948.835, cargoLastLoggedAt: '2026-09-23T05:21:00.000Z' },
      { vesselId: 'op-999', operationId: 999, cargoMovedQty: 0 },
    ]
    const cargoProgressByOpId = {
      111: { movedQty: 769.576, siQty: 2000, isLive: true, hasActiveCargo: true, avgRateTph: 55.35 },
    }
    const nowMs = new Date('2026-09-25T07:20:00.000Z').getTime()
    const merged = mergeLiveCargoProgressIntoRows(rows, cargoProgressByOpId, nowMs)

    assert.equal(merged[0].cargoMovedQty, 769.576)
    assert.equal(merged[0].cargoLastLoggedAt, '2026-09-25T07:20:00.000Z')
    assert.equal(merged[0].scheduleComparison.avgRateTph, 55.35)
    // Rows without a matching live summary (closed session, or no operationId match) pass through unchanged.
    assert.equal(merged[1], rows[1])
    assert.equal(merged[2], rows[2])
  })

  it('returns the same array reference when there is no live data yet', () => {
    const rows = [{ vesselId: 'op-1', operationId: 1, cargoMovedQty: 0 }]
    assert.equal(mergeLiveCargoProgressIntoRows(rows, {}), rows)
    assert.equal(mergeLiveCargoProgressIntoRows(rows, null), rows)
  })

  it('returns an empty array for non-array input', () => {
    assert.deepEqual(mergeLiveCargoProgressIntoRows(null, { 1: {} }), [])
    assert.deepEqual(mergeLiveCargoProgressIntoRows(undefined, { 1: {} }), [])
  })
})

describe('formatAvgFlowRateLabel', () => {
  it('formats positive rates', () => {
    assert.equal(formatAvgFlowRateLabel(50, 'MT'), 'Avg 50 MT/h')
    assert.equal(formatAvgFlowRateLine(12.34, 'KL'), 'Avg 12.3 KL/h')
  })

  it('returns null when rate is missing or zero', () => {
    assert.equal(formatAvgFlowRateLabel(0), null)
    assert.equal(formatAvgFlowRateLabel(null), null)
  })
})
