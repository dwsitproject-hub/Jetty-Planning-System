import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  integrationVesselErrorField,
  LINKED_VESSEL_FIELD_ERROR,
  linkedPlanRejectsDirectVesselFields,
  parseLoaMFromMaster,
  parsePositiveNumber,
  planSnapshotFromMasterRow,
  validateIntegrationVesselInput,
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

  describe('validateIntegrationVesselInput', () => {
    it('accepts vessel_hub_code only', () => {
      const r = validateIntegrationVesselInput('VSL-0001', null);
      assert.equal(r.errors.length, 0);
      assert.equal(r.hubCode, 'VSL-0001');
      assert.equal(r.vesselName, null);
    });

    it('accepts vessel_name only', () => {
      const r = validateIntegrationVesselInput('', 'MV TEST');
      assert.equal(r.errors.length, 0);
      assert.equal(r.hubCode, null);
      assert.equal(r.vesselName, 'MV TEST');
    });

    it('requires at least one identifier', () => {
      const r = validateIntegrationVesselInput(null, '');
      assert.ok(r.errors.length >= 2);
    });
  });

  describe('integrationVesselErrorField', () => {
    it('maps unknown vessel_hub_code to vessel_hub_code field', () => {
      assert.equal(
        integrationVesselErrorField('No master vessel found for vessel_hub_code "X"', { hubCode: 'X' }),
        'vessel_hub_code'
      );
    });
  });
});
