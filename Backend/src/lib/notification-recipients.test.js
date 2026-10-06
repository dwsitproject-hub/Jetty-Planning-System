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
});
