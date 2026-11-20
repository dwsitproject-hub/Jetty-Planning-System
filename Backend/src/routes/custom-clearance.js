/**
 * Custom Clearance endpoints (dedicated field menu, same layout as QC Sampling).
 *
 * Base path: /api/v1/custom-clearance
 * - GET /queue                    berthed operations with their Custom Clearance state;
 *                                  `?scope=sailed&from=&to=` lists sailed ones (view-only)
 * - GET /operations/:operationId  one queue row (entry screen header), berthed or sailed
 *
 * Saves go through the shared sub-process route (`custom_clearance`, Post-Checking),
 * so the Loading hub and this menu always edit the same record.
 */
import express from 'express';
import { buildAllocationOverviewPayload, loadSailedOverviewRows } from './allocation.js';
import { buildCustomClearanceQueue } from '../lib/custom-clearance-queue.js';
import { loadFieldQueueRow, loadFieldQueueRows } from '../lib/field-queue.js';
import { requirePageView } from '../middleware/permissions.js';

const router = express.Router();

const PAGE_KEY = 'custom-clearance';
const QUEUE_SOURCES = { loadOverview: buildAllocationOverviewPayload, loadSailed: loadSailedOverviewRows };

router.get('/queue', ...requirePageView(PAGE_KEY), async (req, res) => {
  const rows = await loadFieldQueueRows(Number(req.selectedPortId), req.query, QUEUE_SOURCES);
  res.json({ queue: await buildCustomClearanceQueue(rows) });
});

router.get('/operations/:operationId', ...requirePageView(PAGE_KEY), async (req, res) => {
  const operationId = parseInt(req.params.operationId, 10);
  if (Number.isNaN(operationId)) return res.status(400).json({ error: 'Invalid operationId' });
  const row = await loadFieldQueueRow(Number(req.selectedPortId), operationId, QUEUE_SOURCES);
  if (!row) return res.status(404).json({ error: 'Operation not found or not berthed' });
  const [queueRow] = await buildCustomClearanceQueue([row]);
  res.json(queueRow);
});

export default router;
