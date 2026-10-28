import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLING_STATUS, deriveSamplingStatus, toSamplingSummary } from './sampling-sub-process.js';

describe('deriveSamplingStatus', () => {
  it('is not started without a saved row', () => {
    assert.equal(deriveSamplingStatus(undefined), SAMPLING_STATUS.NOT_STARTED);
  });

  it('is done for an explicit Done status', () => {
    assert.equal(deriveSamplingStatus({ status: 'Done' }), SAMPLING_STATUS.DONE);
  });

  it('is a draft for In Progress or an empty saved row', () => {
    assert.equal(deriveSamplingStatus({ status: 'In Progress' }), SAMPLING_STATUS.DRAFT);
    assert.equal(deriveSamplingStatus({ status: null, payload_json: { records: [] } }), SAMPLING_STATUS.DRAFT);
  });

  it('treats recorded palka rows with no explicit status as done, like the Loading hub', () => {
    const row = { status: null, payload_json: { records: [{ noPalka: '1', ffa: '4', moisture: '0.2' }] } };
    assert.equal(deriveSamplingStatus(row), SAMPLING_STATUS.DONE);
  });
});

describe('toSamplingSummary', () => {
  it('prefers the stored report averages and falls back to computed ones', () => {
    const records = [
      { noPalka: '1', ffa: '4.00', moisture: '0.20' },
      { noPalka: '2', ffa: '5.00', moisture: '0.40' },
    ];
    const stored = toSamplingSummary({
      status: 'Done',
      payload_json: { records },
      ffa_average: '4.910',
      moisture_average: null,
      document_count: 2,
      updated_by_name: 'Sari',
    });
    assert.equal(stored.avgFfa, '4.91');
    assert.equal(stored.avgMoisture, '0.30');
    assert.equal(stored.recordCount, 2);
    assert.equal(stored.documentCount, 2);
    assert.equal(stored.updatedByName, 'Sari');
  });

  it('returns zeroed values for an operation with no sampling row', () => {
    const empty = toSamplingSummary(undefined);
    assert.equal(empty.status, SAMPLING_STATUS.NOT_STARTED);
    assert.equal(empty.recordCount, 0);
    assert.equal(empty.avgFfa, null);
  });
});
