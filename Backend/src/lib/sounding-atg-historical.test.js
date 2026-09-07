import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lookupHistoricalAtgReading } from './sounding-atg-historical.js';

function mockDb(rowsByQuery) {
  return {
    query: async (sql, params) => {
      const key = sql.includes('sampled_at <=') ? 'before' : 'after';
      const tankId = params[0];
      const list = rowsByQuery[`${tankId}:${key}`] || [];
      return { rows: list.length ? [list[0]] : [] };
    },
  };
}

describe('lookupHistoricalAtgReading', () => {
  const soundedAt = '2026-09-01T08:00:00.000Z';

  it('returns found with exact match quality for sample within 1 minute', async () => {
    const db = mockDb({
      '43:before': [
        {
          id: 100,
          tank_id: 43,
          source_base_url: 'http://172.16.250.15',
          total_mass: 2720.413,
          total_observed_volume: null,
          level_mm: 1200,
          temperature_c: 44,
          sampled_at: '2026-09-01T07:59:30.000Z',
        },
      ],
    });
    const result = await lookupHistoricalAtgReading(db, { tankId: 43, soundedAt, siMetric: 'MT' });
    assert.equal(result.found, true);
    assert.equal(result.matchQuality, 'exact');
    assert.equal(result.reading.massMt, 2720.413);
    assert.equal(result.reading.source, 'sample');
    assert.equal(result.sampleId, 100);
  });

  it('returns found with near match quality for sample within tolerance', async () => {
    const db = mockDb({
      '43:before': [
        {
          id: 101,
          tank_id: 43,
          source_base_url: 'http://172.16.250.15',
          total_mass: 2700,
          total_observed_volume: null,
          level_mm: 1190,
          temperature_c: 43,
          sampled_at: '2026-09-01T07:50:00.000Z',
        },
      ],
    });
    const result = await lookupHistoricalAtgReading(db, {
      tankId: 43,
      soundedAt,
      siMetric: 'MT',
      toleranceMs: 900_000,
    });
    assert.equal(result.found, true);
    assert.equal(result.matchQuality, 'near');
  });

  it('returns no_sample when no rows match', async () => {
    const db = mockDb({});
    const result = await lookupHistoricalAtgReading(db, { tankId: 43, soundedAt, siMetric: 'MT' });
    assert.equal(result.found, false);
    assert.equal(result.reason, 'no_sample');
  });
});
