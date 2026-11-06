import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatGapDuration,
  formatQty,
  formatQtyDelta,
  isSimulationStale,
  visibleHourlyRows,
  remainingTargetGapKeys,
  resyncOutcomeVariant,
  summarizePreviewByGap,
} from './atgGapDisplay.js'

describe('atgGapDisplay', () => {
  it('formats durations in hours and minutes', () => {
    assert.equal(formatGapDuration(45), '45 min')
    assert.equal(formatGapDuration(120), '2 h')
    assert.equal(formatGapDuration(150), '2 h 30 min')
  })

  it('maps resync outcomes to variants', () => {
    assert.equal(resyncOutcomeVariant('success'), 'success')
    assert.equal(resyncOutcomeVariant('no_samples'), 'warning')
    assert.equal(resyncOutcomeVariant('failed'), 'error')
    assert.equal(resyncOutcomeVariant('dry_run'), 'neutral')
  })

  it('rolls preview rows up per gap', () => {
    const byGap = summarizePreviewByGap([
      { gapKey: 'a', tankCode: '3203', archivePoints: 10, newPoints: 8, error: null },
      { gapKey: 'a', tankCode: '3204', archivePoints: 0, newPoints: 0, error: 'HTTP 500' },
      { gapKey: 'b', tankCode: '3502', archivePoints: 4, newPoints: 0, error: null },
    ])
    assert.equal(byGap.get('a').newPoints, 8)
    assert.deepEqual(byGap.get('a').tanks, ['3203', '3204'])
    assert.deepEqual(byGap.get('a').errors, ['3204: HTTP 500'])
    assert.equal(byGap.get('b').newPoints, 0)
  })

  it('lists targeted gaps that are still open after resync', () => {
    const keys = remainingTargetGapKeys({
      targetGapKeys: ['a', 'b'],
      gapsAfter: [{ gapKey: 'b' }, { gapKey: 'c' }],
    })
    assert.deepEqual(keys, ['b'])
  })

  it('formats quantity and signed change', () => {
    assert.equal(formatQty(1234.56), (1234.6).toLocaleString(undefined, { minimumFractionDigits: 1 }))
    assert.equal(formatQtyDelta(0.01), formatQty(0))
    assert.ok(formatQtyDelta(157.46).startsWith('+'))
    assert.match(formatQtyDelta(-12), /^−/)
  })

  it('shows only changed hours unless asked', () => {
    const hourly = [
      { commodity: 'CPO', changed: true },
      { commodity: 'CPO', changed: false },
      { commodity: 'RBDPO', changed: true },
    ]
    assert.equal(visibleHourlyRows(hourly, 'CPO', false).length, 1)
    assert.equal(visibleHourlyRows(hourly, 'CPO', true).length, 2)
  })

  it('flags a simulation older than 10 minutes as stale', () => {
    const now = Date.parse('2026-01-01T12:00:00Z')
    assert.equal(isSimulationStale('2026-01-01T11:55:00Z', now), false)
    assert.equal(isSimulationStale('2026-01-01T11:45:00Z', now), true)
  })
})
