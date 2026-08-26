import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateScheduleTimestamp,
  validateBerthingTimeline,
} from './validate-schedule-timeline.js';

describe('validateScheduleTimestamp', () => {
  const now = new Date('2026-08-18T12:00:00.000Z');

  it('rejects year 0206', () => {
    const r = validateScheduleTimestamp('0206-07-10T22:02:24.000Z', { now });
    assert.equal(r.ok, false);
    assert.match(r.error, /before 2020/i);
  });

  it('rejects timestamps more than 2 years in the future', () => {
    const r = validateScheduleTimestamp('2029-01-01T00:00:00.000Z', { now });
    assert.equal(r.ok, false);
    assert.match(r.error, /future/i);
  });

  it('accepts a normal timestamp', () => {
    const r = validateScheduleTimestamp('2026-07-29T11:30:00.000Z', { now });
    assert.equal(r.ok, true);
  });
});

describe('validateBerthingTimeline', () => {
  const now = new Date('2026-08-18T12:00:00.000Z');
  const ta = '2026-07-10T22:02:24.000Z';
  const tb = '2026-07-29T11:30:00.000Z';

  it('rejects ETC before TB', () => {
    const r = validateBerthingTimeline(
      { ta, tb, etc: '2026-07-03T15:00:00.000Z' },
      { now }
    );
    assert.equal(r.ok, false);
    assert.match(r.error, /ETC/i);
  });

  it('rejects TB before TA', () => {
    const r = validateBerthingTimeline(
      { ta: tb, tb: ta },
      { now }
    );
    assert.equal(r.ok, false);
    assert.match(r.error, /TB/i);
  });

  it('accepts a valid TA → TB → ETC chain', () => {
    const r = validateBerthingTimeline(
      { ta, tb, etc: '2026-08-05T15:00:00.000Z' },
      { now }
    );
    assert.equal(r.ok, true);
  });

  it('validates only provided fields', () => {
    const r = validateBerthingTimeline({ etc: '2026-08-05T15:00:00.000Z' }, { now });
    assert.equal(r.ok, true);
  });
});
