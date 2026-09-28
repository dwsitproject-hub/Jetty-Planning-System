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
import { tryPushAfterSave } from '../lib/datahub-vessel-push.js';
import { registerDataHubSyncRoutes } from './datahub-sync-routes.js';

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
            v.datahub_last_apply_source, v.datahub_last_apply_run_id,
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
    datahubLastApplySource: row.datahub_last_apply_source ?? null,
    datahubLastApplyRunId:
      row.datahub_last_apply_run_id != null ? Number(row.datahub_last_apply_run_id) : null,
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

registerDataHubSyncRoutes(router, { entityType: 'vessel', mountPath: '/sync' });

export default router;
