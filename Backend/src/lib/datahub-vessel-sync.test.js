/**
 * Unit tests for the DataHub vessel diff engine.
 * Run: npm run test:datahub
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSyncPlan, diffVesselFields, normalizeForCompare } from './datahub-vessel-sync.js';

function hubVessel(name, overrides = {}, values = {}) {
  return {
    hubCode: 'VSL-0001',
    hubRecordId: '11111111-1111-1111-1111-111111111111',
    hubVersion: 1,
    hubUpdatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
    values: {
      vessel_name: name,
      vessel_imo: null,
      vessel_mmsi: null,
      vessel_code_sap: null,
      vessel_capacity_mt: null,
      vessel_gross_tonnage: null,
      vessel_draft: null,
      vessel_length_overall: null,
      vessel_type: null,
      heater: null,
      type_lambung: null,
      type_charter: null,
      ...values,
    },
  };
}

describe('datahub-vessel-sync', () => {
  it('treats Postgres numeric strings as equal to hub numbers', () => {
    assert.equal(normalizeForCompare('vessel_gross_tonnage', '1878.000'), 1878);
    assert.equal(normalizeForCompare('vessel_draft', '3.90'), 3.9);
    assert.equal(normalizeForCompare('vessel_name', '  MT X  '), 'MT X');
    assert.equal(normalizeForCompare('vessel_imo', ''), null);
    assert.equal(normalizeForCompare('heater', true), true);
  });

  it('reports no diff when only the numeric representation differs', () => {
    const local = { vessel_name: 'MT A', vessel_gross_tonnage: '1878.000', vessel_draft: '3.90' };
    const hub = { vessel_name: 'MT A', vessel_gross_tonnage: 1878, vessel_draft: 3.9 };
    assert.deepEqual(diffVesselFields(local, hub), {});
  });

  it('classifies a vessel missing locally as new', () => {
    const { items, summary } = buildSyncPlan([hubVessel('MT NEW', {}, { vessel_type: 'tanker' })], []);
    assert.equal(summary.newCount, 1);
    assert.equal(items[0].diffKind, 'new');
    assert.equal(items[0].vesselId, null);
    assert.equal(items[0].fieldDiff.vessel_type.from, null);
    assert.equal(items[0].fieldDiff.vessel_type.to, 'tanker');
  });

  it('classifies a field change as changed with a per-field diff', () => {
    const local = [
      { id: 5, hub_code: 'VSL-0001', vessel_name: 'MT A', vessel_draft: '3.90', vessel_type: 'barge' },
    ];
    const { items, summary } = buildSyncPlan(
      [hubVessel('MT A', {}, { vessel_draft: 4.2, vessel_type: 'tanker' })],
      local
    );
    assert.equal(summary.changedCount, 1);
    assert.equal(items[0].diffKind, 'changed');
    assert.equal(items[0].vesselId, 5);
    assert.deepEqual(items[0].fieldDiff.vessel_draft, { from: 3.9, to: 4.2 });
    assert.deepEqual(items[0].fieldDiff.vessel_type, { from: 'barge', to: 'tanker' });
  });

  it('classifies an identical record as unchanged', () => {
    const local = [{ id: 5, hub_code: 'VSL-0001', vessel_name: 'MT A', vessel_draft: '3.90' }];
    const { items, summary } = buildSyncPlan([hubVessel('MT A', {}, { vessel_draft: 3.9 })], local);
    assert.equal(summary.unchangedCount, 1);
    assert.equal(items[0].diffKind, 'unchanged');
    assert.deepEqual(items[0].fieldDiff, {});
  });

  it('matches on name when the local row has no hub code yet, and flags the new link', () => {
    const local = [{ id: 9, hub_code: null, vessel_name: 'mt case insensitive' }];
    const { items, summary } = buildSyncPlan(
      [hubVessel('MT CASE INSENSITIVE', { hubCode: 'VSL-0042' })],
      local
    );
    assert.equal(summary.newCount, 0);
    assert.equal(items[0].vesselId, 9);
    // The name casing differs, so the name itself is part of the diff.
    assert.equal(items[0].diffKind, 'changed');
    assert.equal(items[0].hubCode, 'VSL-0042');
  });

  it('marks a pure hub-code link as changed even with identical fields', () => {
    const local = [{ id: 9, hub_code: null, vessel_name: 'MT A' }];
    const { items } = buildSyncPlan([hubVessel('MT A', { hubCode: 'VSL-0042' })], local);
    assert.deepEqual(items[0].fieldDiff, {});
    assert.equal(items[0].diffKind, 'changed');
  });

  it('prefers the hub code over the name when both could match', () => {
    const local = [
      { id: 1, hub_code: 'VSL-0001', vessel_name: 'OLD NAME' },
      { id: 2, hub_code: 'VSL-0002', vessel_name: 'NEW NAME' },
    ];
    const { items } = buildSyncPlan([hubVessel('NEW NAME', { hubCode: 'VSL-0001' })], local);
    assert.equal(items[0].vesselId, 1);
  });

  it('skips hub tombstones rather than deleting local rows', () => {
    const local = [{ id: 5, hub_code: 'VSL-0001', vessel_name: 'MT A' }];
    const { items, summary } = buildSyncPlan([hubVessel('MT A', { isDeleted: true })], local);
    assert.equal(items.length, 0);
    assert.equal(summary.skippedDeleted, 1);
    assert.equal(summary.hubRecordCount, 1);
  });

  it('handles empty input on both sides', () => {
    const { items, summary } = buildSyncPlan([], []);
    assert.deepEqual(items, []);
    assert.equal(summary.hubRecordCount, 0);
    const empty = buildSyncPlan(undefined, undefined);
    assert.deepEqual(empty.items, []);
  });
});
