/**
 * Shared Express routes for DataHub pull → review → apply sync runs.
 */
import { pool } from '../db.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { getEffectiveDataHubConfig, updateDataHubSyncHealth } from '../lib/datahub-config.js';
import {
  entityActivityLabel,
  entityPageKey,
  entitySyncErrorLabel,
  DATAHUB_ENTITY_TYPES,
} from '../lib/datahub-master-sync-config.js';
import { pullAndStageEntity, applyStagedEntitySyncRun } from '../lib/datahub-master-stage.js';
import { requirePageEdit } from '../middleware/permissions.js';
import { actorUserIdFromReq } from '../lib/master-row-audit.js';

function toRun(row) {
  return {
    id: Number(row.id),
    entityType: row.entity_type ?? 'vessel',
    status: row.status,
    source: row.source ?? 'manual',
    webhookDeliveryId: row.webhook_delivery_id ?? null,
    hubRecordCount: Number(row.hub_record_count ?? 0),
    newCount: Number(row.new_count ?? 0),
    changedCount: Number(row.changed_count ?? 0),
    unchangedCount: Number(row.unchanged_count ?? 0),
    appliedCount: Number(row.applied_count ?? 0),
    error: row.error ?? null,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    appliedAt: row.applied_at ?? null,
  };
}

function toItem(row) {
  const payload = row.payload || {};
  return {
    id: Number(row.id),
    vesselId: row.vessel_id != null ? Number(row.vessel_id) : null,
    hubCode: row.hub_code ?? null,
    vesselName: row.vessel_name,
    diffKind: row.diff_kind,
    decision: row.decision,
    fieldDiff: row.field_diff ?? {},
    values: payload.values ?? {},
    appliedAt: row.applied_at ?? null,
    applyError: row.apply_error ?? null,
  };
}

/**
 * @param {import('express').Router} router
 * @param {{ entityType: 'vessel'|'incoterm'|'commodity', mountPath: string }} opts
 */
