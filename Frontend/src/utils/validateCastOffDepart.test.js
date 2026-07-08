import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validateCastOffDepart, CAST_OFF_FUTURE_TOLERANCE_MS } from './validateCastOffDepart.js'

describe('validateCastOffDepart', () => {
  const tb = new Date('2026-05-24T16:20:00.000Z')
  const nowMs = new Date('2026-06-20T08:00:00.000Z').getTime()

  it('rejects future cast-off beyond tolerance', () => {
    const future = new Date(nowMs + CAST_OFF_FUTURE_TOLERANCE_MS + 60_000)
    assert.match(
      validateCastOffDepart(future, { tbAt: tb, nowMs }),
      /cannot be in the future/i
    )
  })

  it('rejects cast-off before TB', () => {
    const beforeTb = new Date('2026-05-20T00:00:00.000Z')
    assert.match(
      validateCastOffDepart(beforeTb, { tbAt: tb, nowMs }),
      /berthing/i
    )
  })

  it('accepts cast-off between TB and now', () => {
    const ok = new Date('2026-06-08T00:43:00.000Z')
    assert.equal(validateCastOffDepart(ok, { tbAt: tb, nowMs }), null)
  })
})
