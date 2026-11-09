/**
 * System Health — ATG cargo gap actions: preview/resync, acknowledge/reopen, audit history.
 * Mounted under /admin-ops/atg-cargo-gaps (admin page view already required by parent).
 */
import express from 'express';
import { pool } from '../db.js';
import { requirePageEdit } from '../middleware/permissions.js';
import {
  buildResyncAuditSummary,
  deriveResyncOutcome,
  runAtgOperationRecovery,
} from '../lib/atg-operation-recovery.js';
import { scanOperationGapsForRecovery } from '../lib/atg-cargo-gap-scan.js';
import {
  buildSimulationAuditSummary,
  simulateAtgOperationRecovery,
  withOperationLock,
} from '../lib/atg-recovery-simulate.js';
import {
  ACK_ENTITY_TYPE,
  RESYNC_ENTITY_TYPE,
  acknowledgeGaps,
  loadGapHistory,
  reopenGaps,
} from '../lib/atg-cargo-gap-store.js';
import { getJob, startJob } from '../lib/atg-gap-jobs.js';
import { writeActivityLog } from '../lib/activity-log.js';

const router = express.Router();
const ACTIVITY_PAGE_KEY = 'admin';
const MIN_ACK_REASON_LENGTH = 5;

function parseOperationId(req, res) {
  const id = parseInt(String(req.params.operationId ?? ''), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid operationId' });
    return null;
  }
  return id;
}

function parseGapKeys(body) {
  return Array.isArray(body?.gapKeys) ? body.gapKeys.map(String).filter(Boolean) : [];
}

function logResync(userId, result, extra = {}) {
  writeActivityLog({
    pageKey: ACTIVITY_PAGE_KEY,
    action: 'update',
    entityType: RESYNC_ENTITY_TYPE,
    entityId: String(result.operationId),
    entityLabel: result.operationLabel || `Operation #${result.operationId}`,
    summary: buildResyncAuditSummary(result),
    meta: {
      kind: 'atg_cargo_resync',
      operationId: result.operationId,
      portId: result.portId ?? null,
      dryRun: Boolean(result.dryRun),
      confirm: extra.confirm ?? null,
      gapKeys: result.targetGapKeys ?? extra.gapKeys ?? null,
      gapsBefore: result.gapsBefore ?? [],
      gapsAfter: result.gapsAfter ?? [],
      targetClosed: result.targetClosed ?? null,
      targetPartial: result.targetPartial ?? null,
      targetTotal: result.targetTotal ?? null,
      samplesInserted: result.samplesInserted ?? 0,
      hourlyUpserted: result.hourlyUpserted ?? 0,
      dailyUpserted: result.dailyUpserted ?? 0,
      durationMs: result.durationMs ?? null,
      archiveErrors: result.archiveErrors ?? [],
      outcome: result.outcome || deriveResyncOutcome(result),
      error: extra.error ?? null,
    },
    actorUserId: userId ?? null,
  }).catch((e) => console.error('ATG resync activity log failed:', e?.message || e));
}

function logAck(userId, { operationId, operationLabel, kind, gapKeys, reason }) {
  const verb = kind === 'atg_cargo_gap_ack' ? 'acknowledged as unrecoverable' : 'reopened';
  writeActivityLog({
    pageKey: ACTIVITY_PAGE_KEY,
    action: 'update',
    entityType: ACK_ENTITY_TYPE,
    entityId: String(operationId),
    entityLabel: operationLabel || `Operation #${operationId}`,
    summary: `ATG cargo gaps: ${gapKeys.length} gap(s) ${verb} on ${operationLabel || `Operation #${operationId}`}${reason ? ` — ${reason}` : ''}.`,
    meta: { kind, operationId, gapKeys, reason: reason ?? null },
    actorUserId: userId ?? null,
  }).catch((e) => console.error('ATG gap ack activity log failed:', e?.message || e));
}

async function loadOperationGaps(operationId) {
  const scan = await scanOperationGapsForRecovery(pool, operationId);
  return scan.operations[0] ?? null;
}

async function operationExists(operationId) {
  const r = await pool.query(`SELECT id FROM operations WHERE id = $1 AND deleted_at IS NULL`, [operationId]);
  return r.rows.length > 0;
}

/** Start a background job and answer at once; the page polls GET /jobs/:jobId. */
async function startGapJob(req, res, { kind, work, onFailure }) {
  const operationId = parseOperationId(req, res);
  if (operationId == null) return;
  if (!(await operationExists(operationId))) return res.status(404).json({ error: 'Operation not found' });

  const gapKeys = parseGapKeys(req.body);
  try {
    const jobId = await startJob(pool, { operationId, kind, gapKeys, userId: req.userId }, (onProgress) =>
      work({ operationId, gapKeys, onProgress })
    , { onFailure: (err) => onFailure?.({ operationId, gapKeys, err }) });
    res.status(202).json({ jobId, kind, operationId });
  } catch (err) {
    if (err.statusCode === 409) return res.status(409).json({ error: err.message });
    throw err;
  }
}

