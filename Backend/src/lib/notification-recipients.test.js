import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEventRecipients } from './notification-recipients.js';

describe('resolveEventRecipients emptyFallback', () => {
  it('returns empty array when no rules and emptyFallback is none', async () => {
    const db = {
      query: async (sql) => {
        if (sql.includes('notification_event_recipients')) {
          return { rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    };
    const ids = await resolveEventRecipients(db, 'shipment_plan.submitted', 1, {
      emptyFallback: 'none',
    });
    assert.deepEqual(ids, []);
  });

  it('returns only recipients whose port_id matches trigger port', async () => {
    const db = {
      query: async (sql, params) => {
        if (sql.includes('notification_event_recipients')) {
          return {
            rows: [
              { id: 1, user_id: 10, role_id: null, port_id: 1 },
              { id: 2, user_id: 20, role_id: null, port_id: 2 },
            ],
          };
        }
        if (sql.includes('user_ports')) {
          return { rows: [{ user_id: params[0][0] }] };
        }
        if (sql.includes('FROM users u')) {
          const ids = params[0];
          return { rows: ids.map((id) => ({ user_id: id })) };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    };
    const ids = await resolveEventRecipients(db, 'shipment_plan.partner_submitted', 1, {
      emptyFallback: 'none',
    });
    assert.deepEqual(ids, [10]);
  });
});
