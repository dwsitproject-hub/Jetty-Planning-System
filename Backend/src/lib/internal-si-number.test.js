import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import {
  formatInternalSiNumber,
  formatPortIdSegment,
  isInternalSiReference,
  periodForTimeZone,
} from './internal-si-number.js';

describe('internal SI number', () => {
  it('pads the port id to at least two digits and keeps longer ids', () => {
    assert.equal(formatPortIdSegment(1), '01');
    assert.equal(formatPortIdSegment(12), '12');
    assert.equal(formatPortIdSegment(100), '100');
  });

  it('formats INT-SI-<port>-YYYY-MM-#### and grows past 9999', () => {
    assert.equal(formatInternalSiNumber(1, '2026-10', 1), 'INT-SI-01-2026-10-0001');
    assert.equal(formatInternalSiNumber(2, '2026-10', 10000), 'INT-SI-02-2026-10-10000');
    assert.equal(isInternalSiReference('INT-SI-01-2026-10-0001'), true);
    assert.equal(isInternalSiReference('INT-SI-100-2026-10-0001'), true);
    assert.equal(isInternalSiReference('SI/EUP/2026/1'), false);
    assert.equal(isInternalSiReference('BG MARINA NO SI'), false);
  });

  it('uses the port time zone month and falls back when the zone is invalid', () => {
    const utcLate = new Date('2026-10-31T17:30:00.000Z');
    assert.equal(periodForTimeZone('Asia/Jakarta', utcLate), '2026-11');
    assert.equal(
      periodForTimeZone('Not/AZone', utcLate),
      DateTime.fromJSDate(utcLate, { zone: 'utc' }).setZone('Asia/Jakarta').toFormat('yyyy-MM')
    );
  });
});
