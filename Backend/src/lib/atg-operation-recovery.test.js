import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mergeArchiveParamRows,
  buildResyncAuditSummary,
  deriveResyncOutcome,
} from './atg-operation-recovery.js';

describe('atg-operation-recovery', () => {
  it('merges archive param rows by timestamp', () => {
    const merged = mergeArchiveParamRows([
      {
        sourceBaseUrl: 'http://172.16.246.10',
        externalTankId: 1,
        paramId: 730,
        sampledAt: '2026-01-01T15:00:00.000Z',
        value: 1000,
        status: 'OK',
      },
      {
        sourceBaseUrl: 'http://172.16.246.10',
        externalTankId: 1,
        paramId: 622,
        sampledAt: '2026-01-01T15:00:00.000Z',
        value: 5000,
        status: 'OK',
      },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].values.total_mass, 1000);
    assert.equal(merged[0].values.level_mm, 5000);
  });

  it('buildResyncAuditSummary includes counts', () => {
    const s = buildResyncAuditSummary({
      operationLabel: 'MV Test (SI-1)',
      operationId: 1,
      samplesInserted: 10,
      hourlyUpserted: 2,
      gapsBefore: [{}, {}],
      gapsAfter: [],
    });
    assert.match(s, /10 samples/);
    assert.match(s, /gaps 2 → 0/);
  });

  it('deriveResyncOutcome success when gaps cleared', () => {
    assert.equal(
      deriveResyncOutcome({ gapsBefore: [{}], gapsAfter: [], samplesInserted: 5, archiveErrors: [] }),
      'success'
    );
  });

  it('deriveResyncOutcome dry_run', () => {
    assert.equal(deriveResyncOutcome({ dryRun: true }), 'dry_run');
  });
});
