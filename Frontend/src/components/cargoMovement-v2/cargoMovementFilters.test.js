import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  filterCargoMovementTanks,
  tankHasAnomaly,
  tankMatchesSearch,
  computeBoardKpis,
} from './cargoMovementFilters.js';

const sampleTanks = [
  {
    tankId: '1',
    code: '3203',
    name: 'TK 3203',
    hasAtg: true,
    sourceLastPollOk: false,
    segments: [{ vesselName: 'MV Alpha', atgAuditStatus: 'sample_gap' }],
  },
  {
    tankId: '2',
    code: '3502',
    name: 'TK 3502',
    hasAtg: true,
    sourceLastPollOk: true,
    segments: [{ vesselName: 'MV Beta', atgAuditStatus: 'manual_override' }],
  },
  {
    tankId: '3',
    code: '5101',
    hasAtg: true,
    sourceLastPollOk: true,
    segments: [],
  },
];

describe('cargoMovementFilters', () => {
  it('matches search by vessel name', () => {
    assert.equal(tankMatchesSearch(sampleTanks[0], 'alpha'), true);
    assert.equal(tankMatchesSearch(sampleTanks[1], 'alpha'), false);
  });

  it('detects anomalies from sample gap or poller fault', () => {
    assert.equal(tankHasAnomaly(sampleTanks[0]), true);
    assert.equal(tankHasAnomaly(sampleTanks[1]), false);
  });

  it('filters anomalies only and hides idle', () => {
    const out = filterCargoMovementTanks(sampleTanks, {
      search: '',
      anomaliesOnly: true,
      atgOnly: false,
      hideIdle: true,
    });
    assert.deepEqual(out.map((t) => t.code), ['3203']);
  });

  it('computes KPI counts', () => {
    const kpis = computeBoardKpis(sampleTanks);
    assert.equal(kpis.anomalyCount, 1);
    assert.equal(kpis.gapCount, 1);
    assert.equal(kpis.pollFaultCount, 1);
  });
});
