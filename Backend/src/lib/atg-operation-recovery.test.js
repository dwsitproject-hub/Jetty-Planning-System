import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildResyncAuditSummary, deriveResyncOutcome, mapLimit } from './atg-operation-recovery.js';
import { countNewArchivePoints, mergeArchiveParamRows } from './tankvision-archive.js';

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

  it('deriveResyncOutcome no_samples when archive is empty', () => {
    assert.equal(
      deriveResyncOutcome({ gapsBefore: [{}], gapsAfter: [{}], samplesInserted: 0, archiveErrors: [] }),
      'no_samples'
    );
  });

  it('countNewArchivePoints ignores stored and duplicate timestamps', () => {
    const n = countNewArchivePoints(
      ['2026-01-01T10:00:00.000Z', '2026-01-01T10:05:00.000Z', '2026-01-01T10:05:00.000Z'],
      ['2026-01-01T10:00:00.000Z']
    );
    assert.equal(n, 1);
  });

  it('deriveResyncOutcome is partial when a selected gap only shrank', () => {
    assert.equal(
      deriveResyncOutcome({ targetTotal: 4, targetClosed: 3, targetPartial: 1, samplesInserted: 119, archiveErrors: [] }),
      'partial'
    );
  });

  it('deriveResyncOutcome is success when every selected gap closed, even if others remain', () => {
    assert.equal(
      deriveResyncOutcome({ targetTotal: 4, targetClosed: 4, targetPartial: 0, samplesInserted: 119, archiveErrors: [] }),
      'success'
    );
  });

  it('mapLimit keeps input order and never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 3, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return n * 2;
    });
    assert.deepEqual(out, [2, 4, 6, 8, 10, 12]);
    assert.equal(peak, 3);
  });

  it('mapLimit handles an empty list', async () => {
    assert.deepEqual(await mapLimit([], 3, async (n) => n), []);
  });
});
