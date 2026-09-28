/**
 * Poll integration_webhook_deliveries and POST signed events to partner URLs.
 */
import { pool } from '../db.js';
import { processWebhookDeliveryQueueOnce } from './integration-webhooks.js';

let intervalId = null;

export function startIntegrationWebhookWorker() {
  if (process.env.INTEGRATION_WEBHOOK_WORKER_ENABLED === 'false') {
    console.log('[integration-webhooks] worker disabled (INTEGRATION_WEBHOOK_WORKER_ENABLED=false)');
    return;
  }
  const intervalMs = Math.max(
    5000,
    parseInt(process.env.INTEGRATION_WEBHOOK_POLL_MS || '15000', 10) || 15_000
  );
  if (intervalId) return;
  intervalId = setInterval(() => {
    processWebhookDeliveryQueueOnce(pool, 30).catch((err) => {
      console.error('[integration-webhooks] worker', err?.message || err);
    });
  }, intervalMs);
  intervalId.unref?.();
  console.log(`[integration-webhooks] worker started (poll every ${intervalMs}ms)`);
}