export function registerDataHubSyncRoutes(router, { entityType, mountPath }) {
  if (!DATAHUB_ENTITY_TYPES.has(entityType)) {
    throw new Error(`Invalid entityType: ${entityType}`);
  }
  const pageKey = entityPageKey(entityType);
  const prefix = mountPath.replace(/\/$/, '');

  router.get(`${prefix}/runs`, async (req, res) => {
    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isNaN(limitRaw) ? 10 : Math.max(1, Math.min(limitRaw, 50));
    const r = await pool.query(
      `SELECT * FROM datahub_vessel_sync_runs
       WHERE entity_type = $1
       ORDER BY started_at DESC LIMIT $2`,
      [entityType, limit]
    );
    res.json(r.rows.map(toRun));
  });

  router.post(`${prefix}/runs`, ...requirePageEdit(pageKey), async (req, res) => {
    const cfg = await getEffectiveDataHubConfig(pool);
    if (!cfg.enabled || !cfg.baseUrl) {
      return res.status(400).json({
        error: 'DataHub integration is not configured. Set the base URL and key pair in Admin > DataHub.',
      });
    }
    if (!cfg.publicKey || !cfg.privateKey) {
      return res.status(400).json({ error: 'DataHub key pair is not configured.' });
    }

    try {
      const { runId, summary } = await pullAndStageEntity(pool, entityType, cfg, {
        source: 'manual',
        createdBy: req.userId ?? null,
        preapproveChanges: true,
      });
      await updateDataHubSyncHealth(pool, { ok: true });
      if (runId == null) {
        const run = { ...summary, status: 'staged', entityType };
        return res.status(201).json({ run, summary, noChanges: true });
      }
      const runRow = await pool.query(`SELECT * FROM datahub_vessel_sync_runs WHERE id = $1`, [runId]);
      res.status(201).json({ run: toRun(runRow.rows[0]), summary });
    } catch (e) {
      await updateDataHubSyncHealth(pool, { ok: false, error: e?.message });
      return res.status(502).json({ error: e?.message || entitySyncErrorLabel(entityType) });
    }
  });

  router.get(`${prefix}/runs/:id(\\d+)`, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const run = await pool.query(
      `SELECT * FROM datahub_vessel_sync_runs WHERE id = $1 AND entity_type = $2`,
      [id, entityType]
    );
    if (run.rows.length === 0) return res.status(404).json({ error: 'Sync run not found' });
    const items = await pool.query(
      `SELECT * FROM datahub_vessel_sync_items
       WHERE run_id = $1
       ORDER BY CASE diff_kind WHEN 'changed' THEN 0 WHEN 'new' THEN 1 ELSE 2 END,
                vessel_name ASC`,
      [id]
    );
    res.json({ run: toRun(run.rows[0]), items: items.rows.map(toItem) });
  });

  router.patch(`${prefix}/runs/:id(\\d+)/items`, ...requirePageEdit(pageKey), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const decisions = Array.isArray(req.body?.decisions) ? req.body.decisions : null;
    if (!decisions) return res.status(400).json({ error: 'decisions must be an array' });

    const run = await pool.query(
      `SELECT status FROM datahub_vessel_sync_runs WHERE id = $1 AND entity_type = $2`,
      [id, entityType]
    );
    if (run.rows.length === 0) return res.status(404).json({ error: 'Sync run not found' });
    if (run.rows[0].status !== 'staged') {
      return res.status(409).json({ error: `Sync run is already ${run.rows[0].status}` });
    }

    const approved = [];
    const rejected = [];
    for (const d of decisions) {
      const itemId = parseInt(d?.itemId, 10);
      if (!Number.isFinite(itemId)) continue;
      if (d?.decision === 'approved') approved.push(itemId);
      else if (d?.decision === 'rejected') rejected.push(itemId);
    }

    if (approved.length) {
      await pool.query(
        `UPDATE datahub_vessel_sync_items SET decision = 'approved'
         WHERE run_id = $1 AND id = ANY($2::bigint[])`,
        [id, approved]
      );
    }
    if (rejected.length) {
      await pool.query(
        `UPDATE datahub_vessel_sync_items SET decision = 'rejected'
         WHERE run_id = $1 AND id = ANY($2::bigint[])`,
        [id, rejected]
      );
    }
    res.json({ ok: true, approved: approved.length, rejected: rejected.length });
  });

  router.post(`${prefix}/runs/:id(\\d+)/apply`, ...requirePageEdit(pageKey), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const itemIds = Array.isArray(req.body?.itemIds)
      ? req.body.itemIds.map((n) => parseInt(n, 10)).filter(Number.isFinite)
      : null;
    const actorId = actorUserIdFromReq(req);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const runRes = await client.query(
        `SELECT * FROM datahub_vessel_sync_runs WHERE id = $1 AND entity_type = $2 FOR UPDATE`,
        [id, entityType]
      );
      if (runRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Sync run not found' });
      }
      if (runRes.rows[0].status !== 'staged') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Sync run is already ${runRes.rows[0].status}` });
      }

      if (itemIds) {
        await client.query(
          `UPDATE datahub_vessel_sync_items SET decision = 'rejected' WHERE run_id = $1`,
          [id]
        );
        if (itemIds.length) {
          await client.query(
            `UPDATE datahub_vessel_sync_items SET decision = 'approved'
             WHERE run_id = $1 AND id = ANY($2::bigint[])`,
            [id, itemIds]
          );
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    try {
      const result = await applyStagedEntitySyncRun(pool, id, actorId);
      writeActivityLog({
        pageKey,
        action: 'import',
        entityType: entityActivityLabel(entityType),
        entityId: `sync-${id}`,
        entityLabel: `DataHub sync #${id}`,
        summary: `Applied DataHub ${entityType} sync: ${result.created} created, ${result.updated} updated`,
        meta: { runId: id, ...result },
        actorUserId: req.userId ?? null,
      }).catch(() => {});
      res.json({ ok: true, runId: id, ...result });
    } catch (e) {
      await pool
        .query(`UPDATE datahub_vessel_sync_runs SET status = 'failed', error = $1 WHERE id = $2`, [
          String(e?.message || 'apply failed').slice(0, 2000),
          id,
        ])
        .catch(() => {});
      throw e;
    }
  });

  router.post(`${prefix}/runs/:id(\\d+)/discard`, ...requirePageEdit(pageKey), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const r = await pool.query(
      `UPDATE datahub_vessel_sync_runs SET status = 'discarded', finished_at = NOW()
       WHERE id = $1 AND status = 'staged' AND entity_type = $2 RETURNING id`,
      [id, entityType]
    );
    if (r.rows.length === 0) {
      return res.status(409).json({ error: 'Sync run is not staged' });
    }
    res.json({ ok: true, runId: id });
  });
}

export { toRun, toItem };
