/**
 * Master Vessel CRUD plus the reviewed DataHub sync (migration 117).
 *
 * A sync never writes to master_vessels directly: it stages every hub record in
 * datahub_vessel_sync_items, the user reviews the per-field diff, and only
 * approved rows are applied. Credentials live behind the 'admin' permission in
 * routes/datahub-admin.js, not here.
 */
import express from 'express';
import { pool } from '../db.js';
import { requirePageDelete, requirePageEdit, requirePageView } from '../middleware/permissions.js';
import { writeActivityLog } from '../lib/activity-log.js';
import {
  actorUserIdFromReq,
  masterAuditJoinSql,
  masterAuditSelectSql,
  pickMasterAudit,
} from '../lib/master-row-audit.js';
import { fetchAllVessels } from '../lib/datahub-client.js';
import { getEffectiveDataHubConfig, updateDataHubSyncHealth } from '../lib/datahub-config.js';
import { COMPARED_COLUMNS, buildSyncPlan } from '../lib/datahub-vessel-sync.js';
import { applyVesselItem } from '../lib/datahub-vessel-apply.js';
import { tryPushAfterSave } from '../lib/datahub-vessel-push.js';

const router = express.Router();
router.use(...requirePageView('master-vessel'));

const PAGE_KEY = 'master-vessel';

/** Enum values the hub accepts; enforced on manual edits only. */
const VESSEL_TYPES = new Set(['barge', 'tanker', 'SPOB']);
const LAMBUNG_TYPES = new Set([
  'Double hull Double Bottom',
  'Single hull Double Bottom',
  'Single hull Single Bottom',
]);
const CHARTER_TYPES = new Set(['Voyage Charter', 'Time Charter']);

const VESSEL_SELECT = `SELECT v.id, v.hub_code, v.hub_record_id, v.hub_version, v.hub_updated_at,
            v.vessel_name, v.vessel_imo, v.vessel_mmsi, v.vessel_code_sap,
            v.vessel_capacity_mt, v.vessel_gross_tonnage, v.vessel_draft,
            v.vessel_length_overall, v.vessel_type, v.heater, v.type_lambung,
            v.type_charter, ${masterAuditSelectSql('v')}
     FROM master_vessels v
     ${masterAuditJoinSql('v')}`;

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function toVessel(row) {
  return {
    id: row.id != null ? Number(row.id) : row.id,
    hubCode: row.hub_code ?? null,
    hubRecordId: row.hub_record_id ?? null,
    hubVersion: row.hub_version != null ? Number(row.hub_version) : null,
    hubUpdatedAt: row.hub_updated_at ?? null,
    vesselName: row.vessel_name,
    vesselImo: row.vessel_imo ?? null,
    vesselMmsi: row.vessel_mmsi ?? null,
    vesselCodeSap: row.vessel_code_sap ?? null,
    vesselCapacityMt: num(row.vessel_capacity_mt),
    vesselGrossTonnage: num(row.vessel_gross_tonnage),
    vesselDraft: num(row.vessel_draft),
    vesselLengthOverall: row.vessel_length_overall ?? null,
    vesselType: row.vessel_type ?? null,
    heater: row.heater == null ? null : Boolean(row.heater),
    typeLambung: row.type_lambung ?? null,
    typeCharter: row.type_charter ?? null,
    ...pickMasterAudit(row),
  };
}

/** Map the camelCase request body onto column values, or return an error string. */
function readVesselBody(body) {
  const vesselName = str(body?.vesselName);
  if (!vesselName) return { error: 'vesselName is required' };

  const vesselType = str(body?.vesselType);
  if (vesselType && !VESSEL_TYPES.has(vesselType)) {
    return { error: `vesselType must be one of: ${[...VESSEL_TYPES].join(', ')}` };
  }
  const typeLambung = str(body?.typeLambung);
  if (typeLambung && !LAMBUNG_TYPES.has(typeLambung)) {
    return { error: `typeLambung must be one of: ${[...LAMBUNG_TYPES].join(', ')}` };
  }
  const typeCharter = str(body?.typeCharter);
  if (typeCharter && !CHARTER_TYPES.has(typeCharter)) {
    return { error: `typeCharter must be one of: ${[...CHARTER_TYPES].join(', ')}` };
  }

  return {
    values: {
      vessel_name: vesselName,
      vessel_imo: str(body?.vesselImo),
      vessel_mmsi: str(body?.vesselMmsi),
      vessel_code_sap: str(body?.vesselCodeSap),
      vessel_capacity_mt: num(body?.vesselCapacityMt),
      vessel_gross_tonnage: num(body?.vesselGrossTonnage),
      vessel_draft: num(body?.vesselDraft),
      vessel_length_overall: str(body?.vesselLengthOverall),
      vessel_type: vesselType,
      heater: body?.heater == null ? null : Boolean(body.heater),
      type_lambung: typeLambung,
      type_charter: typeCharter,
    },
  };
}

