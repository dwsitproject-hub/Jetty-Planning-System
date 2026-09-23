import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LINKED_VESSEL_FIELD_ERROR,
  linkedPlanRejectsDirectVesselFields,
  parseLoaMFromMaster,
  parsePositiveNumber,
  planSnapshotFromMasterRow,
} from './resolve-master-vessel.js';

describe('resolve-master-vessel', () => {
  describe('parsePositiveNumber', () => {
    it('accepts positive numbers', () => {
      assert.equal(parsePositiveNumber(120, 'LOA'), 120);
    });
    it('rejects empty', () => {
      assert.equal(parsePositiveNumber('', 'LOA')?.error, 'LOA is required');
    });
  });

  describe('parseLoaMFromMaster', () => {
    it('parses text LOA', () => {
      assert.equal(parseLoaMFromMaster('79.5'), 79.5);
    });
  });

  describe('planSnapshotFromMasterRow', () => {
    it('builds snapshot', () => {
      const snap = planSnapshotFromMasterRow({
        id: 12,
        vessel_name: 'BG. ANDALAN 02',
        vessel_length_overall: '180',
        vessel_gross_tonnage: 3500,
        vessel_draft: 6.2,
      });
      assert.equal(snap.vessel_name, 'BG. ANDALAN 02');
      assert.equal(snap.master_vessel_id, 12);
    });
  });

  describe('linkedPlanRejectsDirectVesselFields', () => {
    it('rejects vessel_name override', () => {
      assert.equal(linkedPlanRejectsDirectVesselFields({ vessel_name: 'X' }), LINKED_VESSEL_FIELD_ERROR);
    });
  });
});
