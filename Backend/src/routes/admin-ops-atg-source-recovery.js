/**
 * System Health — recover one ATG source's readings for a time range from the Tankvision archive.
 * Mounted under /admin-ops/atg-source-recovery. Preview and apply run as background jobs;
 * the page polls GET /admin-ops/atg-cargo-gaps/jobs/:jobId.
 */
import express from 'express';
import { pool } from '../db.js';
import { requirePageEdit } from '../middleware/permissions.js';
import { trimBaseUrl } from '../lib/tankvision-client.js';
import { padGapWindow, reaggregate } from '../lib/atg-operation-recovery.js';
import { recoverAtgSourceRange } from '../lib/atg-source-recovery.js';
import {
  distinctOperationIds,
  findEntriesUsingWindow,
  manualEntries,
} from '../lib/atg-source-recovery-impact.js';
import { startJob } from '../lib/atg-gap-jobs.js';
import { writeActivityLog } from '../lib/activity-log.js';

const router = express.Router();
const SOURCE_RECOVERY_ENTITY_TYPE = 'AtgSourceRecovery';

function parseBody(body) {
  const portId = parseInt(String(body?.portId ?? ''), 10);
  const sourceBaseUrl = String(body?.sourceBaseUrl ?? '').trim();
  const startAt = new Date(body?.startAt);
  const endAt = new Date(body?.endAt);
  const tankCodes = Array.isArray(body?.tankCodes) ? body.tankCodes.map(String).filter(Boolean) : null;

  if (!Number.isFinite(portId) || portId <= 0) return { error: 'portId is required' };
  if (!sourceBaseUrl) return { error: 'sourceBaseUrl is required' };
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
    return { error: 'startAt and endAt must be valid times, with endAt after startAt' };
  }
  try {
    padGapWindow(startAt, endAt);
  } catch (err) {
    return { error: err.message, status: err.statusCode ?? 422 };
  }
  return { portId, sourceBaseUrl: trimBaseUrl(sourceBaseUrl), startAt, endAt, tankCodes };
}

function logRecovery(userId, input, result, extra = {}) {
  const totals = result?.totals ?? {};
  const label = result?.sourceLabel || input.sourceBaseUrl;
  const outcome = extra.error ? 'failed' : result?.rolledBack ? 'rolled_back' : 'recovered';
  writeActivityLog({
    pageKey: 'admin',
    action: 'update',
    entityType: SOURCE_RECOVERY_ENTITY_TYPE,
    entityId: `${input.portId}|${input.sourceBaseUrl}`,
    entityLabel: label,
    summary:
      outcome === 'recovered'
        ? `ATG source ${label}: ${totals.inserted ?? 0} reading(s) recovered from the Tankvision archive for ${totals.tanks ?? 0} tank(s).`
        : `ATG source ${label}: recovery ${outcome === 'failed' ? 'failed' : 'rolled back, nothing was written'}.`,
    meta: {
      kind: 'atg_source_recovery',
      portId: input.portId,
      sourceBaseUrl: input.sourceBaseUrl,
      windowStart: result?.windowStart ?? input.startAt.toISOString(),
      windowEnd: result?.windowEnd ?? input.endAt.toISOString(),
      tankCodes: input.tankCodes,
      totals,
      manualEntriesNowRecoverable: extra.manualCount ?? 0,
      outcome,
      error: extra.error ?? null,
    },
    actorUserId: userId ?? null,
  }).catch((e) => console.error('ATG source recovery activity log failed:', e?.message || e));
}

async function runPreview(input, onProgress) {
  const result = await recoverAtgSourceRange(pool, { ...input, dryRun: true, onProgress });
  const usedBy = await findEntriesUsingWindow(pool, {
    portId: input.portId,
    tankIds: result.tanks.map((t) => t.tankId),
    startAt: result.windowStart,
    endAt: result.windowEnd,
  });
  return { ...result, usedBy };
}

/** One transaction: any tank that fails to download rolls the whole recovery back. */
async function runApply(input, onProgress) {
  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');
    result = await recoverAtgSourceRange(client, { ...input, dryRun: false, onProgress });
    if (result.totals.tanksWithErrors > 0) {
      await client.query('ROLLBACK');
      result = { ...result, rolledBack: true };
    } else {
      await client.query('COMMIT');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (result.rolledBack) return { ...result, usedBy: [], manualNowRecoverable: [] };

  const usedBy = await findEntriesUsingWindow(pool, {
    portId: input.portId,
    tankIds: result.tanks.map((t) => t.tankId),
    startAt: result.windowStart,
    endAt: result.windowEnd,
  });
  onProgress?.({ step: 'aggregate' });
  for (const operationId of distinctOperationIds(usedBy)) await reaggregate(pool, operationId);
  return { ...result, usedBy, manualNowRecoverable: manualEntries(usedBy) };
}

router.post('/', ...requirePageEdit('admin'), async (req, res) => {
  const dryRun = Boolean(req.body?.dryRun);
  if (!dryRun && req.body?.confirm !== true) return res.status(400).json({ error: 'confirmation_required' });
  const input = parseBody(req.body);
  if (input.error) return res.status(input.status ?? 400).json({ error: input.error });

  const userId = req.userId ?? null;
  const sourceKey = `${input.portId}|${input.sourceBaseUrl}`;
  try {
    const jobId = await startJob(
      pool,
      { sourceKey, kind: dryRun ? 'source_preview' : 'source_recover', userId },
      async (onProgress) => {
        if (dryRun) return runPreview(input, onProgress);
        const result = await runApply(input, onProgress);
        logRecovery(userId, input, result, { manualCount: result.manualNowRecoverable?.length ?? 0 });
        return result;
      },
      { onFailure: (err) => !dryRun && err.statusCode !== 409 && logRecovery(userId, input, null, { error: err?.message || String(err) }) }
    );
    res.status(202).json({ jobId, kind: dryRun ? 'source_preview' : 'source_recover', sourceKey });
  } catch (err) {
    if (err.statusCode === 409) return res.status(409).json({ error: err.message });
    throw err;
  }
});

export default router;