// ---------------------------------------------------------------------------
// Replica CRUD
// ---------------------------------------------------------------------------

router.get('/', async (req, res) => {
  const search = str(req.query.search);
  const params = [];
  let where = 'v.deleted_at IS NULL';
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where += ` AND (LOWER(v.vessel_name) LIKE $${params.length}
                OR LOWER(COALESCE(v.vessel_code_sap, '')) LIKE $${params.length}
                OR LOWER(COALESCE(v.hub_code, '')) LIKE $${params.length})`;
  }
  const r = await pool.query(
    `${VESSEL_SELECT} WHERE ${where} ORDER BY v.vessel_name ASC`,
    params
  );
  res.json(r.rows.map(toVessel));
});

router.get('/:id(\\d+)', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = await pool.query(`${VESSEL_SELECT} WHERE v.id = $1 AND v.deleted_at IS NULL`, [id]);
  if (r.rows.length === 0) return res.status(404).json({ error: 'Vessel not found' });
  res.json(toVessel(r.rows[0]));
});

router.post('/', ...requirePageEdit('master-vessel'), async (req, res) => {
  const parsed = readVesselBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const v = parsed.values;
  const actorId = actorUserIdFromReq(req);

  const dupe = await pool.query(
    `SELECT id FROM master_vessels WHERE LOWER(vessel_name) = LOWER($1) AND deleted_at IS NULL`,
    [v.vessel_name]
  );
  if (dupe.rows.length > 0) {
    return res.status(409).json({ error: 'A vessel with this name already exists' });
  }

  const ins = await pool.query(
    `INSERT INTO master_vessels (
       vessel_name, vessel_imo, vessel_mmsi, vessel_code_sap, vessel_capacity_mt,
       vessel_gross_tonnage, vessel_draft, vessel_length_overall, vessel_type,
       heater, type_lambung, type_charter, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
     RETURNING id`,
    [
      v.vessel_name, v.vessel_imo, v.vessel_mmsi, v.vessel_code_sap, v.vessel_capacity_mt,
      v.vessel_gross_tonnage, v.vessel_draft, v.vessel_length_overall, v.vessel_type,
      v.heater, v.type_lambung, v.type_charter, actorId,
    ]
  );
  const created = await pool.query(`${VESSEL_SELECT} WHERE v.id = $1`, [ins.rows[0].id]);
  const row = created.rows[0];
  writeActivityLog({
    pageKey: PAGE_KEY,
    action: 'add',
    entityType: 'Vessel',
    entityId: row.id,
    entityLabel: row.vessel_name,
    summary: 'Created vessel',
    changes: [{ field: 'Vessel Name', from: null, to: row.vessel_name }],
    actorUserId: req.userId ?? null,
  }).catch(() => {});

  const push = await tryPushAfterSave(pool, row, actorId);
  if (push.ok && push.code) {
    const linked = await pool.query(`${VESSEL_SELECT} WHERE v.id = $1`, [row.id]);
    if (linked.rows.length > 0) {
      return res.status(201).json({ ...toVessel(linked.rows[0]), push });
    }
  }
  res.status(201).json({ ...toVessel(row), push });
});

