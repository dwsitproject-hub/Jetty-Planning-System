import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  activeOverrides,
  buildOverrideRequest,
  expiryFromDate,
  expiryFromDays,
  overrideState,
} from './tankManualOverride.js'

const NOW = Date.parse('2026-11-09T10:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const tank = (code, state, expiresAt = null) => ({ code, manualOverride: { state, expiresAt } })

describe('tankManualOverride', () => {
  it('defaults to off', () => {
    assert.equal(overrideState({}), 'off')
    assert.equal(overrideState(tank('A', 'expired')), 'expired')
  })

  it('lists only tanks that are on, soonest auto-off first, no expiry last', () => {
    const rows = [
      tank('A', 'on', null),
      tank('B', 'off'),
      tank('C', 'on', new Date(NOW + 5 * DAY).toISOString()),
      tank('D', 'on', new Date(NOW + 1 * DAY).toISOString()),
      tank('E', 'expired', new Date(NOW - DAY).toISOString()),
    ]
    assert.deepEqual(activeOverrides(rows).map((t) => t.code), ['D', 'C', 'A'])
  })

  it('computes the auto-off time from days or a picked date', () => {
    assert.equal(expiryFromDays(7, NOW), new Date(NOW + 7 * DAY).toISOString())
    assert.equal(expiryFromDate('not a date'), null)
    assert.ok(new Date(expiryFromDate('2026-11-16')).getTime() > NOW)
  })

  it('needs a reason of 5+ characters to turn on', () => {
    assert.deepEqual(buildOverrideRequest({ enabled: true, reason: 'abc', expiryChoice: 'none' }, NOW), { ok: false, error: 'reason' })
    const ok = buildOverrideRequest({ enabled: true, reason: 'Gauge reads high', expiryChoice: 'days', days: 7 }, NOW)
    assert.equal(ok.ok, true)
    assert.equal(ok.body.expiresAt, new Date(NOW + 7 * DAY).toISOString())
  })

  it('turning off needs no reason and sends no expiry', () => {
    assert.deepEqual(buildOverrideRequest({ enabled: false, reason: '', expiryChoice: 'days', days: 7 }, NOW), {
      ok: true,
      body: { enabled: false, reason: '', expiresAt: null },
    })
  })

  it('rejects a picked date in the past', () => {
    assert.deepEqual(buildOverrideRequest({ enabled: true, reason: 'Sensor fault', expiryChoice: 'date', date: '2026-11-01' }, NOW), { ok: false, error: 'date' })
  })

  it('allows no expiry', () => {
    assert.equal(buildOverrideRequest({ enabled: true, reason: 'Sensor fault', expiryChoice: 'none' }, NOW).body.expiresAt, null)
  })
})
