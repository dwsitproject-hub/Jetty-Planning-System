import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  activeMasterVesselGate,
  decideVesselMasterWrite,
  integrationVesselErrorField,
  LINKED_VESSEL_FIELD_ERROR,
  linkedPlanRejectsDirectVesselFields,
  parseLoaMFromMaster,
  parseMasterVesselIdBody,
  parsePositiveNumber,
  planDimensionsFromBody,
  planPartialSnapshotFromMasterRow,
  planSnapshotFromMasterRow,
  requireCompletePlanDimensions,
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

  describe('planPartialSnapshotFromMasterRow', () => {
    it('returns identity without dims when master LOA/GT/draft are empty', () => {
      const partial = planPartialSnapshotFromMasterRow({
        id: 99,
        vessel_name: 'SPOB TEST',
        vessel_length_overall: '',
        vessel_gross_tonnage: null,
        vessel_draft: null,
      });
      assert.equal(partial.master_vessel_id, 99);
      assert.equal(partial.vessel_name, 'SPOB TEST');
      assert.equal(partial.vessel_loa_m, undefined);
    });

    it('merges with body when master dims missing', () => {
      const partial = planPartialSnapshotFromMasterRow({
        id: 1,
        vessel_name: 'MV TEST',
        vessel_length_overall: '',
        vessel_gross_tonnage: null,
        vessel_draft: null,
      });
      const merged = planDimensionsFromBody(
        { vessel_loa_m: 95, vessel_gross_tonnage: 1200, vessel_draft: 4.5 },
        partial
      );
      const complete = requireCompletePlanDimensions(merged);
      assert.equal(complete.vessel_loa_m, 95);
      assert.equal(complete.vessel_gross_tonnage, 1200);
      assert.equal(complete.vessel_draft, 4.5);
    });
  });

  describe('requireCompletePlanDimensions', () => {
    it('requires all three dimension keys', () => {
      assert.match(requireCompletePlanDimensions({ vessel_loa_m: 1 }).error, /vessel_gross_tonnage/);
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
      assert.equal(snap.vessel_loa_m, 180);
      assert.equal(snap.vessel_gross_tonnage, 3500);
      assert.equal(snap.vessel_draft, 6.2);
      assert.equal(snap.vessel_type, null);
      assert.equal(snap.vessel_hull_type, null);
    });

    it('copies vessel type and hull type when the master has them', () => {
      const snap = planSnapshotFromMasterRow({
        id: 3,
        vessel_name: 'TB TEST',
        vessel_length_overall: '40',
        vessel_gross_tonnage: 500,
        vessel_draft: 3,
        vessel_type: 'tugboat',
        type_lambung: 'Single hull Single Bottom',
      });
      assert.equal(snap.vessel_type, 'tugboat');
      assert.equal(snap.vessel_hull_type, 'Single hull Single Bottom');
    });

    it('rejects a master vessel missing LOA, GT, or draft', () => {
      assert.match(planSnapshotFromMasterRow({
        id: 1,
        vessel_name: 'MV TEST',
        vessel_length_overall: '',
        vessel_gross_tonnage: 3500,
        vessel_draft: 6,
      }).error, /LOA/);
      assert.match(planSnapshotFromMasterRow({
        id: 1,
        vessel_name: 'MV TEST',
        vessel_length_overall: '180',
        vessel_gross_tonnage: null,
        vessel_draft: 6,
      }).error, /gross tonnage/);
      assert.match(planSnapshotFromMasterRow({
        id: 1,
        vessel_name: 'MV TEST',
        vessel_length_overall: '180',
        vessel_gross_tonnage: 3500,
        vessel_draft: 0,
      }).error, /draft/);
    });
  });

  describe('activeMasterVesselGate', () => {
    it('rejects an inactive master vessel', () => {
      assert.equal(activeMasterVesselGate({ is_active: false })?.error, 'Master vessel is inactive');
    });
    it('accepts an active master vessel', () => {
      assert.equal(activeMasterVesselGate({ is_active: true }), null);
    });
  });

  describe('decideVesselMasterWrite', () => {
    it('create without master_vessel_id fails', () => {
      assert.equal(parseMasterVesselIdBody(undefined)?.error, 'master_vessel_id is required');
    });

    it('linked patch rejects a free-text vessel name and keeps plan dimensions', () => {
      const rejected = decideVesselMasterWrite({
        linked: true,
        body: { vessel_name: 'X', vessel_loa_m: 1, eta: '2026-01-01' },
      });
      assert.equal(rejected.error, LINKED_VESSEL_FIELD_ERROR);
      const decision = decideVesselMasterWrite({
        linked: true,
        body: { vessel_loa_m: 121, vessel_gross_tonnage: 4000, vessel_draft: 7.2 },
      });
      assert.equal(decision.mode, 'linked-unchanged');
    });

    it('legacy patch keeps free-text and does not require a master id', () => {
      const decision = decideVesselMasterWrite({
        linked: false,
        body: { vessel_name: 'MT SENTOSA', vessel_loa_m: 120, eta: '2026-01-01' },
      });
      assert.equal(decision.mode, 'legacy');
      assert.equal(decision.masterVesselId, undefined);
    });

    it('linked re-pick returns the new master id', () => {
      const decision = decideVesselMasterWrite({
        linked: true,
        body: { master_vessel_id: 9 },
        requireMasterVesselId: true,
      });
      assert.equal(decision.mode, 'linked-repick');
      assert.equal(decision.masterVesselId, 9);
    });

    it('linked vessel-info without master_vessel_id fails', () => {
      const decision = decideVesselMasterWrite({
        linked: true,
        body: {},
        requireMasterVesselId: true,
      });
      assert.equal(decision.error, 'master_vessel_id is required');
    });
  });

  describe('planDimensionsFromBody', () => {
    const snapshot = { vessel_loa_m: 180, vessel_gross_tonnage: 3500, vessel_draft: 8 };

    it('keeps the snapshot when the body omits dimensions', () => {
      assert.deepEqual(planDimensionsFromBody({}, snapshot), snapshot);
    });

    it('replaces only the dimensions sent on the plan', () => {
      assert.deepEqual(planDimensionsFromBody({ vessel_loa_m: 121 }, snapshot), {
        vessel_loa_m: 121,
        vessel_gross_tonnage: 3500,
        vessel_draft: 8,
      });
    });

    it('rejects a non-positive plan dimension', () => {
      assert.match(planDimensionsFromBody({ vessel_draft: 0 }, snapshot).error, /vessel_draft/);
    });
  });

  describe('linkedPlanRejectsDirectVesselFields', () => {
    it('rejects vessel_name override', () => {
      assert.equal(linkedPlanRejectsDirectVesselFields({ vessel_name: 'X' }), LINKED_VESSEL_FIELD_ERROR);
    });

    it('allows plan LOA, GT, and draft', () => {
      assert.equal(linkedPlanRejectsDirectVesselFields({ vessel_loa_m: 120, vessel_gross_tonnage: 1, vessel_draft: 2 }), null);
    });
  });

  describe('validateIntegrationVesselInput', () => {
    it('accepts vessel_hub_code only', () => {
      const r = validateIntegrationVesselInput('VSL-0001', null);
      assert.equal(r.errors.length, 0);
      assert.equal(r.hubCode, 'VSL-0001');
      assert.equal(r.vesselName, null);
    });

    it('rejects vessel_name without vessel_hub_code', () => {
      const r = validateIntegrationVesselInput('', 'MV TEST');
      assert.ok(r.errors.some((e) => e.field === 'vessel_hub_code'));
    });

    it('requires vessel_hub_code', () => {
      const r = validateIntegrationVesselInput(null, '');
      assert.ok(r.errors.some((e) => e.field === 'vessel_hub_code'));
    });

    it('allows optional vessel_name cross-check when hub present', () => {
      const r = validateIntegrationVesselInput('VSL-0001', 'MV TEST');
      assert.equal(r.errors.length, 0);
      assert.equal(r.hubCode, 'VSL-0001');
      assert.equal(r.vesselName, 'MV TEST');
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
