import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  distinctOperationIds,
  findEntriesUsingWindow,
  manualEntries,
  mapEntryRow,
} from './atg-source-recovery-impact.js';

const row = (over = {}) => ({
  load_line_id: '12',
  entry_no: '2',
  atg_qty_mode: 'manual',
  operation_id: '90',
  vessel_name: 'MT. MULIA KARSA 2',
  reference_number: '331/PT.EUP-BD/XI/2026',
  tank_codes: ['3203'],
  ...over,
});

describe('atg-source-recovery-impact', () => {
  it('maps an entry row with its label, number and mode', () => {
    assert.deepEqual(mapEntryRow(row()), {
      operationId: 90,
      loadLineId: 12,
      operationLabel: 'MT. MULIA KARSA 2 (331/PT.EUP-BD/XI/2026)',
      entryNo: 2,
      entryMode: 'manual',
      tankCodes: ['3203'],
    });
  });

  it('treats any non-manual mode as auto and copes with a missing vessel or plan reference', () => {
    const e = mapEntryRow(row({ atg_qty_mode: null, vessel_name: null, reference_number: null }));
    assert.equal(e.entryMode, 'auto');
    assert.equal(e.operationLabel, '—');
  });

  it('keeps only Manual entries and unique operation ids', () => {
    const entries = [
      mapEntryRow(row()),
      mapEntryRow(row({ load_line_id: '13', entry_no: '3', atg_qty_mode: 'auto' })),
      mapEntryRow(row({ load_line_id: '20', operation_id: '91' })),
    ];
    assert.equal(manualEntries(entries).length, 2);
    assert.deepEqual(distinctOperationIds(entries), [90, 91]);
  });

  it('skips the query when no tank is given', async () => {
    const db = {
      query() {
        throw new Error('must not query');
      },
    };
    assert.deepEqual(await findEntriesUsingWindow(db, { portId: 1, tankIds: [], startAt: 'a', endAt: 'b' }), []);
  });

  it('passes port, tanks and the window to the query', async () => {
    let seen;
    const db = {
      async query(_sql, params) {
        seen = params;
        return { rows: [row()] };
      },
    };
    const out = await findEntriesUsingWindow(db, {
      portId: 1,
      tankIds: [27],
      startAt: '2026-11-25T15:00:00Z',
      endAt: '2026-11-26T00:30:00Z',
    });
    assert.equal(out.length, 1);
    assert.deepEqual(seen, [1, [27], '2026-11-25T15:00:00.000Z', '2026-11-26T00:30:00.000Z']);
  });
});
