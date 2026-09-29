import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeWaitToBerthMs, waitToBerthTooltipMode } from './waitToBerth.js'

const TA = Date.parse('2026-06-01T00:00:00Z')
const TB = Date.parse('2026-06-03T12:00:00Z')
const ETB = Date.parse('2026-06-02T08:00:00Z')
const NOW = Date.parse('2026-06-05T00:00:00Z')

describe('computeWaitToBerthMs', () => {
  it('returns TB − TA for berthed vessels', () => {
    assert.equal(
      computeWaitToBerthMs({ taMs: TA, tbMs: TB, mode: 'berthed' }),
      TB - TA
    )
  })

  it('uses ETB when TB is null for berthed mode', () => {
    assert.equal(
      computeWaitToBerthMs({ taMs: TA, tbMs: null, etbMs: ETB, mode: 'berthed' }),
      ETB - TA
    )
  })

  it('returns now − TA for waiting mode', () => {
    assert.equal(
      computeWaitToBerthMs({ taMs: TA, nowMs: NOW, mode: 'waiting' }),
      NOW - TA
    )
  })

  it('returns null when TA is missing', () => {
    assert.equal(computeWaitToBerthMs({ tbMs: TB, mode: 'berthed' }), null)
  })

  it('returns null when berth time is before TA', () => {
    assert.equal(
      computeWaitToBerthMs({ taMs: TB, tbMs: TA, mode: 'berthed' }),
      null
    )
  })

  it('returns null when now is before TA in waiting mode', () => {
    assert.equal(
      computeWaitToBerthMs({ taMs: NOW, nowMs: TA, mode: 'waiting' }),
      null
    )
  })
})

describe('waitToBerthTooltipMode', () => {
  it('identifies waiting, berthed, and ETB fallback modes', () => {
    assert.equal(waitToBerthTooltipMode({ mode: 'waiting' }), 'waiting')
    assert.equal(waitToBerthTooltipMode({ tbMs: TB, mode: 'berthed' }), 'berthed')
    assert.equal(
      waitToBerthTooltipMode({ tbMs: null, etbMs: ETB, mode: 'berthed' }),
      'berthedEtbFallback'
    )
    assert.equal(waitToBerthTooltipMode({ mode: 'berthed' }), null)
  })
})
