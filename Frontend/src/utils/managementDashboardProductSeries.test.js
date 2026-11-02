import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildProductTimeSeries,
  bucketMetaForSailedOff,
  formatWeekBucketAxisLabel,
  formatBucketTooltipTitle,
  granularityForWindow,
  enumerateBuckets,
  voyagesInSailedOffBucket,
  countVoyagesWithChartMetric,
} from './managementDashboardProductSeries.js'

describe('granularityForWindow', () => {
  it('uses week for spans up to 90 days', () => {
    const start = Date.parse('2026-01-01T00:00:00Z')
    assert.equal(granularityForWindow(start, start + 30 * 86400000), 'week')
    assert.equal(granularityForWindow(start, start + 90 * 86400000), 'week')
  })

  it('uses month for spans over 90 days', () => {
    const start = Date.parse('2026-01-01T00:00:00Z')
    assert.equal(granularityForWindow(start, start + 91 * 86400000), 'month')
  })
})

describe('voyagesInSailedOffBucket', () => {
  it('returns voyages whose sailed off matches the bucket key', () => {
    const start = Date.parse('2026-06-01T00:00:00Z')
    const end = Date.parse('2026-07-01T00:00:00Z')
    const voyages = [
      { castOff: '2026-06-10T12:00:00Z', vessel: 'A' },
      { castOff: '2026-06-12T12:00:00Z', vessel: 'B' },
      { castOff: '2026-07-05T12:00:00Z', vessel: 'C' },
    ]
    const series = buildProductTimeSeries(voyages, 'CPO', { start, end, granularity: 'week' })
    const bucketTwo = series.find((b) => b.voyageCount === 2)
    assert.ok(bucketTwo)
    const inBucket = voyagesInSailedOffBucket(voyages, bucketTwo, 'week')
    assert.equal(inBucket.length, 2)
    assert.deepEqual(
      inBucket.map((v) => v.vessel).sort(),
      ['A', 'B']
    )
  })

  it('buckets by castOff and ignores sailedAt', () => {
    const voyages = [
      {
        sailedAt: '2026-06-10T12:00:00Z',
        castOff: '2026-07-02T12:00:00Z',
        vessel: 'LeftJuly',
        wait: 5,
        commodity: 'CPO',
      },
      {
        sailedAt: '2026-07-02T12:00:00Z',
        castOff: '2026-06-10T12:00:00Z',
        vessel: 'LeftJune',
        wait: 9,
        commodity: 'CPO',
      },
    ]
    const series = buildProductTimeSeries(voyages, 'CPO', { start: Date.parse('2026-06-01T00:00:00Z'), end: Date.parse('2026-08-01T00:00:00Z'), granularity: 'month' })
    const june = series.find((b) => b.shortLabel === 'Jun 26')
    const july = series.find((b) => b.shortLabel === 'Jul 26')
    assert.ok(june && july)
    assert.deepEqual(
      voyagesInSailedOffBucket(voyages, june, 'month').map((v) => v.vessel),
      ['LeftJune']
    )
    assert.deepEqual(
      voyagesInSailedOffBucket(voyages, july, 'month').map((v) => v.vessel),
      ['LeftJuly']
    )
  })
})

