import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCastOffAt,
  resolveTbInstantFromOperationRow,
  castOffAllowsFuture,
  CAST_OFF_FUTURE_TOLERANCE_MS,
} from './validate-cast-off.js';

describe('validateCastOffAt', () => {
  const tb = new Date('2026-05-24T16:20:00.000Z');
  const now = new Date('2026-06-20T08:00:00.000Z');

  it('rejects future cast-off', () => {
    const future = new Date(now.getTime() + CAST_OFF_FUTURE_TOLERANCE_MS + 60_000);
    const r = validateCastOffAt(future, { tbAt: tb, now, allowFuture: false });
    assert.equal(r.ok, false);
    assert.match(r.error, /future/i);
  });

  it('accepts future cast-off when allowFuture is set', () => {
    const future = new Date(now.getTime() + CAST_OFF_FUTURE_TOLERANCE_MS + 60_000);
    const r = validateCastOffAt(future, { tbAt: tb, now, allowFuture: true });
    assert.equal(r.ok, true);
  });

  it('still rejects cast-off before TB when future dates are allowed', () => {
    const r = validateCastOffAt(new Date('2026-05-20T00:00:00.000Z'), { tbAt: tb, now, allowFuture: true });
    assert.equal(r.ok, false);
    assert.match(r.error, /berthing/i);
  });

  it('rejects cast-off before TB', () => {
    const r = validateCastOffAt(new Date('2026-05-20T00:00:00.000Z'), { tbAt: tb, now });
    assert.equal(r.ok, false);
    assert.match(r.error, /berthing/i);
  });

  it('accepts cast-off between TB and now', () => {
    const r = validateCastOffAt(new Date('2026-06-08T00:43:00.000Z'), { tbAt: tb, now });
    assert.equal(r.ok, true);
  });
});

describe('castOffAllowsFuture', () => {
  const prev = process.env.CAST_OFF_ALLOW_FUTURE;

  function restore() {
    if (prev === undefined) delete process.env.CAST_OFF_ALLOW_FUTURE;
    else process.env.CAST_OFF_ALLOW_FUTURE = prev;
  }

  it('is true only for the exact word true', () => {
    try {
      process.env.CAST_OFF_ALLOW_FUTURE = 'true';
      assert.equal(castOffAllowsFuture(), true);
      process.env.CAST_OFF_ALLOW_FUTURE = 'TRUE';
      assert.equal(castOffAllowsFuture(), false);
      delete process.env.CAST_OFF_ALLOW_FUTURE;
      assert.equal(castOffAllowsFuture(), false);
    } finally {
      restore();
    }
  });
});

describe('resolveTbInstantFromOperationRow', () => {
  it('prefers plan TB when linked', () => {
    const d = resolveTbInstantFromOperationRow({
      shipment_plan_id: 1,
      plan_tb: '2026-05-24T16:20:00.000Z',
      tb: '2026-05-25T00:00:00.000Z',
    });
    assert.equal(d?.toISOString(), '2026-05-24T16:20:00.000Z');
  });
});
