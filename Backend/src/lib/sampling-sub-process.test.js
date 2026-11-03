import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSamplingStats,
  formatQualityMetric,
  readQualitySummary,
  summarizeSamplingRecords,
} from './sampling-sub-process.js';

describe('readQualitySummary', () => {
  it('ignores every field for non-sampling keys', () => {
    const out = readQualitySummary('key_meeting', { ffaAverage: '4.9' });
    assert.equal(out.ffaAverage.provided, false);
  });

  it('keeps omitted fields untouched and clears explicit blanks', () => {
    const out = readQualitySummary('sampling', { ffaAverage: '', dobi: '2,85' });
    assert.deepEqual(out.ffaAverage, { provided: true, value: null });
    assert.deepEqual(out.dobi, { provided: true, value: 2.85 });
    assert.equal(out.moistureAverage.provided, false);
  });

  it('rejects out-of-range values with a 400', () => {
    assert.throws(() => readQualitySummary('sampling', { ffaAverage: '101' }), { statusCode: 400 });
    assert.doesNotThrow(() => readQualitySummary('sampling', { iodineValue: '150' }));
  });
});

describe('formatQualityMetric', () => {
  it('normalises Postgres numeric strings', () => {
    assert.equal(formatQualityMetric('7.620'), '7.62');
    assert.equal(formatQualityMetric(null), null);
  });
});

describe('summarizeSamplingRecords', () => {
  it('returns null for empty payloads', () => {
    assert.equal(summarizeSamplingRecords(null), null);
    assert.equal(summarizeSamplingRecords({ records: [] }), null);
  });

  it('joins records for the activity log', () => {
    const out = summarizeSamplingRecords({ records: [{ noPalka: '1', ffa: '4.9', moisture: '0.25' }] });
    assert.equal(out, '1 (FFA:4.9, Moisture:0.25)');
  });
});

describe('computeSamplingStats', () => {
  it('averages numeric cells and skips blanks per metric', () => {
    const stats = computeSamplingStats({
      records: [
        { noPalka: '1', ffa: '4,00', moisture: '0.20' },
        { noPalka: '2', ffa: '5.00', moisture: '' },
      ],
    });
    assert.deepEqual(stats, { count: 2, avgFfa: '4.50', avgMoisture: '0.20' });
  });

  it('returns nulls when there are no records', () => {
    assert.deepEqual(computeSamplingStats(null), { count: 0, avgFfa: null, avgMoisture: null });
  });
});
