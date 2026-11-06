import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatVesselPlanLabel,
  activityRowTarget,
  applyPlanLabel,
  enrichPlanLabelsOnActivityRows,
} from './activity-log-plan-labels.js';

const parseMeta = (raw) => (raw && typeof raw === 'object' ? raw : null);

test('formatVesselPlanLabel joins vessel and plan, falls back to either', () => {
  assert.equal(formatVesselPlanLabel('MT METRO MARITIM I', 'SP-26-11-00245'), 'MT METRO MARITIM I · SP-26-11-00245');
  assert.equal(formatVesselPlanLabel('BG PKPJ 47', null), 'BG PKPJ 47');
  assert.equal(formatVesselPlanLabel('', 'SP-1'), 'SP-1');
  assert.equal(formatVesselPlanLabel(null, ' '), null);
});

test('activityRowTarget resolves operation, plan and document rows', () => {
  assert.deepEqual(activityRowTarget({ entity_type: 'Operation', entity_id: '231' }, { operationId: 231 }), { operationId: 231 });
  assert.deepEqual(activityRowTarget({ entity_type: 'ShipmentPlan', entity_id: '245' }, null), { planId: 245 });
  assert.deepEqual(activityRowTarget({ entity_type: 'BERTHING document', entity_id: '230' }, null), { operationId: 230 });
  assert.deepEqual(activityRowTarget({ entity_type: 'Port', entity_id: '4' }, null), {});
});

test('applyPlanLabel replaces label, or rewrites document summary', () => {
  const info = { vesselName: 'BG PKPJ 47', planReference: 'SP-26-11-00204' };
  const op = applyPlanLabel({ entity_type: 'Operation', entity_label: 'Operation #231' }, { operationId: 231 }, info);
  assert.equal(op.entity_label, 'BG PKPJ 47 · SP-26-11-00204');
  assert.equal(op.meta_json.vesselName, 'BG PKPJ 47');

  const doc = applyPlanLabel(
    { entity_type: 'BERTHING document', entity_id: '231', entity_label: 'photo.jpg', summary: 'Uploaded 1 BERTHING document(s) for operation 231' },
    { operationId: 231 },
    info
  );
  assert.equal(doc.entity_label, 'photo.jpg');
  assert.equal(doc.summary, 'Uploaded 1 BERTHING document(s) for BG PKPJ 47 · SP-26-11-00204');

  const untouched = { entity_type: 'Operation', entity_label: 'Operation #9' };
  assert.equal(applyPlanLabel(untouched, null, undefined), untouched);
});

test('enrichPlanLabelsOnActivityRows batches lookups', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push(params[0]);
      if (sql.includes('FROM operations')) return { rows: [{ id: '231', vessel_name: 'MT A', plan_reference: 'SP-1' }] };
      return { rows: [{ id: '245', vessel_name: 'BG B', plan_reference: 'SP-2' }] };
    },
  };
  const rows = [
    { entity_type: 'Operation', entity_id: '231', meta_json: { operationId: 231 } },
    { entity_type: 'ShipmentPlan', entity_id: '245', meta_json: null },
    { entity_type: 'Operation', entity_id: '999', meta_json: null },
  ];
  const out = await enrichPlanLabelsOnActivityRows(pool, rows, parseMeta);
  assert.equal(out[0].entity_label, 'MT A · SP-1');
  assert.equal(out[1].entity_label, 'BG B · SP-2');
  assert.equal(out[2], rows[2]);
  assert.equal(calls.length, 2);
});
