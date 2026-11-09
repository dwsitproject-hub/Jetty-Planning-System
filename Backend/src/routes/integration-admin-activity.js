/**
 * Admin monitoring for partner integrations (mounted under /integration-admin/activity).
 * Permission gate is applied by the parent integration-admin router.
 */
import express from 'express';
import { pool } from '../db.js';
import {
  getActivitySummary,
  listApiRequestActivity,
  listWebhookActivity,
  retryFailedDeliveryById,
} from '../lib/integration-activity-log.js';
import { writeActivityLog } from '../lib/activity-log.js';

const router = express.Router();

router.get('/summary', async (req, res) => {
  res.json(await getActivitySummary(pool, req.query));
});

router.get('/webhook-deliveries', async (req, res) => {
  res.json(await listWebhookActivity(pool, req.query));
});

router.get('/api-requests', async (req, res) => {
  res.json(await listApiRequestActivity(pool, req.query));
});

router.post('/webhook-deliveries/:deliveryId/retry', async (req, res) => {
  const deliveryId = String(req.params.deliveryId ?? '').trim();
  if (!deliveryId) return res.status(400).json({ error: 'Invalid delivery id' });

  const result = await retryFailedDeliveryById(pool, deliveryId);
  if (result.error === 'not_found') {
    return res.status(404).json({ error: 'Delivery not found' });
  }
  if (result.error === 'not_found_or_not_failed') {
    return res.status(404).json({ error: 'Delivery not found or not in failed state' });
  }

  writeActivityLog({
    pageKey: 'admin',
    action: 'update',
    entityType: 'IntegrationWebhookDelivery',
    entityId: deliveryId,
    entityLabel: deliveryId,
    summary: `Re-queued failed partner webhook delivery ${deliveryId}`,
    actorUserId: req.userId ?? null,
  }).catch(() => {});

  res.json({ deliveryId: result.delivery_id, status: 'pending' });
});

export default router;
