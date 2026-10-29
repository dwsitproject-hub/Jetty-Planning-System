import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  deriveExternalStatus,
  matchBreakdownLineIndex,
  normalizeLongName,
  resolvePartnerCargoOpsWindow,
  PARTNER_CARGO_DONE_SUBSELECT,
  PARTNER_STATUSES,
  PARTNER_SUBMISSION_BY_PLAN_SQL,
  PARTNER_SUBMISSION_BY_SI_SQL,
  PARTNER_SUBMISSION_LOOKUP_SQL,
} from './integration-master-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('integration-master-data', () => {
  describe('normalizeLongName', () => {
    it('trims and returns null for empty', () => {
      assert.equal(normalizeLongName('  ACME  '), 'ACME');
      assert.equal(normalizeLongName(''), null);
      assert.equal(normalizeLongName(null), null);
    });
  });

  describe('deriveExternalStatus', () => {
    it('returns Rejected when plan rejected', () => {
      assert.equal(deriveExternalStatus({ approval_status: 'Rejected' }), 'Rejected');
    });
    const approved = { approval_status: 'Approved' };
    const TB = '2026-10-02T10:00:00.000Z';
    const START = '2026-10-02T12:00:00.000Z';
    const DONE = '2026-10-03T06:00:00.000Z';

    it('returns Allocated when a jetty is assigned but TB is not set', () => {
      assert.equal(deriveExternalStatus({ ...approved, op_status: 'ALLOCATED' }), 'Allocated');
    });
    it('returns Berthed once TB is set', () => {
      assert.equal(deriveExternalStatus({ ...approved, op_status: 'DOCKED', op_tb: TB }), 'Berthed');
      assert.equal(
        deriveExternalStatus({ ...approved, op_status: 'DOCKED', sp_docking_start_time: TB }),
        'Berthed'
      );
    });
    it('returns Start Cargo once the cargo window has started, even before cargo ops status moves', () => {
      assert.equal(
        deriveExternalStatus({
          ...approved,
          op_status: 'DOCKED',
          op_tb: TB,
          op_cargo_ops_window_start_at: START,
        }),
        'Start Cargo'
      );
    });
    it('does not treat IN_PROGRESS alone as Start Cargo (any activity sets it)', () => {
      assert.equal(
        deriveExternalStatus({ ...approved, op_status: 'IN_PROGRESS', op_tb: TB }),
        'Berthed'
      );
    });
    it('does not treat POST_OPS alone as Cargo Done (first final check sets it)', () => {
      assert.equal(
        deriveExternalStatus({
          ...approved,
          op_status: 'POST_OPS',
          op_tb: TB,
          op_cargo_ops_window_start_at: START,
        }),
        'Start Cargo'
      );
    });
    it('returns Cargo Done when cargo_done_at is set, also during sign-off', () => {
      const row = {
        ...approved,
        op_tb: TB,
        op_cargo_ops_window_start_at: START,
        op_cargo_done_at: DONE,
      };
      assert.equal(deriveExternalStatus({ ...row, op_status: 'POST_OPS' }), 'Cargo Done');
      assert.equal(deriveExternalStatus({ ...row, op_status: 'SIGNOFF_APPROVED' }), 'Cargo Done');
    });
    it('moves back a stage when the time that set it is cleared', () => {
      const row = { ...approved, op_status: 'IN_PROGRESS', op_tb: TB, op_cargo_ops_window_start_at: START };
      assert.equal(deriveExternalStatus(row), 'Start Cargo');
      assert.equal(deriveExternalStatus({ ...row, op_cargo_ops_window_start_at: null }), 'Berthed');
      assert.equal(deriveExternalStatus({ ...row, op_cargo_ops_window_start_at: null, op_tb: null }), 'Allocated');
    });
    it('returns Approved when approved without allocation', () => {
      assert.equal(deriveExternalStatus({ approval_status: 'Approved', op_status: null }), 'Approved');
    });
    it('returns Pending when submitted', () => {
      assert.equal(deriveExternalStatus({ approval_status: 'Submitted' }), 'Pending');
    });
    it('returns Sailed Off when operation has SAILED status', () => {
      assert.equal(
        deriveExternalStatus({ approval_status: 'Approved', op_status: 'SAILED' }),
        'Sailed Off'
      );
    });
    it('PARTNER_STATUSES lists every stage in lifecycle order', () => {
      assert.deepEqual(PARTNER_STATUSES, [
        'Pending',
        'Approved',
        'Rejected',
        'Deleted',
        'Allocated',
        'Berthed',
        'Start Cargo',
        'Cargo Done',
        'Sailed Off',
      ]);
    });
    it('returns Deleted when the plan or instruction was soft-deleted, even after a reject', () => {
      assert.equal(
        deriveExternalStatus({ approval_status: 'Rejected', plan_deleted_at: '2026-10-27T06:00:00.000Z' }),
        'Deleted'
      );
      assert.equal(
        deriveExternalStatus({ approval_status: 'Submitted', si_deleted_at: '2026-10-27T06:00:00.000Z' }),
        'Deleted'
      );
    });
  });

  describe('matchBreakdownLineIndex', () => {
    const lines = [
      { line_order: 0, contract_no: 'CTR-1' },
      { line_order: 1, contract_no: 'CTR-2' },
    ];

    it('matches by line_order', () => {
      assert.equal(matchBreakdownLineIndex(lines, { lineOrder: 1 }), 1);
    });

    it('matches by contract_no case-insensitive', () => {
      assert.equal(matchBreakdownLineIndex(lines, { contractNo: 'ctr-2' }), 1);
    });

    it('returns -1 when no match', () => {
      assert.equal(matchBreakdownLineIndex(lines, { lineOrder: 9 }), -1);
    });
  });

  it('PARTNER_SUBMISSION_LOOKUP_SQL uses cargo_operations window subselects', () => {
    assert.match(PARTNER_SUBMISSION_LOOKUP_SQL, /milestone_key = 'cargo_operations'/);
    assert.match(PARTNER_SUBMISSION_LOOKUP_SQL, /op_cargo_ops_window_start_at/);
    assert.match(PARTNER_SUBMISSION_LOOKUP_SQL, /op_cargo_ops_window_end_at/);
  });

  it('resolvePartnerCargoOpsWindow queries by operation id', async () => {
    const seen = [];
    const db = {
      query: async (_sql, params) => {
        seen.push(params);
        return {
          rows: [
            {
              window_start_at: '2026-09-28T07:45:00.000Z',
              window_end_at: '2026-09-28T18:00:00.000Z',
              op_cargo_done_at: '2026-09-28T20:30:00.000Z',
            },
          ],
        };
      },
    };
    const win = await resolvePartnerCargoOpsWindow(db, 99);
    assert.equal(win.startAt, '2026-09-28T07:45:00.000Z');
    assert.equal(win.endAt, '2026-09-28T18:00:00.000Z');
    assert.equal(win.doneAt, '2026-09-28T20:30:00.000Z');
    assert.deepEqual(seen[0], [99]);
  });

  describe('Cargo Done SQL', () => {
    it('is selected by every partner submission query', () => {
      for (const sql of [PARTNER_SUBMISSION_LOOKUP_SQL, PARTNER_SUBMISSION_BY_PLAN_SQL, PARTNER_SUBMISSION_BY_SI_SQL]) {
        assert.match(sql, /AS op_cargo_done_at/);
      }
    });

    it('returns NULL while a cargo_operations segment has no end (open segment guard)', () => {
      assert.match(PARTNER_CARGO_DONE_SUBSELECT, /WHEN EXISTS[\s\S]*milestone_key = 'cargo_operations'[\s\S]*oa\.end_at IS NULL[\s\S]*THEN NULL/);
    });

    it('uses the same final-check keys and time fallback as the management dashboard', () => {
      const frontend = readFileSync(
        path.resolve(__dirname, '../../../Frontend/src/data/dailyActivitiesReportFromApi.js'),
        'utf8'
      );
      const keys = [...frontend.matchAll(/id: 'post_final_[a-z_]+',[\s\S]*?subProcessKeys: \[([^\]]+)\]/g)]
        .flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((k) => k[1]))
        .sort();
      assert.equal(keys.length, 4);
      const sqlKeys = [...PARTNER_CARGO_DONE_SUBSELECT.match(/sub_process_key IN \(([^)]+)\)/)[1].matchAll(/'([a-z_]+)'/g)]
        .map((k) => k[1])
        .sort();
      assert.deepEqual(sqlKeys, keys);
      assert.match(PARTNER_CARGO_DONE_SUBSELECT, /COALESCE\(sp\.end_at, sp\.start_at, sp\.occurred_at\)/);
    });
  });
});
