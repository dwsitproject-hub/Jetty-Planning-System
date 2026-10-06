import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  waitEvidence,
  berthToStartEvidence,
  computeBerthToStartCargoHours,
  cargoDoneEvidence,
  dailyFlowFromHourlyBuckets,
  flowEvidenceSummary,
  formatEvidenceComputedHours,
  formatEvidenceDisplayedDays,
} from './managementDashboardMetricEvidence.js'

describe('waitEvidence', () => {
  it('flags missing TA', () => {
    const e = waitEvidence({ ta: null, tb: '2026-06-01T10:00:00Z', wait: null, berth: 100 })
    assert.equal(e.excludeReason, 'missing_ta')
  })

  it('shows wait when TA→TB exceeds TB→cast-off stay (not an outlier)', () => {
    const e = waitEvidence({
      ta: '2026-06-01T00:00:00Z',
      tb: '2026-06-10T00:00:00Z',
      wait: 216,
      berth: 24,
    })
    assert.equal(e.excludeReason, null)
    assert.equal(e.displayedWaitHours, 216)
    assert.ok(e.rawWaitHours > e.berthHours)
  })

  it('returns displayed wait when valid', () => {
    const e = waitEvidence({
      ta: '2026-06-01T08:00:00Z',
      tb: '2026-06-02T08:00:00Z',
      wait: 24,
      berth: 100,
    })
    assert.equal(e.displayedWaitHours, 24)
    assert.equal(e.excludeReason, null)
  })
})

describe('berthToStartEvidence', () => {
  it('uses TB and cargo operation window start', () => {
    const e = berthToStartEvidence(
      { tb: '2026-06-02T08:00:00Z', berth: 48, pre: 15.8 },
      {
        acts: [
          {
            milestoneKey: 'cargo_operations',
            startAt: '2026-06-02T23:45:00Z',
            endAt: '2026-06-03T06:05:00Z',
          },
        ],
      }
    )
    assert.equal(e.tb, '2026-06-02T08:00:00Z')
    assert.equal(e.cargoOpsStartAt, '2026-06-02T23:45:00.000Z')
    assert.equal(e.computedHours, 15.8)
    assert.equal(e.displayedHours, 15.8)
  })

  it('computeBerthToStartCargoHours hides when longer than berth', () => {
    assert.equal(
      computeBerthToStartCargoHours(
        '2026-06-02T08:00:00Z',
        '2026-06-02T23:45:00Z',
        10
      ),
      null
    )
  })
})

describe('cargoDoneEvidence', () => {
  it('explains missing sailed at', () => {
    const e = cargoDoneEvidence(
      { status: 'SAILED', sailedAt: null, cargoDoneToSailH: null },
      [
        {
          milestoneKey: 'cargo_operations',
          source: 'operational_activity',
          endAt: '2026-06-01T20:00:00Z',
        },
      ]
    )
    assert.equal(e.excludeReason, 'missing_sailed_at')
  })

  it('computes hours when valid', () => {
    const e = cargoDoneEvidence(
      {
        status: 'SAILED',
        sailedAt: '2026-06-02T08:00:00Z',
        cargoDoneToSailH: 12,
      },
      [
        {
          milestoneKey: 'cargo_operations',
          source: 'operational_activity',
          endAt: '2026-06-01T20:00:00Z',
        },
      ]
    )
    assert.equal(e.computedHours, 12)
    assert.equal(e.excludeReason, null)
  })
})

describe('dailyFlowFromHourlyBuckets', () => {
  it('aggregates by calendar day', () => {
    const days = dailyFlowFromHourlyBuckets(
      [
        {
          hourStart: '2026-07-22T02:00:00.000Z',
          rateTph: 100,
          tankDetail: [{ qtyMoved: 100 }],
        },
        {
          hourStart: '2026-07-22T10:00:00.000Z',
          rateTph: 200,
          tankDetail: [{ qtyMoved: 200 }],
        },
      ],
      'Asia/Jakarta'
    )
    assert.equal(days.length, 1)
    assert.equal(days[0].hoursActive, 2)
    assert.equal(days[0].qtyMoved, 300)
  })
})

describe('flowEvidenceSummary', () => {
  it('computes voyage rate from qty and opsH', () => {
    const s = flowEvidenceSummary({ opsH: 10, qty: 800, commodity: 'CPO' }, 'CPO')
    assert.equal(s.productQtyMt, 800)
    assert.equal(s.voyageRateMtH, 80)
  })
})

describe('evidence duration formatting', () => {
  it('formatEvidenceComputedHours uses hours', () => {
    assert.equal(formatEvidenceComputedHours(52.8), '52.8 h')
    assert.equal(formatEvidenceComputedHours(null), '—')
  })

  it('formatEvidenceDisplayedDays uses days from stored hours', () => {
    assert.equal(formatEvidenceDisplayedDays(52.8), '2.2 d')
    assert.equal(formatEvidenceDisplayedDays(7.7), '0.3 d')
  })
})
