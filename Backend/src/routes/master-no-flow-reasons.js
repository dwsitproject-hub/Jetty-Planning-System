/**
 * No-flow reasons master (shared by all ports) plus the per-port minimum stop length
 * that decides when a stop needs a reason.
 */
import express from 'express';
import { pool } from '../db.js';
import { writeActivityLog } from '../lib/activity-log.js';
import {
  actorUserIdFromReq,
  masterAuditJoinSql,
  masterAuditSelectSql,
  pickMasterAudit,
} from '../lib/master-row-audit.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePortScope } from '../middleware/port-scope.js';
import { requirePageDelete, requirePageEdit, requirePageView } from '../middleware/permissions.js';

const PAGE_KEY = 'master-no-flow-reasons';
const CATEGORIES = new Set(['terminal', 'vessel', 'external', 'other']);
const router = express.Router();
router.use(requireAuth, requirePortScope);

function toReason(row) {
  return {
    id: String(row.id),
    code: row.code,
    nameEn: row.name_en,
    nameId: row.name_id,
    category: row.category,
    requiresNote: row.requires_note === true,
    sortOrder: Number(row.sort_order ?? 0),
    isActive: row.is_active === true,
    ...pickMasterAudit(row),
  };
}

async function fetchReasons(id = null) {
  const r = await pool.query(
    `SELECT t.id, t.code, t.name_en, t.name_id, t.category, t.requires_note, t.sort_order, t.is_active,
            ${masterAuditSelectSql('t')}
     FROM master_no_flow_reasons t
     ${masterAuditJoinSql('t')}
     WHERE t.deleted_at IS NULL AND ($1::bigint IS NULL OR t.id = $1)
     ORDER BY t.sort_order, t.code`,
    [id]
  );
  return r.rows.map(toReason);
}

function parseBody(body) {
  const code = String(body?.code ?? '').trim().toUpperCase();
  const nameEn = String(body?.nameEn ?? '').trim();
  const nameId = String(body?.nameId ?? '').trim();
  const category = String(body?.category ?? '').trim();
  if (!code || code.length > 12) return { error: 'Code is required (max 12 characters)' };
  if (!nameEn || !nameId) return { error: 'Name in English and Bahasa Indonesia are required' };
  if (!CATEGORIES.has(category)) return { error: 'Category must be terminal, vessel, external or other' };
  const sortOrder = Number.parseInt(body?.sortOrder, 10);
  return {
    code,
    nameEn,
    nameId,
    category,
    requiresNote: body?.requiresNote === true,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    isActive: body?.isActive !== false,
  };
}

function log(req, action, reason) {
  writeActivityLog({
    pageKey: PAGE_KEY,
    action,
    entityType: 'MasterNoFlowReason',
    entityId: String(reason.id),
    entityLabel: reason.code,
    summary: `${action === 'add' ? 'Created' : action === 'update' ? 'Updated' : 'Deleted'} no-flow reason ${reason.code} – ${reason.nameEn}`,
    actorUserId: req.userId ?? null,
  }).catch(() => {});
}

function duplicate(res, e) {
  if (e?.code === '23505') return res.status(409).json({ error: 'A reason with this code already exists' });
  throw e;
}

/** GET /master/no-flow-reasons */
router.get('/', ...requirePageView(PAGE_KEY), async (_req, res) => {
  res.json(await fetchReasons());
});

/** POST /master/no-flow-reasons */
router.post('/', ...requirePageEdit(PAGE_KEY), async (req, res) => {
  const v = parseBody(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  try {
    const actorId = actorUserIdFromReq(req);
    const ins = await pool.query(
      `INSERT INTO master_no_flow_reasons (code, name_en, name_id, category, requires_note, sort_order, is_active, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id`,
      [v.code, v.nameEn, v.nameId, v.category, v.requiresNote, v.sortOrder, v.isActive, actorId]
    );
    const [reason] = await fetchReasons(Number(ins.rows[0].id));
    log(req, 'add', reason);
    return res.status(201).json(reason);
  } catch (e) {
    return duplicate(res, e);
  }
});

/** PUT /master/no-flow-reasons/:id */
router.put('/:id(\\d+)', ...requirePageEdit(PAGE_KEY), async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const v = parseBody(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  try {
    const upd = await pool.query(
      `UPDATE master_no_flow_reasons
       SET code = $1, name_en = $2, name_id = $3, category = $4, requires_note = $5, sort_order = $6,
           is_active = $7, updated_by = $8, updated_at = NOW()
       WHERE id = $9 AND deleted_at IS NULL RETURNING id`,
      [v.code, v.nameEn, v.nameId, v.category, v.requiresNote, v.sortOrder, v.isActive, actorUserIdFromReq(req), id]
    );
    if (!upd.rows.length) return res.status(404).json({ error: 'Reason not found' });
    const [reason] = await fetchReasons(id);
    log(req, 'update', reason);
    return res.json(reason);
  } catch (e) {
    return duplicate(res, e);
  }
});

/** DELETE /master/no-flow-reasons/:id — soft delete; recorded stops keep their reason. */
router.delete('/:id(\\d+)', ...requirePageDelete(PAGE_KEY), async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const [reason] = Number.isFinite(id) ? await fetchReasons(id) : [];
  if (!reason) return res.status(404).json({ error: 'Reason not found' });
  await pool.query(`UPDATE master_no_flow_reasons SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [id]);
  log(req, 'delete', reason);
  return res.status(204).send();
});

function portFromReq(req, res, raw) {
  const portId = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(portId) || portId <= 0) {
    res.status(400).json({ error: 'portId is required' });
    return null;
  }
  if (!(req.assignedPortIds || []).includes(portId)) {
    res.status(403).json({ error: 'Selected port is not assigned to this user' });
    return null;
  }
  return portId;
}

/** GET /master/no-flow-reasons/port-setting?portId= */
router.get('/port-setting', ...requirePageView(PAGE_KEY), async (req, res) => {
  const portId = portFromReq(req, res, req.query.portId);
  if (portId == null) return undefined;
  const r = await pool.query(`SELECT name, no_flow_min_minutes FROM ports WHERE id = $1`, [portId]);
  return res.json({ portId, portName: r.rows[0]?.name ?? null, minMinutes: Number(r.rows[0]?.no_flow_min_minutes ?? 60) });
});

/** PUT /master/no-flow-reasons/port-setting { portId, minMinutes } */
router.put('/port-setting', ...requirePageEdit(PAGE_KEY), async (req, res) => {
  const portId = portFromReq(req, res, req.body?.portId);
  if (portId == null) return undefined;
  const minMinutes = Number.parseInt(req.body?.minMinutes, 10);
  if (!Number.isFinite(minMinutes) || minMinutes < 5 || minMinutes > 1440) {
    return res.status(400).json({ error: 'Minimum stop length must be between 5 and 1440 minutes' });
  }
  const before = await pool.query(`SELECT name, no_flow_min_minutes FROM ports WHERE id = $1`, [portId]);
  await pool.query(`UPDATE ports SET no_flow_min_minutes = $1, updated_at = NOW() WHERE id = $2`, [minMinutes, portId]);
  writeActivityLog({
    pageKey: PAGE_KEY,
    action: 'update',
    entityType: 'Port',
    entityId: String(portId),
    entityLabel: before.rows[0]?.name ?? `Port ${portId}`,
    summary: `No-flow minimum stop length ${before.rows[0]?.no_flow_min_minutes} → ${minMinutes} min`,
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  return res.json({ portId, portName: before.rows[0]?.name ?? null, minMinutes });
});

export default router;
