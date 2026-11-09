import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isOverrideActive,
  mapOverrideForClient,
  overrideState,
  validateOverrideRequest,
} from './tank-manual-override.js';

const NOW = Date.parse('2026-11-09T10:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

describe('tank-manual-override', () => {
  it('is off unless enabled', () => {
    assert.equal(isOverrideActive({ manual_override_enabled: false }, NOW), false);
    assert.equal(overrideState({}, NOW), 'off');
  });

  it('is on with no expiry, or before the expiry', () => {
    assert.equal(overrideState({ manual_override_enabled: true, manual_override_expires_at: null }, NOW), 'on');
    const future = new Date(NOW + DAY).toISOString();
    assert.equal(overrideState({ manual_override_enabled: true, manual_override_expires_at: future }, NOW), 'on');
  });

  it('is expired once the auto-off date has passed', () => {
    const past = new Date(NOW - 1000).toISOString();
    const row = { manual_override_enabled: true, manual_override_expires_at: past };
    assert.equal(isOverrideActive(row, NOW), false);
    assert.equal(overrideState(row, NOW), 'expired');
  });

  it('requires a reason of at least 5 characters to turn on', () => {
    assert.deepEqual(validateOverrideRequest({ enabled: true, reason: ' abc ' }, NOW), { ok: false, error: 'reason_required' });
    const ok = validateOverrideRequest({ enabled: true, reason: 'Gauge reads high' }, NOW);
    assert.equal(ok.ok, true);
    assert.equal(ok.value.reason, 'Gauge reads high');
    assert.equal(ok.value.expiresAt, null);
  });

  it('allows turning off without a reason and clears the expiry', () => {
    const r = validateOverrideRequest({ enabled: false, expiresAt: new Date(NOW + DAY).toISOString() }, NOW);
    assert.deepEqual(r, { ok: true, value: { enabled: false, reason: null, expiresAt: null } });
  });

  it('rejects an auto-off date in the past or beyond 90 days', () => {
    assert.equal(validateOverrideRequest({ enabled: true, reason: 'Sensor fault', expiresAt: new Date(NOW - DAY).toISOString() }, NOW).ok, false);
    assert.equal(validateOverrideRequest({ enabled: true, reason: 'Sensor fault', expiresAt: new Date(NOW + 91 * DAY).toISOString() }, NOW).ok, false);
    assert.equal(validateOverrideRequest({ enabled: true, reason: 'Sensor fault', expiresAt: new Date(NOW + 7 * DAY).toISOString() }, NOW).ok, true);
  });

  it('rejects a non-boolean enabled flag', () => {
    assert.equal(validateOverrideRequest({ enabled: 'yes', reason: 'Sensor fault' }, NOW).ok, false);
  });

  it('maps a row for the browser', () => {
    const m = mapOverrideForClient(
      {
        manual_override_enabled: true,
        manual_override_reason: 'Gauge reads high',
        manual_override_expires_at: new Date(NOW + DAY).toISOString(),
        manual_override_set_by_name: 'rian',
      },
      NOW
    );
    assert.equal(m.state, 'on');
    assert.equal(m.active, true);
    assert.equal(m.setBy, 'rian');
  });
});
