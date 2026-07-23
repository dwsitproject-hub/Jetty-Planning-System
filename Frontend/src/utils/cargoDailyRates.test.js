import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildCumulativeSeriesFromLoadLines,
  buildDailyBarsFromLoadLines,
  buildOperationalRateSummary,
  extractCargoLoadLinesFromTimeline,
  formatDailyRateLine,
  localDateKeyFromIso,
  pickDisplayDailyRate,
} from './cargoDailyRates.js'

describe('localDateKeyFromIso', () => {
  it('maps UTC instant to Asia/Jakarta calendar date', () => {
    assert.equal(localDateKeyFromIso('2026-07-22T17:00:00.000Z', 'Asia/Jakarta'), '2026-07-23')
  })
})

describe('buildDailyBarsFromLoadLines', () => {
  it('sums qty by local calendar day', () => {
    const bars = buildDailyBarsFromLoadLines(
      [
        { qty: 100, startedAt: '2026-07-22T02:00:00.000Z', endedAt: '2026-07-22T04:00:00.000Z' },
        { qty: 200, startedAt: '2026-07-22T10:00:00.000Z', endedAt: '2026-07-22T12:00:00.000Z' },
        { qty: 50, startedAt: '2026-07-23T01:00:00.000Z', endedAt: '2026-07-23T03:00:00.000Z' },
      ],
      'Asia/Jakarta'
    )
    assert.equal(bars.length, 2)
    assert.equal(bars[0].date, '2026-07-22')
    assert.equal(bars[0].qtyMoved, 300)
    assert.equal(bars[1].qtyMoved, 50)
  })
})

describe('pickDisplayDailyRate', () => {
  const buckets = [
    { date: '2026-07-22', qtyMoved: 300 },
    { date: '2026-07-23', qtyMoved: 4500 },
  ]

  it('prefers today when present', () => {
    const now = new Date('2026-07-23T08:00:00+07:00').getTime()
    const pick = pickDisplayDailyRate(buckets, now, 'Asia/Jakarta')
    assert.equal(pick?.date, '2026-07-23')
    assert.equal(pick?.qtyMoved, 4500)
  })

  it('falls back to latest day when today has no logs', () => {
    const now = new Date('2026-07-24T08:00:00+07:00').getTime()
    const pick = pickDisplayDailyRate(buckets, now, 'Asia/Jakarta')
    assert.equal(pick?.date, '2026-07-23')
  })
})

describe('formatDailyRateLine', () => {
  it('formats MT per day with date label', () => {
    assert.match(formatDailyRateLine(4500, 'MT', '2026-07-23'), /^4,500 MT \/ Day \(23 Jul\)$/)
  })
})

describe('extractCargoLoadLinesFromTimeline', () => {
  it('flattens cargo_operations load lines', () => {
    const lines = extractCargoLoadLinesFromTimeline([
      { milestoneKey: 'opening_hatch', cargoLoadLines: [] },
      {
        milestoneKey: 'cargo_operations',
        cargoLoadLines: [{ qty: 100, startedAt: '2026-07-23T08:00:00Z', endedAt: '2026-07-23T10:00:00Z' }],
      },
    ])
    assert.equal(lines.length, 1)
    assert.equal(lines[0].qty, 100)
  })
})

describe('buildCumulativeSeriesFromLoadLines', () => {
  it('builds running total ordered by end time', () => {
    const series = buildCumulativeSeriesFromLoadLines(
      [
        { qty: 100, startedAt: '2026-07-23T08:00:00Z', endedAt: '2026-07-23T10:00:00Z' },
        { qty: 200, startedAt: '2026-07-23T11:00:00Z', endedAt: '2026-07-23T13:00:00Z' },
      ],
      'Asia/Jakarta'
    )
    assert.equal(series.length, 2)
    assert.equal(series[0].cumulativeQty, 100)
    assert.equal(series[1].cumulativeQty, 300)
  })
})

describe('buildOperationalRateSummary', () => {
  it('returns moved, balance, hourly and daily lines', () => {
    const summary = buildOperationalRateSummary({
      totalQtyDisplay: '2,500 MT',
      loadLines: [
        { qty: 600, startedAt: '2026-06-01T00:00:00Z', endedAt: '2026-06-01T02:00:00Z' },
      ],
      dailyBars: [{ date: '2026-06-01', qtyMoved: 600 }],
      nowMs: new Date('2026-06-01T12:00:00Z').getTime(),
      timezone: 'UTC',
    })
    assert.match(summary.movedLine, /600 MT \/ 2,500 MT/)
    assert.match(summary.balanceLine, /Balance 1,900 MT/)
    assert.match(summary.hourlyLine, /Rate 300 MT \/ Hour/)
    assert.match(summary.dailyLine, /600 MT \/ Day/)
  })
})
