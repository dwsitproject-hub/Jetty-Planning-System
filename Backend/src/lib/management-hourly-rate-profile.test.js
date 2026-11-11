import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bandForRate, buildHourlyRateProfile } from './management-hourly-rate-profile.js';

const hour = (h, qty, status = 'active', extra = {}) => ({
  hourStart: `2026-10-01T${String(h).padStart(2, '0')}:00:00.000Z`,
  hourEnd: `2026-10-01T${String(h + 1).padStart(2, '0')}:00:00.000Z`,
  qtyMoved: qty,
  displayQtyMoved: qty,
  movementStatus: status,
  ...extra,
});

describe('bandForRate', () => {
  it('puts boundary values in the lower band', () => {
    assert.equal(bandForRate(100), '75_100');
    assert.equal(bandForRate(100.1), 'gt100');
    assert.equal(bandForRate(75), '50_75');
    assert.equal(bandForRate(25), '0_25');
    assert.equal(bandForRate(0.5), '0_25');
  });

  it('treats zero and missing as no flow', () => {
    assert.equal(bandForRate(0), 'zero');
    assert.equal(bandForRate(null), 'zero');
  });
});

describe('buildHourlyRateProfile', () => {
  it('returns null without hourly data', () => {
    assert.equal(buildHourlyRateProfile([]), null);
  });

  it('bands each hour and counts pauses inside the window as no flow', () => {
    const p = buildHourlyRateProfile(
      [hour(0, 120), hour(1, 80), hour(2, 0, 'flat_movement'), hour(4, 30)],
      {
        windowStartMs: Date.parse('2026-10-01T00:00:00Z'),
        windowEndMs: Date.parse('2026-10-01T05:00:00Z'),
      }
    );
    assert.deepEqual(p.bands, { gt100: 1, '75_100': 1, '50_75': 0, '25_50': 1, '0_25': 0, zero: 2 });
    assert.equal(p.totalHours, 5);
    assert.deepEqual(
      p.series.map((s) => s.r),
      [120, 80, 0, 0, 30]
    );
  });

  it('sums tank lines in the same clock hour', () => {
    const p = buildHourlyRateProfile([hour(0, 60), hour(0, 50)]);
    assert.equal(p.bands.gt100, 1);
  });

  it('excludes incomplete and direction-mismatch hours from the bands', () => {
    const p = buildHourlyRateProfile([hour(0, 90), hour(1, 40, 'incomplete'), hour(2, 40, 'active', { directionMismatch: true })]);
    assert.equal(p.bands['75_100'], 1);
    assert.equal(p.excludedHours, 2);
    assert.equal(p.totalHours, 1);
    assert.deepEqual(p.series.map((s) => s.r), [90, null, null]);
  });

  it('uses the actual minutes of a partial hour', () => {
    const p = buildHourlyRateProfile([
      { hourStart: '2026-10-01T00:30:00.000Z', hourEnd: '2026-10-01T01:00:00.000Z', qtyMoved: 60, movementStatus: 'active' },
    ]);
    assert.equal(p.bands.gt100, 0.5);
  });
});
