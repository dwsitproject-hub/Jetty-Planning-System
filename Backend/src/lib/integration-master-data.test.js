import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deriveExternalStatus,
  matchBreakdownLineIndex,
  normalizeLongName,
  resolvePartnerCargoOpsEntry1Ats,
  PARTNER_SUBMISSION_LOOKUP_SQL,
} from './integration-master-data.js';

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
    it('returns Allocated when operation is active', () => {
      assert.equal(
        deriveExternalStatus({ approval_status: 'Approved', op_status: 'IN_PROGRESS' }),
        'Allocated'
      );
    });
    it('returns Approved when approved without allocation', () => {
      assert.equal(deriveExternalStatus({ approval_status: 'Approved', op_status: null }), 'Approved');
    });
    it('returns Pending when submitted', () => {
      assert.equal(deriveExternalStatus({ approval_status: 'Submitted' }), 'Pending');
    });
    it('returns Sailed when operation has SAILED status', () => {
      assert.equal(
        deriveExternalStatus({ approval_status: 'Approved', op_status: 'SAILED' }),
        'Sailed'
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

  it('PARTNER_SUBMISSION_LOOKUP_SQL uses Entry 1 load-line ATS subselect', () => {
    assert.match(PARTNER_SUBMISSION_LOOKUP_SQL, /operation_cargo_load_lines/);
    assert.match(PARTNER_SUBMISSION_LOOKUP_SQL, /op_cargo_ops_entry1_start_at/);
    assert.doesNotMatch(PARTNER_SUBMISSION_LOOKUP_SQL, /op_cargo_ops_activity_start_at/);
  });

  it('resolvePartnerCargoOpsEntry1Ats queries by operation id', async () => {
    const seen = [];
    const db = {
      query: async (_sql, params) => {
        seen.push(params);
        return { rows: [{ ats: '2026-09-28T07:45:00.000Z' }] };
      },
    };
    const ats = await resolvePartnerCargoOpsEntry1Ats(db, 99);
    assert.equal(ats, '2026-09-28T07:45:00.000Z');
    assert.deepEqual(seen[0], [99]);
  });
});
