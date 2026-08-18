import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateScheduleTimestamp,
  validateBerthingTimeline,
} from './validateScheduleTimeline.js';

describe('validateScheduleTimestamp', () => {
  const nowMs = new Date('2026-08-18T12:00:00.000Z').getTime();

  it('rejects year 0206', () => {
    assert.match(
      validateScheduleTimestamp('0206-07-10T22:02:24.000Z', { nowMs }),
      /before 2020/i
    );
  });

  it('accepts a normal timestamp', () => {
    assert.equal(
      validateScheduleTimestamp('2026-07-29T11:30:00.000Z', { nowMs }),
      null
    );
  });
});

describe('validateBerthingTimeline', () => {
  const nowMs = new Date('2026-08-18T12:00:00.000Z').getTime();

  it('rejects ETC before TB', () => {
    assert.match(
      validateBerthingTimeline(
        {
          ta: '2026-07-10T22:02:24.000Z',
          tb: '2026-07-29T11:30:00.000Z',
          etc: '2026-07-03T15:00:00.000Z',
        },
        { nowMs }
      ),
      /ETC/i
    );
  });
});