router.post('/:operationId/resync', ...requirePageEdit('admin'), async (req, res) => {
  const body = req.body || {};
  const dryRun = Boolean(body.dryRun);
  if (!dryRun && body.confirm !== true) return res.status(400).json({ error: 'confirmation_required' });
  const userId = req.userId ?? null;

  if (dryRun) {
    return startGapJob(req, res, {
      kind: 'preview',
      work: ({ operationId, gapKeys, onProgress }) =>
        runAtgOperationRecovery(pool, operationId, { dryRun: true, gapKeys, onProgress }),
    });
  }

  return startGapJob(req, res, {
    kind: 'resync',
    work: async ({ operationId, gapKeys, onProgress }) => {
      const result = await withOperationLock(pool, operationId, (client) =>
        runAtgOperationRecovery(client, operationId, { dryRun: false, gapKeys, onProgress })
      );
      logResync(userId, result, { confirm: true, gapKeys });
      return result;
    },
    onFailure: ({ operationId, gapKeys, err }) => {
      if (err.statusCode === 409) return;
      logResync(
        userId,
        {
          ok: false,
          failed: true,
          operationId,
          dryRun: false,
          samplesInserted: 0,
          hourlyUpserted: 0,
          dailyUpserted: 0,
          gapsBefore: [],
          gapsAfter: [],
          archiveErrors: [],
          outcome: 'failed',
        },
        { confirm: true, gapKeys, error: err?.message || String(err) }
      );
    },
  });
});

function logSimulation(userId, result, gapKeys) {
  writeActivityLog({
    pageKey: ACTIVITY_PAGE_KEY,
    action: 'update',
    entityType: RESYNC_ENTITY_TYPE,
    entityId: String(result.operationId),
    entityLabel: result.operationLabel || `Operation #${result.operationId}`,
    summary: buildSimulationAuditSummary(result),
    meta: {
      kind: 'atg_cargo_simulation',
      operationId: result.operationId,
      dryRun: true,
      simulated: true,
      gapKeys: result.targetGapKeys ?? gapKeys,
      targetClosed: result.targetClosed ?? 0,
      targetPartial: result.targetPartial ?? 0,
      samplesWouldInsert: result.samplesWouldInsert ?? 0,
      quantityDelta: result.quantity?.total?.qtyDelta ?? 0,
      statusBefore: result.status?.before ?? null,
      statusAfter: result.status?.after ?? null,
      durationMs: result.durationMs ?? null,
      outcome: 'simulation',
    },
    actorUserId: userId ?? null,
  }).catch((e) => console.error('ATG simulation activity log failed:', e?.message || e));
}

router.post('/:operationId/simulate', ...requirePageEdit('admin'), async (req, res) => {
  const userId = req.userId ?? null;
  return startGapJob(req, res, {
    kind: 'simulate',
    work: async ({ operationId, gapKeys, onProgress }) => {
      const result = await simulateAtgOperationRecovery(pool, operationId, { gapKeys, onProgress });
      logSimulation(userId, result, gapKeys);
      return result;
    },
  });
});

router.get('/jobs/:jobId', async (req, res) => {
  const jobId = parseInt(String(req.params.jobId ?? ''), 10);
  if (!Number.isFinite(jobId) || jobId <= 0) return res.status(400).json({ error: 'Invalid jobId' });
  const job = await getJob(pool, jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

router.post('/:operationId/acknowledge', ...requirePageEdit('admin'), async (req, res) => {
  const operationId = parseOperationId(req, res);
  if (operationId == null) return;
  const gapKeys = parseGapKeys(req.body);
  const reason = String(req.body?.reason ?? '').trim();
  if (!gapKeys.length) return res.status(400).json({ error: 'gapKeys required' });
  if (reason.length < MIN_ACK_REASON_LENGTH) return res.status(400).json({ error: 'reason_required' });

  const op = await loadOperationGaps(operationId);
  if (!op) return res.status(404).json({ error: 'No ATG gaps found for this operation' });
  const known = new Set((op.gaps || []).map((g) => g.gapKey));
  const valid = gapKeys.filter((k) => known.has(k));
  if (!valid.length) return res.status(409).json({ error: 'gaps_changed' });

  const acknowledged = await acknowledgeGaps(pool, { operationId, gapKeys: valid, reason, userId: req.userId ?? null });
  if (acknowledged.length) {
    logAck(req.userId, { operationId, operationLabel: op.operationLabel, kind: 'atg_cargo_gap_ack', gapKeys: acknowledged, reason });
  }
  res.json({ operationId, acknowledged });
});

router.post('/:operationId/reopen', ...requirePageEdit('admin'), async (req, res) => {
  const operationId = parseOperationId(req, res);
  if (operationId == null) return;
  const gapKeys = parseGapKeys(req.body);
  if (!gapKeys.length) return res.status(400).json({ error: 'gapKeys required' });

  const reopened = await reopenGaps(pool, { operationId, gapKeys });
  if (reopened.length) {
    const op = await loadOperationGaps(operationId);
    logAck(req.userId, { operationId, operationLabel: op?.operationLabel, kind: 'atg_cargo_gap_reopen', gapKeys: reopened });
  }
  res.json({ operationId, reopened });
});

router.get('/:operationId/history', async (req, res) => {
  const operationId = parseOperationId(req, res);
  if (operationId == null) return;
  res.json({ operationId, items: await loadGapHistory(pool, operationId) });
});

export default router;
