import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatGapDuration,
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
})
