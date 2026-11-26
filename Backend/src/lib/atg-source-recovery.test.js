import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recoverAtgSourceRange } from './atg-source-recovery.js';

const BASE = 'http://172.16.250.15';
const START = '2026-11-25T15:30:00Z';
const END = '2026-11-25T16:30:00Z';

/** Archive response with one point per 15 minutes for the requested window. */
function archiveFor(paramValues) {
  return async (_base, _auth, externalTankId, paramId, startUnix, endUnix) => {
    if (paramValues.failTank === externalTankId) throw new Error('HTTP 500');
    const parameterlist = [];
    for (let t = startUnix + 300; t < endUnix; t += 900) {
      parameterlist.push({ timestamp: t, value: paramValues.valueFor(paramId), statusString: 'OK' });
    }
    return { parameterlist };
  };
}

function fakeDb({ storedTimes = [] } = {}) {
  const inserted = [];
  const known = new Set(storedTimes);
  return {
    inserted,
    async query(sql, params) {
      if (sql.includes('FROM tank_gauging_sources LIMIT 1')) return { rows: [{ ok: true }] };
      if (sql.includes('FROM tank_gauging_sources')) {
        return {
          rows: [{ id: 2, port_id: 1, base_url: BASE, label: 'NXA820_BT_1', auth_type: 'none' }],
        };
      }
      if (sql.includes('FROM tank_gauging_tank_map')) {
        return {
          rows: [
            { tank_id: 27, external_tank_id: 101, source_base_url: BASE, code: '3203' },
            { tank_id: 28, external_tank_id: 102, source_base_url: BASE, code: '3502' },
          ],
        };
      }
      if (sql.includes('SELECT sampled_at FROM tank_gauging_samples')) {
        return { rows: params[0] === 27 ? storedTimes.map((t) => ({ sampled_at: t })) : [] };
      }
      if (sql.includes('INSERT INTO tank_gauging_samples')) {
        const key = `${params[0]}|${params[8]}`;
        if (known.has(key)) return { rowCount: 0, rows: [] };
        known.add(key);
        inserted.push({ tankId: params[0], sampledAt: params[8], mass: params[2] });
        return { rowCount: 1, rows: [{ id: inserted.length }] };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
    },
  };
}

const base = { portId: 1, sourceBaseUrl: BASE, startAt: START, endAt: END };

describe('recoverAtgSourceRange', () => {
  it('dry run reports archive points without writing', async () => {
    const db = fakeDb();
    const r = await recoverAtgSourceRange(db, {
      ...base,
      fetchArchive: archiveFor({ valueFor: () => 100 }),
    });
    assert.equal(r.dryRun, true);
    assert.equal(r.tanks.length, 2);
    assert.deepEqual(r.tanks.map((t) => t.tankId), [27, 28]);
    assert.ok(r.totals.archivePoints > 0);
    assert.equal(r.totals.newPoints, r.totals.archivePoints);
    assert.equal(r.totals.inserted, 0);
    assert.equal(db.inserted.length, 0);
  });

  it('apply inserts each missing sample once', async () => {
    const db = fakeDb();
    const r = await recoverAtgSourceRange(db, {
      ...base,
      dryRun: false,
      fetchArchive: archiveFor({ valueFor: (p) => (p === 730 ? 250.5 : 1) }),
    });
    assert.equal(r.dryRun, false);
    assert.ok(r.totals.inserted > 0);
    assert.equal(db.inserted.length, r.totals.inserted);
    assert.ok(db.inserted.every((s) => s.mass === 250.5));
  });

  it('does not insert samples that already exist', async () => {
    const db = fakeDb();
    const fetchArchive = archiveFor({ valueFor: () => 5 });
    await recoverAtgSourceRange(db, { ...base, dryRun: false, fetchArchive });
    const firstRun = db.inserted.length;
    const again = await recoverAtgSourceRange(db, { ...base, dryRun: false, fetchArchive });
    assert.equal(again.totals.inserted, 0);
    assert.equal(db.inserted.length, firstRun);
  });

  it('skips archive points that carry no measurement', async () => {
    const db = fakeDb();
    const r = await recoverAtgSourceRange(db, {
      ...base,
      dryRun: false,
      fetchArchive: archiveFor({ valueFor: () => null }),
    });
    assert.equal(r.totals.inserted, 0);
    assert.ok(r.totals.skippedEmpty > 0);
  });

  it('reports a tank whose download failed', async () => {
    const db = fakeDb();
    const r = await recoverAtgSourceRange(db, {
      ...base,
      fetchArchive: archiveFor({ valueFor: () => 1, failTank: 102 }),
    });
    assert.equal(r.totals.tanksWithErrors, 1);
    assert.equal(r.tanks.find((t) => t.tankCode === '3502').errors[0], 'HTTP 500');
  });

  it('rejects a source that is not configured for the port', async () => {
    await assert.rejects(
      recoverAtgSourceRange(fakeDb(), { ...base, sourceBaseUrl: 'http://10.0.0.9' }),
      /No enabled ATG source/
    );
  });

  it('rejects a window longer than seven days', async () => {
    await assert.rejects(
      recoverAtgSourceRange(fakeDb(), { ...base, endAt: '2026-12-10T00:00:00Z' }),
      /maximum span/
    );
  });
});
