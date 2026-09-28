/**
 * Self-test helper: enqueue status.changed and report pending delivery count.
 * Usage: node scripts/integration-selftest-enqueue-webhook.mjs <shipping_instruction_id>
 */
import 'dotenv/config';
import pg from 'pg';
import { enqueueIntegrationWebhookEvents } from '../src/lib/integration-webhooks.js';

const siId = Number(process.argv[2]);
if (!Number.isFinite(siId) || siId <= 0) {
  console.error('Usage: node scripts/integration-selftest-enqueue-webhook.mjs <si_id>');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const before = await pool.query(
    `SELECT COUNT(*)::int AS c FROM integration_webhook_deliveries
     WHERE si_id = $1 AND event_type = 'status.changed' AND status = 'pending'`,
    [siId]
  );
  const enqueued = await enqueueIntegrationWebhookEvents(pool, {
    shippingInstructionId: siId,
    eventTypes: ['status.changed'],
  });
  const after = await pool.query(
    `SELECT COUNT(*)::int AS c FROM integration_webhook_deliveries
     WHERE si_id = $1 AND event_type = 'status.changed' AND status = 'pending'`,
    [siId]
  );
  console.log(
    JSON.stringify({
      enqueued,
      pending_before: before.rows[0].c,
      pending_after: after.rows[0].c,
    })
  );
  if (enqueued < 1 || after.rows[0].c <= before.rows[0].c) {
    process.exit(2);
  }
} finally {
  await pool.end();
}