router.put('/:id(\\d+)', ...requirePageEdit('master-vessel'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const parsed = readVesselBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const v = parsed.values;

  const before = await pool.query(
    `SELECT ${COMPARED_COLUMNS.join(', ')} FROM master_vessels WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (before.rows.length === 0) return res.status(404).json({ error: 'Vessel not found' });

  const dupe = await pool.query(
    `SELECT id FROM master_vessels
     WHERE LOWER(vessel_name) = LOWER($1) AND id <> $2 AND deleted_at IS NULL`,
    [v.vessel_name, id]
  );
  if (dupe.rows.length > 0) {
    return res.status(409).json({ error: 'A vessel with this name already exists' });
  }

  await pool.query(
    `UPDATE master_vessels SET
       vessel_name = $1, vessel_imo = $2, vessel_mmsi = $3, vessel_code_sap = $4,
       vessel_capacity_mt = $5, vessel_gross_tonnage = $6, vessel_draft = $7,
       vessel_length_overall = $8, vessel_type = $9, heater = $10,
       type_lambung = $11, type_charter = $12,
       updated_by = $13, updated_at = NOW()
     WHERE id = $14 AND deleted_at IS NULL`,
    [
      v.vessel_name, v.vessel_imo, v.vessel_mmsi, v.vessel_code_sap, v.vessel_capacity_mt,
      v.vessel_gross_tonnage, v.vessel_draft, v.vessel_length_overall, v.vessel_type,
      v.heater, v.type_lambung, v.type_charter, actorUserIdFromReq(req), id,
    ]
  );

  const updated = await pool.query(`${VESSEL_SELECT} WHERE v.id = $1`, [id]);
  const row = updated.rows[0];
  const changes = COMPARED_COLUMNS.filter(
    (c) => String(before.rows[0][c] ?? '') !== String(v[c] ?? '')
  ).map((c) => ({ field: c, from: before.rows[0][c] ?? null, to: v[c] ?? null }));
  writeActivityLog({
    pageKey: PAGE_KEY,
    action: 'update',
    entityType: 'Vessel',
    entityId: id,
    entityLabel: row.vessel_name,
    summary: 'Updated vessel',
    changes,
    actorUserId: req.userId ?? null,
  }).catch(() => {});

  const push = await tryPushAfterSave(pool, row, actorUserIdFromReq(req));
  if (push.ok && push.code) {
    const linked = await pool.query(`${VESSEL_SELECT} WHERE v.id = $1`, [id]);
    if (linked.rows.length > 0) {
      return res.json({ ...toVessel(linked.rows[0]), push });
    }
  }
  res.json({ ...toVessel(row), push });
});

router.delete('/:id(\\d+)', ...requirePageDelete('master-vessel'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = await pool.query(
    `SELECT id, vessel_name FROM master_vessels WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (existing.rows.length === 0) return res.status(404).json({ error: 'Vessel not found' });

  await pool.query(
    `UPDATE master_vessels SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [id]
  );
  writeActivityLog({
    pageKey: PAGE_KEY,
    action: 'delete',
    entityType: 'Vessel',
    entityId: id,
    entityLabel: existing.rows[0].vessel_name,
    summary: `Deleted vessel "${existing.rows[0].vessel_name}"`,
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// DataHub sync: stage -> review -> apply
// ---------------------------------------------------------------------------

function toRun(row) {
  return {
    id: Number(row.id),
    status: row.status,
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

router.get('/sync/runs', async (req, res) => {
  const limitRaw = parseInt(req.query.limit, 10);
  const limit = Number.isNaN(limitRaw) ? 10 : Math.max(1, Math.min(limitRaw, 50));
  const r = await pool.query(
    `SELECT * FROM datahub_vessel_sync_runs ORDER BY started_at DESC LIMIT $1`,
    [limit]
  );
  res.json(r.rows.map(toRun));
});

/** Pull the hub, diff it, and stage the result. Writes nothing to master_vessels. */
router.post('/sync/runs', ...requirePageEdit('master-vessel'), async (req, res) => {
  const cfg = await getEffectiveDataHubConfig(pool);
  if (!cfg.enabled || !cfg.baseUrl) {
    return res.status(400).json({
      error: 'DataHub integration is not configured. Set the base URL and key pair in Admin > DataHub.',
    });
  }
  if (!cfg.publicKey || !cfg.privateKey) {
    return res.status(400).json({ error: 'DataHub key pair is not configured.' });
  }

  let hubVessels;
  try {
    hubVessels = await fetchAllVessels(cfg);
  } catch (e) {
    await updateDataHubSyncHealth(pool, { ok: false, error: e?.message });
    return res.status(502).json({ error: e?.message || 'Failed to read the DataHub vessel master' });
  }

  const localRows = await pool.query(
    `SELECT id, hub_code, ${COMPARED_COLUMNS.join(', ')}
     FROM master_vessels WHERE deleted_at IS NULL`
  );
  const { items, summary } = buildSyncPlan(hubVessels, localRows.rows);

  const client = await pool.connect();
  let runId;
  try {
    await client.query('BEGIN');
    const runRes = await client.query(
      `INSERT INTO datahub_vessel_sync_runs (
         status, hub_record_count, new_count, changed_count, unchanged_count,
         finished_at, created_by
       ) VALUES ('staged', $1, $2, $3, $4, NOW(), $5)
       RETURNING id`,
      [
        summary.hubRecordCount,
        summary.newCount,
        summary.changedCount,
        summary.unchangedCount,
        req.userId ?? null,
      ]
    );
    runId = runRes.rows[0].id;

    for (const item of items) {
      // new/changed start approved so the review screen is pre-ticked; the user
      // can untick any row and nothing is written until Apply is pressed.
      const decision = item.diffKind === 'unchanged' ? 'rejected' : 'approved';
      await client.query(
        `INSERT INTO datahub_vessel_sync_items (
           run_id, vessel_id, hub_code, vessel_name, diff_kind, payload, field_diff, decision
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          runId,
          item.vesselId,
          item.hubCode,
          item.vesselName,
          item.diffKind,
          JSON.stringify({
            values: item.values,
            hubCode: item.hubCode,
            hubRecordId: item.hubRecordId,
            hubVersion: item.hubVersion,
            hubUpdatedAt: item.hubUpdatedAt,
          }),
          JSON.stringify(item.fieldDiff),
          decision,
        ]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  await updateDataHubSyncHealth(pool, { ok: true });
  const run = await pool.query(`SELECT * FROM datahub_vessel_sync_runs WHERE id = $1`, [runId]);
  res.status(201).json({ run: toRun(run.rows[0]), summary });
});

router.get('/sync/runs/:id(\\d+)', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const run = await pool.query(`SELECT * FROM datahub_vessel_sync_runs WHERE id = $1`, [id]);
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

/** Record approve/reject decisions without applying them. */
router.patch('/sync/runs/:id(\\d+)/items', ...requirePageEdit('master-vessel'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const decisions = Array.isArray(req.body?.decisions) ? req.body.decisions : null;
  if (!decisions) return res.status(400).json({ error: 'decisions must be an array' });

  const run = await pool.query(`SELECT status FROM datahub_vessel_sync_runs WHERE id = $1`, [id]);
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

/**
 * Apply a staged run. `itemIds` (optional) replaces the stored decisions, so the
 * review screen can send its final selection in one call.
 */
router.post('/sync/runs/:id(\\d+)/apply', ...requirePageEdit('master-vessel'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const itemIds = Array.isArray(req.body?.itemIds)
    ? req.body.itemIds.map((n) => parseInt(n, 10)).filter(Number.isFinite)
    : null;
  const actorId = actorUserIdFromReq(req);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const runRes = await client.query(
      `SELECT * FROM datahub_vessel_sync_runs WHERE id = $1 FOR UPDATE`,
      [id]
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
      await client.query(`UPDATE datahub_vessel_sync_items SET decision = 'rejected' WHERE run_id = $1`, [id]);
      if (itemIds.length) {
        await client.query(
          `UPDATE datahub_vessel_sync_items SET decision = 'approved'
           WHERE run_id = $1 AND id = ANY($2::bigint[])`,
          [id, itemIds]
        );
      }
    }

    const approved = await client.query(
      `SELECT * FROM datahub_vessel_sync_items
       WHERE run_id = $1 AND decision = 'approved' AND applied_at IS NULL`,
      [id]
    );

    let created = 0;
    let updated = 0;
    for (const item of approved.rows) {
      const { action } = await applyVesselItem(client, item, actorId);
      if (action === 'created') created += 1;
      else updated += 1;
      await client.query(
        `UPDATE datahub_vessel_sync_items SET applied_at = NOW() WHERE id = $1`,
        [item.id]
      );
    }

    await client.query(
      `UPDATE datahub_vessel_sync_runs SET
         status = 'applied', applied_count = $1, applied_at = NOW(), applied_by = $2
       WHERE id = $3`,
      [created + updated, req.userId ?? null, id]
    );
    await client.query('COMMIT');

    writeActivityLog({
      pageKey: PAGE_KEY,
      action: 'import',
      entityType: 'Vessel',
      entityId: `sync-${id}`,
      entityLabel: `DataHub sync #${id}`,
      summary: `Applied DataHub vessel sync: ${created} created, ${updated} updated`,
      meta: { runId: id, created, updated },
      actorUserId: req.userId ?? null,
    }).catch(() => {});

    res.json({ ok: true, runId: id, created, updated, applied: created + updated });
  } catch (e) {
    await client.query('ROLLBACK');
    await pool
      .query(`UPDATE datahub_vessel_sync_runs SET status = 'failed', error = $1 WHERE id = $2`, [
        String(e?.message || 'apply failed').slice(0, 2000),
        id,
      ])
      .catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});

router.post('/sync/runs/:id(\\d+)/discard', ...requirePageEdit('master-vessel'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = await pool.query(
    `UPDATE datahub_vessel_sync_runs SET status = 'discarded', finished_at = NOW()
     WHERE id = $1 AND status = 'staged' RETURNING id`,
    [id]
  );
  if (r.rows.length === 0) {
    return res.status(409).json({ error: 'Sync run is not staged' });
  }
  res.json({ ok: true, runId: id });
});

export default router;
