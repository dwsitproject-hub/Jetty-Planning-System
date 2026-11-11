/**
 * Custom Clearance endpoints (dedicated field menu, same layout as QC Sampling).
 *
 * Base path: /api/v1/custom-clearance
 * - GET /queue                    berthed operations with their Custom Clearance state
 * - GET /operations/:operationId  one queue row (entry screen header)
 *
 * Saves go through the shared sub-process route (`custom_clearance`, Post-Checking),
 * so the Loading hub and this menu always edit the same record.
 */
import express from 'express';
import { buildAllocationOverviewPayload } from './allocation.js';
import { buildCustomClearanceQueue } from '../lib/custom-clearance-queue.js';
import { requirePageView } from '../middleware/permissions.js';

const router = express.Router();

const PAGE_KEY = 'custom-clearance';

router.get('/queue', ...requirePageView(PAGE_KEY), async (req, res) => {
  const queue = await buildCustomClearanceQueue(Number(req.selectedPortId), buildAllocationOverviewPayload);
  res.json({ queue });
});

router.get('/operations/:operationId', ...requirePageView(PAGE_KEY), async (req, res) => {
  const operationId = parseInt(req.params.operationId, 10);
  if (Number.isNaN(operationId)) return res.status(400).json({ error: 'Invalid operationId' });
  const queue = await buildCustomClearanceQueue(Number(req.selectedPortId), buildAllocationOverviewPayload);
  const row = queue.find((r) => r.operationId === operationId);
  if (!row) return res.status(404).json({ error: 'Operation not found or not berthed' });
  res.json(row);
});

export default router;
