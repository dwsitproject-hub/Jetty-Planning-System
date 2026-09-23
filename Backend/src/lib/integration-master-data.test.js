import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deriveExternalStatus,
  matchBreakdownLineIndex,
  normalizeLongName,
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
});
