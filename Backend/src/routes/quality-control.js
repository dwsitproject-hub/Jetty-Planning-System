/**
 * QC Sampling endpoints (mobile menu for Quality Control).
 *
 * Base path: /api/v1/qc
 * - GET    /sampling/queue                                berthed operations with sampling state
 * - GET    /sampling/operations/:operationId              one queue row (entry screen header)
 * - POST   /sampling/operations/:operationId/records      add one palka sample
 * - PATCH  /sampling/operations/:operationId/records/:id  edit one palka sample
 * - DELETE /sampling/operations/:operationId/records/:id  remove one palka sample
 *
 * Record writes are row-locked read-modify-write, so they never overwrite another editor's samples.
 */
import express from 'express';
import { buildAllocationOverviewPayload } from './allocation.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { assertOperationInSelectedPort } from '../lib/operation-access.js';
import { buildQcSamplingQueue } from '../lib/qc-sampling-queue.js';
import { addRecord, parseRecordInput, removeRecord, updateRecord } from '../lib/sampling-records.js';
import { mutateSamplingRecords } from '../lib/sampling-records-store.js';
import { requirePageEdit, requirePageView } from '../middleware/permissions.js';

const router = express.Router();

const PAGE_KEY = 'quality-control';

function parseOperationId(raw) {
  const id = parseInt(raw, 10);
  return Number.isNaN(id) ? null : id;
}

router.get('/sampling/queue', ...requirePageView(PAGE_KEY), async (req, res) => {
  const queue = await buildQcSamplingQueue(Number(req.selectedPortId), buildAllocationOverviewPayload);
  res.json({ queue });
});

router.get('/sampling/operations/:operationId', ...requirePageView(PAGE_KEY), async (req, res) => {
  const operationId = parseOperationId(req.params.operationId);
  if (operationId == null) return res.status(400).json({ error: 'Invalid operationId' });
  const queue = await buildQcSamplingQueue(Number(req.selectedPortId), buildAllocationOverviewPayload);
  const row = queue.find((r) => r.operationId === operationId);
  if (!row) return res.status(404).json({ error: 'Operation not found or not berthed' });
  res.json(row);
});

/** Run one record mutation, log it against the Loading page (shared record) and reply with the fresh list. */
async function applyRecordChange(req, res, { action, summary, mutate }) {
  const operationId = parseOperationId(req.params.operationId);
  if (operationId == null) return res.status(400).json({ error: 'Invalid operationId' });
  await assertOperationInSelectedPort(operationId, req.selectedPortId);

  const result = await mutateSamplingRecords(operationId, req.userId ?? null, mutate);
  writeActivityLog({
    pageKey: 'loading',
    action,
    entityType: 'Pre-Checking',
    entityId: String(operationId),
    entityLabel: 'sampling',
    summary: `${summary} (palka ${result.record.noPalka})`,
    meta: { operationId, subProcessKey: 'sampling', phase: 'Pre-Checking', source: 'qc' },
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.status(action === 'add' ? 201 : 200).json(result);
}

router.post('/sampling/operations/:operationId/records', ...requirePageEdit(PAGE_KEY), async (req, res) => {
  const input = parseRecordInput(req.body);
  await applyRecordChange(req, res, {
    action: 'add',
    summary: 'Added sampling record',
    mutate: (records, newId) => addRecord(records, input, newId()),
  });
});

router.patch('/sampling/operations/:operationId/records/:recordId', ...requirePageEdit(PAGE_KEY), async (req, res) => {
  const patch = parseRecordInput(req.body, { partial: true });
  await applyRecordChange(req, res, {
    action: 'update',
    summary: 'Updated sampling record',
    mutate: (records) => updateRecord(records, req.params.recordId, patch),
  });
});

router.delete('/sampling/operations/:operationId/records/:recordId', ...requirePageEdit(PAGE_KEY), async (req, res) => {
  await applyRecordChange(req, res, {
    action: 'delete',
    summary: 'Removed sampling record',
    mutate: (records) => removeRecord(records, req.params.recordId),
  });
});

export default router;