describe('buildProductTimeSeries', () => {
  it('aggregates voyages into weekly buckets by sailed off', () => {
    const start = Date.parse('2026-06-01T00:00:00Z')
    const end = Date.parse('2026-07-01T00:00:00Z')
    const series = buildProductTimeSeries(
      [
        {
          castOff: '2026-06-10T12:00:00Z',
          wait: 10,
          pre: 4,
          opsH: 8,
          qty: 800,
          cargoDoneToSailH: 6,
          commodity: 'CPO',
          productRatesByKey: { CPO: { rateMtH: 100 } },
        },
        {
          castOff: '2026-06-12T12:00:00Z',
          wait: 20,
          pre: 6,
          opsH: 10,
          qty: 1000,
          cargoDoneToSailH: 8,
          commodity: 'CPO',
          productRatesByKey: { CPO: { rateMtH: 100 } },
        },
      ],
      'CPO',
      { start, end, granularity: 'week' }
    )
    const withData = series.filter((b) => b.voyageCount > 0)
    assert.ok(withData.length >= 1)
    const bucket = withData.find((b) => b.voyageCount === 2) || withData[0]
    assert.equal(bucket.avgWait, 15)
    assert.equal(bucket.avgPre, 5)
    assert.equal(bucket.avgRate, 100)
    assert.equal(bucket.waitLoggedCount, 2)
    assert.equal(bucket.avgCargoDoneToSail, 7)
  })

  it('averages each metric from full-call values; nulls excluded from mean', () => {
    const start = Date.parse('2026-06-01T00:00:00Z')
    const end = Date.parse('2026-07-01T00:00:00Z')
    const voyages = [
      {
        castOff: '2026-06-05T00:00:00Z',
        wait: 8,
        pre: null,
        opsH: 10,
        qty: 1000,
        cargoDoneToSailH: 4,
        commodity: 'CPO',
      },
      {
        castOff: '2026-06-06T00:00:00Z',
        wait: null,
        pre: 6,
        opsH: 5,
        qty: 500,
        cargoDoneToSailH: null,
        commodity: 'CPO',
      },
      {
        castOff: '2026-06-07T00:00:00Z',
        wait: 12,
        pre: 4,
        opsH: 8,
        qty: 800,
        cargoDoneToSailH: 6,
        commodity: 'CPO',
      },
    ]
    const series = buildProductTimeSeries(voyages, 'CPO', { start, end, granularity: 'week' })
    const bucket = series.find((b) => b.voyageCount === 3)
    assert.ok(bucket)
    assert.equal(bucket.avgWait, 10)
    assert.equal(bucket.waitLoggedCount, 2)
    assert.equal(bucket.avgPre, 5)
    assert.equal(bucket.preLoggedCount, 2)
    assert.equal(bucket.avgCargoDoneToSail, 5)
    assert.equal(bucket.cargoDoneLoggedCount, 2)
    assert.equal(countVoyagesWithChartMetric(voyages, 'avgWait', 'CPO'), 2)
    assert.equal(countVoyagesWithChartMetric(voyages, 'avgPre', 'CPO'), 2)
  })
})

describe('bucketMetaForSailedOff', () => {
  it('labels months for monthly granularity', () => {
    const ms = Date.parse('2026-03-15T00:00:00Z')
    const meta = bucketMetaForSailedOff(ms, 'month')
    assert.match(meta.shortLabel, /Mar 26/)
  })

  it('labels weeks as week-of-month Wn Mon yy', () => {
    assert.equal(formatWeekBucketAxisLabel(Date.parse('2026-07-06T00:00:00')), 'W1 Jul 26')
    assert.equal(formatWeekBucketAxisLabel(Date.parse('2026-07-12T00:00:00')), 'W2 Jul 26')
    assert.equal(formatWeekBucketAxisLabel(Date.parse('2026-07-27T00:00:00')), 'W4 Jul 26')
  })

  it('tooltip title uses DD/MMM/YYYY range for weekly buckets', () => {
    const bucket = {
      startMs: Date.parse('2026-06-29T00:00:00'),
      endMs: Date.parse('2026-06-29T00:00:00') + 7 * 86400000,
    }
    const title = formatBucketTooltipTitle(bucket)
    assert.match(title, /\d{2}\/\w{3}\/2026 - \d{2}\/\w{3}\/2026/)
  })
})

describe('enumerateBuckets', () => {
  it('returns at least one bucket for a day range', () => {
    const start = Date.parse('2026-06-01T00:00:00Z')
    const end = start + 7 * 86400000
    assert.ok(enumerateBuckets(start, end, 'week').length >= 1)
  })
})

describe('period granularity spot-check', () => {
  it('matches dashboard windows: 30d week, YTD-style span month', () => {
    const end = Date.parse('2026-10-02T12:00:00Z')
    const d30Start = end - 30 * 86400000
    assert.equal(granularityForWindow(d30Start, end), 'week')
    const ytdStart = Date.parse('2026-01-01T00:00:00Z')
    assert.equal(granularityForWindow(ytdStart, end), 'month')
  })

  it('bucket means match voyage-level mean for avg wait', () => {
    const start = Date.parse('2026-06-01T00:00:00Z')
    const end = Date.parse('2026-07-01T00:00:00Z')
    const voyages = [
      { castOff: '2026-06-05T00:00:00Z', wait: 8, commodity: 'CPO' },
      { castOff: '2026-06-20T00:00:00Z', wait: 12, commodity: 'CPO' },
    ]
    const series = buildProductTimeSeries(voyages, 'CPO', { start, end, granularity: 'week' })
    const pooled = series.filter((b) => b.voyageCount > 0)
    const totalV = pooled.reduce((s, b) => s + b.voyageCount, 0)
    const weighted =
      totalV > 0
        ? pooled.reduce((s, b) => s + (b.avgWait || 0) * b.voyageCount, 0) / totalV
        : null
    assert.equal(weighted, 10)
  })
})
