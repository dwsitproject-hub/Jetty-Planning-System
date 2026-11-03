import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { enqueueIntegrationWebhookEvents, expandWebhookEventTypes } from './integration-webhooks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routesDir = path.resolve(__dirname, '../routes');

/** Minimal row for PARTNER_SUBMISSION lookup + payload builder. */
function fakeSubmissionRow(overrides = {}) {
  return {
    api_key_id: 1,
    si_id: 42,
    external_reference: 'REF-HOOK-TEST',
    received_at: '2026-09-25T01:00:00.000Z',
    last_updated_at: '2026-09-25T02:00:00.000Z',
    approval_status: 'Submitted',
    plan_reference: 'SP-26-09-00042',
    vessel_name: 'MV Hook Test',
    port_id: 1,
    payload: { vessel_hub_code: 'VSL-0001' },
    voyage_no: null,
    purpose: 'Loading',
    op_status: null,
    ...overrides,
  };
}

describe('integration-webhook-hooks', () => {
  it('enqueueIntegrationWebhookEvents returns 0 when plan has no integration submission', async () => {
    const db = {
      query: async (sql) => {
        if (sql.includes('integration_submissions') || sql.includes('shipping_instructions')) {
          return { rows: [] };
        }
        throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
      },
    };
    const n = await enqueueIntegrationWebhookEvents(db, {
      shipmentPlanId: 999_999,
      eventTypes: ['status.changed'],
    });
    assert.equal(n, 0);
  });

  it('enqueueIntegrationWebhookEvents inserts pending delivery for submission + endpoint', async () => {
    const inserts = [];
    const row = fakeSubmissionRow();
    const db = {
      query: async (sql, params) => {
        if (sql.includes('FROM integration_submissions') || sql.includes('shipping_instructions si')) {
          return { rows: [row] };
        }
        if (sql.includes('integration_webhook_endpoints')) {
          return { rows: [{ id: 7, events: ['status.changed'] }] };
        }
        if (sql.includes('FROM integration_webhook_deliveries')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO integration_webhook_deliveries')) {
          inserts.push({ sql, params });
          return { rows: [] };
        }
        throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
      },
    };
    const n = await enqueueIntegrationWebhookEvents(db, {
      shippingInstructionId: 42,
      eventTypes: ['status.changed'],
    });
    assert.equal(n, 1);
    assert.equal(inserts.length, 1);
    assert.equal(inserts[0].params[2], 'status.changed');
    assert.equal(inserts[0].params[3], 42);
    assert.equal(inserts[0].params[4], 'REF-HOOK-TEST');
    assert.equal(inserts[0].params[0], 7);
    const payload = inserts[0].params[5];
    assert.equal(payload.event, 'status.changed');
    assert.equal(payload.data.id, 42);
    assert.equal(payload.data.status, 'Pending');
  });

  it('enqueueIntegrationWebhookEvents reports Deleted after the plan is soft-deleted', async () => {
    const captured = [];
    const row = fakeSubmissionRow({
      approval_status: 'Rejected',
      rejection_reason: 'Wrong vessel',
      plan_deleted_at: '2026-10-27T06:00:00.000Z',
      si_deleted_at: '2026-10-27T06:00:00.000Z',
    });
    const db = {
      query: async (sql, params) => {
        if (sql.includes('FROM integration_submissions') || sql.includes('shipping_instructions si')) {
          return { rows: [row] };
        }
        if (sql.includes('integration_webhook_endpoints')) {
          return { rows: [{ id: 7, events: ['status.changed'] }] };
        }
        if (sql.includes('FROM integration_webhook_deliveries')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO integration_webhook_deliveries')) {
          captured.push(params);
          return { rows: [] };
        }
        throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
      },
    };
    const n = await enqueueIntegrationWebhookEvents(db, {
      shipmentPlanId: 42,
      eventTypes: ['status.changed'],
    });
    assert.equal(n, 1);
    assert.equal(captured[0][5].data.status, 'Deleted');
    assert.equal(captured[0][5].data.approval.status, 'Deleted');
  });

  it('enqueueIntegrationWebhookEvents skips endpoints that do not subscribe to the event', async () => {
    const row = fakeSubmissionRow();
    const db = {
      query: async (sql) => {
        if (sql.includes('integration_submissions') || sql.includes('shipping_instructions si')) {
          return { rows: [row] };
        }
        if (sql.includes('integration_webhook_endpoints')) {
          return { rows: [{ id: 1, events: ['schedule.updated'] }] };
        }
        if (sql.includes('INSERT INTO integration_webhook_deliveries')) {
          throw new Error('should not insert when event filtered out');
        }
        return { rows: [] };
      },
    };
    const n = await enqueueIntegrationWebhookEvents(db, {
      shippingInstructionId: 42,
      eventTypes: ['status.changed'],
    });
    assert.equal(n, 0);
  });

  it('shipment-plans approve/reject/delete/depart routes trigger partner webhooks after commit', () => {
    const src = readFileSync(path.join(routesDir, 'shipment-plans.js'), 'utf8');
    const statusChanged = src.match(
      /triggerPartnerWebhooksDeferred\(\{ shipmentPlanId: planId, eventTypes: \['status\.changed'\] \}\)/g
    );
    assert.equal(statusChanged?.length, 3);
    assert.match(src, /triggerPartnerWebhooksDeferred\(\{\s*\n\s*shipmentPlanId: planId,\s*\n\s*eventTypes: \['schedule\.updated', 'status\.changed'\],/);
  });

  it('allocation and operations routes call triggerPartnerWebhooksDeferred', () => {
    const allocation = readFileSync(path.join(routesDir, 'allocation.js'), 'utf8');
    const operations = readFileSync(path.join(routesDir, 'operations.js'), 'utf8');
    assert.ok(allocation.includes('triggerPartnerWebhooksDeferred'));
    assert.ok(allocation.includes("'schedule.updated'"));
    assert.ok(operations.includes('triggerPartnerWebhooksDeferred'));
    assert.ok(operations.includes("'schedule.updated'"));
  });

  it('operational-activities route triggers partner schedule webhook for cargo_operations', () => {
    const src = readFileSync(path.join(routesDir, 'operation-operational-activities.js'), 'utf8');
    assert.ok(src.includes('triggerPartnerScheduleWebhookForOperation'));
    assert.ok(src.includes('resolvePartnerCargoOpsWindow'));
    assert.ok(src.includes('partnerCargoOpsWindowScheduleChanged'));
    assert.match(src, /before\.doneAt/);
    assert.match(src, /milestoneKey === 'cargo_operations'/);
  });

  it('sub-process route pushes a schedule webhook only when a final check moves Cargo Done', () => {
    const src = readFileSync(path.join(routesDir, 'operation-sub-processes.js'), 'utf8');
    assert.match(src, /triggerPartnerScheduleIfCargoDoneChanged\(operationId, cargoDoneBefore\)/);
    assert.equal(src.match(/triggerPartnerScheduleIfCargoDoneChanged\(operationId, cargoDoneBefore\)/g).length, 2);
    assert.match(src, /POST_CHECK_AUTO_KEYS\.has\(key\) \? await resolvePartnerCargoOpsWindow/);
  });

  describe('status.changed dedupe', () => {
    /** @param {Array<string | null>} lastStatuses statuses carried by the last status.changed delivery */
    function dedupeDb(row, lastStatus) {
      const inserts = [];
      return {
        inserts,
        db: {
          query: async (sql, params) => {
            if (sql.includes('FROM integration_submissions') || sql.includes('shipping_instructions si')) {
              return { rows: [row] };
            }
            if (sql.includes('integration_webhook_endpoints')) {
              return { rows: [{ id: 7, events: ['*'] }] };
            }
            if (sql.includes('FROM integration_webhook_deliveries')) {
              return { rows: lastStatus ? [{ status: lastStatus }] : [] };
            }
            if (sql.includes('INSERT INTO integration_webhook_deliveries')) {
              inserts.push(params[2]);
              return { rows: [] };
            }
            throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
          },
        },
      };
    }

    it('expandWebhookEventTypes adds status.changed to a schedule change', () => {
      assert.deepEqual(expandWebhookEventTypes(['schedule.updated']), ['schedule.updated', 'status.changed']);
      assert.deepEqual(expandWebhookEventTypes(['status.changed']), ['status.changed']);
      assert.deepEqual(expandWebhookEventTypes(['bogus']), []);
      assert.deepEqual(expandWebhookEventTypes(undefined), []);
    });

    it('sends status.changed with schedule.updated when the stage changed', async () => {
      const row = fakeSubmissionRow({ approval_status: 'Approved', op_status: 'DOCKED', op_tb: '2026-10-02T10:00:00.000Z' });
      const { db, inserts } = dedupeDb(row, 'Allocated');
      const n = await enqueueIntegrationWebhookEvents(db, { shippingInstructionId: 42, eventTypes: ['schedule.updated'] });
      assert.equal(n, 2);
      assert.deepEqual(inserts, ['schedule.updated', 'status.changed']);
    });

    it('skips status.changed when the last one already carried this status, but still sends schedule.updated', async () => {
      const row = fakeSubmissionRow({ approval_status: 'Approved', op_status: 'DOCKED', op_tb: '2026-10-02T10:00:00.000Z' });
      const { db, inserts } = dedupeDb(row, 'Berthed');
      const n = await enqueueIntegrationWebhookEvents(db, { shippingInstructionId: 42, eventTypes: ['schedule.updated'] });
      assert.equal(n, 1);
      assert.deepEqual(inserts, ['schedule.updated']);
    });

    it('always sends the first status.changed for an instruction', async () => {
      const row = fakeSubmissionRow({ approval_status: 'Approved' });
      const { db, inserts } = dedupeDb(row, null);
      const n = await enqueueIntegrationWebhookEvents(db, { shipmentPlanId: 42, eventTypes: ['status.changed'] });
      assert.equal(n, 1);
      assert.deepEqual(inserts, ['status.changed']);
    });
  });
});
