/**
 * Operational milestone activities (timed) + milestone N/A rows (merged entry_type).
 * Timeline merges with operation_sub_processes (Pre + Post) for unified activity log.
 */
import express from 'express';
import { pool } from '../db.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { optionalAuth } from '../middleware/auth.js';
import { promoteDockedToInProgressIfDocked } from '../lib/operation-auto-status.js';

const router = express.Router();
router.use(optionalAuth);

const MILESTONE_KEYS = new Set([
  'opening_hatch',
  'cargo_pre_conditioning',
  'cargo_operations',
  'other',
]);

const START_ONLY_MILESTONE_KEYS = new Set(['opening_hatch', 'cargo_pre_conditioning']);

function operationalActivityTitle(milestoneKey) {
  if (milestoneKey === 'opening_hatch') return 'OPENING';
  return String(milestoneKey || '').replace(/_/g, ' ').toUpperCase();
}

const SUB_PROCESS_TITLE = {
  key_meeting: 'KEY MEETING',
  nor_accepted: 'NOR ACCEPTED',
  inspection: 'INSPECTION',
  tank_inspection: 'INSPECTION',
  hold_inspection: 'INSPECTION',
  sampling: 'SAMPLING',
  initial_cargo_checking: 'INITIAL CARGO CHECKING',
  initial_sounding: 'INITIAL CARGO CHECKING',
  initial_draft_survey: 'INITIAL CARGO CHECKING',
  final_inspection: 'FINAL INSPECTION',
  final_tank_inspection: 'FINAL INSPECTION',
  final_hold_inspection: 'FINAL INSPECTION',
  final_sounding: 'FINAL CARGO CHECKING',
};

function parseOperationId(raw) {
  const v = parseInt(raw, 10);
  return Number.isNaN(v) ? null : v;
}

function titleForSubProcessKey(key) {
  return SUB_PROCESS_TITLE[key] || String(key || '').replace(/_/g, ' ').toUpperCase();
}

async function ensureOperationExists(operationId) {
  const r = await pool.query(`SELECT 1 FROM operations WHERE id = $1 AND deleted_at IS NULL`, [operationId]);
  return r.rows.length > 0;
}

/** Same SI commodity_type resolution as operations route (Solid | Liquid). */
async function loadCommodityTypeForOperation(q, operationId) {
  const r = await q.query(
    `SELECT COALESCE(
      (SELECT sc.commodity_type FROM public.shipping_instruction_breakdown b
       JOIN public.si_commodities sc ON sc.id = b.commodity_id AND sc.deleted_at IS NULL
       WHERE b.shipping_instruction_id = si.id AND b.deleted_at IS NULL
       ORDER BY b.line_order, b.id LIMIT 1),
      'Liquid'
    ) AS commodity_type
     FROM operations o
     JOIN shipping_instructions si ON o.shipping_instruction_id = si.id AND si.deleted_at IS NULL
     WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [operationId]
  );
  if (r.rows.length === 0) return null;
  const t = String(r.rows[0].commodity_type || 'Liquid');
  return t === 'Solid' ? 'Solid' : 'Liquid';
}

async function resolveCargoHandlingMethodIdForOpening(q, commodityType) {
  const code = commodityType === 'Solid' ? 'conveyor' : 'hose';
  const r = await q.query(
    `SELECT id FROM master_cargo_handling_methods
     WHERE code = $1 AND deleted_at IS NULL AND is_active = TRUE`,
    [code]
  );
  if (r.rows.length === 0) {
    const err = new Error(
      `Master data missing active cargo handling method with code "${code}" (required for Opening)`
    );
    err.statusCode = 400;
    throw err;
  }
  return r.rows[0].id;
}

/** Cargo handling method FK: only opening_hatch rows store it; all other milestones null. */
async function resolveActivityCargoHandlingMethodId(q, operationId, milestoneKey) {
  if (milestoneKey !== 'opening_hatch') return null;
  const ct = await loadCommodityTypeForOperation(q, operationId);
  if (!ct) {
    const err = new Error('Operation not found or has no shipping instruction');
    err.statusCode = 404;
    throw err;
  }
  return resolveCargoHandlingMethodIdForOpening(q, ct);
}

function toRow(r) {
  return {
    id: String(r.id),
    operationId: r.operation_id,
    entryType: r.entry_type,
    milestoneKey: r.milestone_key,
    subStepTitle: r.sub_step_title ?? null,
    remark: r.remark ?? null,
    reason: r.reason ?? null,
    startAt: r.start_at ?? null,
    endAt: r.end_at ?? null,
    markedAt: r.marked_at ?? null,
    cargoHandlingMethodId: r.cargo_handling_method_id ?? null,
    cargoHandlingMethodName: r.cargo_handling_method_name ?? null,
    createdAt: r.created_at ?? null,
    updatedAt: r.updated_at ?? null,
  };
}

async function softDeleteMilestoneNaFor(operationId, milestoneKey, client = null) {
  const q = `UPDATE operation_operational_activities
     SET deleted_at = NOW(), updated_at = NOW()
     WHERE operation_id = $1 AND milestone_key = $2 AND entry_type = 'milestone_na' AND deleted_at IS NULL`;
  const args = [operationId, milestoneKey];
  if (client) await client.query(q, args);
  else await pool.query(q, args);
}

/** GET /operations/:operationId/operational-activities */
router.get('/operations/:operationId/operational-activities', async (req, res) => {
  const operationId = parseOperationId(req.params.operationId);
  if (operationId == null) return res.status(400).json({ error: 'Invalid operationId' });
  if (!(await ensureOperationExists(operationId))) {
    return res.status(404).json({ error: 'Operation not found' });
  }
  const r = await pool.query(
    `SELECT oa.id, oa.operation_id, oa.entry_type, oa.milestone_key, oa.sub_step_title, oa.remark, oa.reason,
            oa.start_at, oa.end_at, oa.marked_at, oa.created_at, oa.updated_at,
            oa.cargo_handling_method_id,
            mhm.name AS cargo_handling_method_name
     FROM operation_operational_activities oa
     LEFT JOIN master_cargo_handling_methods mhm
       ON mhm.id = oa.cargo_handling_method_id
      AND mhm.deleted_at IS NULL
     WHERE oa.operation_id = $1 AND oa.deleted_at IS NULL
     ORDER BY
      CASE oa.entry_type WHEN 'milestone_na' THEN 0 ELSE 1 END,
      COALESCE(oa.start_at, oa.marked_at, oa.created_at) ASC NULLS LAST,
      oa.id ASC`,
    [operationId]
  );
  res.json({ entries: r.rows.map(toRow) });
});

/** POST /operations/:operationId/operational-activities */
router.post('/operations/:operationId/operational-activities', async (req, res) => {
  const operationId = parseOperationId(req.params.operationId);
  if (operationId == null) return res.status(400).json({ error: 'Invalid operationId' });
  if (!(await ensureOperationExists(operationId))) {
    return res.status(404).json({ error: 'Operation not found' });
  }

  const body = req.body || {};
  const entryType = String(body.entryType || body.entry_type || '').trim();
  const milestoneKey = String(body.milestoneKey || body.milestone_key || '').trim();

  if (!['activity', 'milestone_na'].includes(entryType)) {
    return res.status(400).json({ error: 'entryType must be activity or milestone_na' });
  }
  if (!MILESTONE_KEYS.has(milestoneKey)) {
    return res.status(400).json({ error: 'Invalid milestoneKey' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (entryType === 'activity') {
      const remark = String(body.remark ?? '').trim();
      const subStepTitle = body.subStepTitle != null ? String(body.subStepTitle).trim() : '';
      const startAt = body.startAt || body.start_at;
      const endAt = body.endAt || body.end_at;
      if (!remark) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'remark is required for activity' });
      }
      if (!startAt) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'startAt is required for activity' });
      }
      const ta = new Date(startAt);
      if (Number.isNaN(ta.getTime())) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Invalid startAt' });
      }
      const startOnly = START_ONLY_MILESTONE_KEYS.has(milestoneKey);
      let tbIso = null;
      if (startOnly) {
        if (endAt != null && endAt !== '') {
          const tb = new Date(endAt);
          if (Number.isNaN(tb.getTime()) || tb < ta) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Invalid endAt' });
          }
          tbIso = tb.toISOString();
        }
      } else {
        if (!endAt) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'startAt and endAt are required for activity' });
        }
        const tb = new Date(endAt);
        if (Number.isNaN(tb.getTime()) || tb < ta) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Invalid startAt/endAt' });
        }
        tbIso = tb.toISOString();
      }

      let activityCargoHandlingMethodId = null;
      try {
        activityCargoHandlingMethodId = await resolveActivityCargoHandlingMethodId(
          client,
          operationId,
          milestoneKey
        );
      } catch (e) {
        await client.query('ROLLBACK');
        const status = Number.isInteger(e?.statusCode) && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 400;
        return res.status(status).json({ error: e.message || 'Could not resolve cargo handling method' });
      }

      await softDeleteMilestoneNaFor(operationId, milestoneKey, client);

      const ins = await client.query(
        `INSERT INTO operation_operational_activities
         (operation_id, entry_type, milestone_key, sub_step_title, remark, start_at, end_at, cargo_handling_method_id)
         VALUES ($1,'activity',$2,$3,$4,$5,$6,$7)
         RETURNING id, operation_id, entry_type, milestone_key, sub_step_title, remark, reason,
                   start_at, end_at, marked_at, created_at, updated_at, cargo_handling_method_id`,
        [
          operationId,
          milestoneKey,
          subStepTitle || null,
          remark,
          ta.toISOString(),
          tbIso,
          activityCargoHandlingMethodId,
        ]
      );
      await promoteDockedToInProgressIfDocked(client, operationId);
      await client.query('COMMIT');
      const row = ins.rows[0];
      if (row.cargo_handling_method_id) {
        const m = await pool.query(
          `SELECT name FROM master_cargo_handling_methods WHERE id = $1 AND deleted_at IS NULL`,
          [row.cargo_handling_method_id]
        );
        row.cargo_handling_method_name = m.rows[0]?.name ?? null;
      }
      writeActivityLog({
        pageKey: 'loading',
        action: 'add',
        entityType: 'Operational activity',
        entityId: String(operationId),
        entityLabel: milestoneKey,
        summary: `Added operational activity (${milestoneKey})`,
        meta: { operationId, entryId: row.id },
        actorUserId: req.userId ?? null,
      }).catch(() => {});
      return res.status(201).json(toRow(row));
    }

    // milestone_na
    const reason = String(body.reason ?? '').trim();
    if (!reason) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'reason is required for milestone_na' });
    }
    const markedAt = body.markedAt || body.marked_at ? new Date(body.markedAt || body.marked_at) : new Date();
    if (Number.isNaN(markedAt.getTime())) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid markedAt' });
    }

    const ex = await client.query(
      `SELECT id FROM operation_operational_activities
       WHERE operation_id = $1 AND milestone_key = $2 AND entry_type = 'milestone_na' AND deleted_at IS NULL`,
      [operationId, milestoneKey]
    );

    let row;
    if (ex.rows[0]) {
      const up = await client.query(
        `UPDATE operation_operational_activities SET
           reason = $1, marked_at = $2, updated_at = NOW()
         WHERE id = $3 AND deleted_at IS NULL
         RETURNING id, operation_id, entry_type, milestone_key, sub_step_title, remark, reason,
                   start_at, end_at, marked_at, created_at, updated_at`,
        [reason, markedAt.toISOString(), ex.rows[0].id]
      );
      row = up.rows[0];
    } else {
      const ins = await client.query(
        `INSERT INTO operation_operational_activities
         (operation_id, entry_type, milestone_key, reason, marked_at)
         VALUES ($1,'milestone_na',$2,$3,$4)
         RETURNING id, operation_id, entry_type, milestone_key, sub_step_title, remark, reason,
                   start_at, end_at, marked_at, created_at, updated_at`,
        [operationId, milestoneKey, reason, markedAt.toISOString()]
      );
      row = ins.rows[0];
    }
    await promoteDockedToInProgressIfDocked(client, operationId);
    await client.query('COMMIT');
    writeActivityLog({
      pageKey: 'loading',
      action: ex.rows[0] ? 'update' : 'add',
      entityType: 'Operational milestone N/A',
      entityId: String(operationId),
      entityLabel: milestoneKey,
      summary: `${ex.rows[0] ? 'Updated' : 'Marked'} operational milestone N/A (${milestoneKey})`,
      meta: { operationId, entryId: row.id },
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    return res.status(ex.rows[0] ? 200 : 201).json(toRow(row));
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

/** PUT /operations/:operationId/operational-activities/:entryId */
router.put('/operations/:operationId/operational-activities/:entryId', async (req, res) => {
  const operationId = parseOperationId(req.params.operationId);
  const entryId = parseInt(req.params.entryId, 10);
  if (operationId == null || Number.isNaN(entryId)) {
    return res.status(400).json({ error: 'Invalid operationId or entryId' });
  }
  const cur = await pool.query(
    `SELECT * FROM operation_operational_activities
     WHERE id = $1 AND operation_id = $2 AND deleted_at IS NULL`,
    [entryId, operationId]
  );
  if (cur.rows.length === 0) return res.status(404).json({ error: 'Entry not found' });

  const row0 = cur.rows[0];
  const body = req.body || {};

  if (row0.entry_type === 'activity') {
    const milestoneKey = String(body.milestoneKey || body.milestone_key || row0.milestone_key).trim();
    if (!MILESTONE_KEYS.has(milestoneKey)) {
      return res.status(400).json({ error: 'Invalid milestoneKey' });
    }
    const remark = body.remark != null ? String(body.remark).trim() : row0.remark;
    const subStepTitle = body.subStepTitle != null ? String(body.subStepTitle).trim() : row0.sub_step_title;
    const startAt = body.startAt || body.start_at || row0.start_at;
    const endAt =
      body.endAt !== undefined && body.endAt !== null
        ? body.endAt
        : body.end_at !== undefined && body.end_at !== null
          ? body.end_at
          : row0.end_at;
    if (!remark) return res.status(400).json({ error: 'remark is required' });
    const ta = new Date(startAt);
    if (Number.isNaN(ta.getTime())) return res.status(400).json({ error: 'Invalid startAt' });
    const startOnly = START_ONLY_MILESTONE_KEYS.has(milestoneKey);
    let tbIso = null;
    if (startOnly) {
      if (endAt != null && endAt !== '') {
        const tb = new Date(endAt);
        if (Number.isNaN(tb.getTime()) || tb < ta) return res.status(400).json({ error: 'Invalid endAt' });
        tbIso = tb.toISOString();
      }
    } else {
      const tb = new Date(endAt);
      if (Number.isNaN(tb.getTime()) || tb < ta) return res.status(400).json({ error: 'Invalid startAt/endAt' });
      tbIso = tb.toISOString();
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (milestoneKey !== row0.milestone_key) {
        await softDeleteMilestoneNaFor(operationId, milestoneKey, client);
      }

      let putActivityCargoHandlingMethodId = null;
      try {
        putActivityCargoHandlingMethodId = await resolveActivityCargoHandlingMethodId(
          client,
          operationId,
          milestoneKey
        );
      } catch (e) {
        await client.query('ROLLBACK');
        const status = Number.isInteger(e?.statusCode) && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 400;
        return res.status(status).json({ error: e.message || 'Could not resolve cargo handling method' });
      }

      const up = await client.query(
        `UPDATE operation_operational_activities SET
           milestone_key = $1,
           sub_step_title = $2,
           remark = $3,
           start_at = $4,
           end_at = $5,
           cargo_handling_method_id = $6,
           updated_at = NOW()
         WHERE id = $7 AND operation_id = $8 AND entry_type = 'activity' AND deleted_at IS NULL
         RETURNING id, operation_id, entry_type, milestone_key, sub_step_title, remark, reason,
                   start_at, end_at, marked_at, created_at, updated_at, cargo_handling_method_id`,
        [
          milestoneKey,
          subStepTitle || null,
          remark,
          ta.toISOString(),
          tbIso,
          putActivityCargoHandlingMethodId,
          entryId,
          operationId,
        ]
      );
      await promoteDockedToInProgressIfDocked(client, operationId);
      await client.query('COMMIT');
      const row = up.rows[0];
      if (row.cargo_handling_method_id) {
        const m = await pool.query(
          `SELECT name FROM master_cargo_handling_methods WHERE id = $1 AND deleted_at IS NULL`,
          [row.cargo_handling_method_id]
        );
        row.cargo_handling_method_name = m.rows[0]?.name ?? null;
      }
      writeActivityLog({
        pageKey: 'loading',
        action: 'update',
        entityType: 'Operational activity',
        entityId: String(operationId),
        entityLabel: milestoneKey,
        summary: `Updated operational activity (${milestoneKey})`,
        meta: { operationId, entryId },
        actorUserId: req.userId ?? null,
      }).catch(() => {});
      return res.json(toRow(row));
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // milestone_na — only reason / marked_at
  const reason = body.reason != null ? String(body.reason).trim() : row0.reason;
  if (!reason) return res.status(400).json({ error: 'reason is required' });
  let markedAt = row0.marked_at;
  if (body.markedAt || body.marked_at) {
    const d = new Date(body.markedAt || body.marked_at);
    if (!Number.isNaN(d.getTime())) markedAt = d.toISOString();
  }
  const clientNa = await pool.connect();
  try {
    await clientNa.query('BEGIN');
    const up = await clientNa.query(
      `UPDATE operation_operational_activities SET reason = $1, marked_at = $2, updated_at = NOW()
       WHERE id = $3 AND operation_id = $4 AND entry_type = 'milestone_na' AND deleted_at IS NULL
       RETURNING id, operation_id, entry_type, milestone_key, sub_step_title, remark, reason,
                 start_at, end_at, marked_at, created_at, updated_at`,
      [reason, markedAt, entryId, operationId]
    );
    await promoteDockedToInProgressIfDocked(clientNa, operationId);
    await clientNa.query('COMMIT');
    writeActivityLog({
      pageKey: 'loading',
      action: 'update',
      entityType: 'Operational milestone N/A',
      entityId: String(operationId),
      entityLabel: row0.milestone_key,
      summary: `Updated operational milestone N/A (${row0.milestone_key})`,
      meta: { operationId, entryId },
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    return res.json(toRow(up.rows[0]));
  } catch (e) {
    await clientNa.query('ROLLBACK');
    throw e;
  } finally {
    clientNa.release();
  }
});

/** DELETE /operations/:operationId/operational-activities/:entryId */
router.delete('/operations/:operationId/operational-activities/:entryId', async (req, res) => {
  const operationId = parseOperationId(req.params.operationId);
  const entryId = parseInt(req.params.entryId, 10);
  if (operationId == null || Number.isNaN(entryId)) {
    return res.status(400).json({ error: 'Invalid operationId or entryId' });
  }
  const r = await pool.query(
    `UPDATE operation_operational_activities SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND operation_id = $2 AND deleted_at IS NULL
     RETURNING entry_type, milestone_key`,
    [entryId, operationId]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Entry not found' });
  writeActivityLog({
    pageKey: 'loading',
    action: 'delete',
    entityType: r.rows[0].entry_type === 'milestone_na' ? 'Operational milestone N/A' : 'Operational activity',
    entityId: String(operationId),
    entityLabel: r.rows[0].milestone_key,
    summary: `Deleted operational entry (${r.rows[0].milestone_key})`,
    meta: { operationId, entryId },
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.status(204).send();
});

/** GET /operations/:operationId/activity-timeline */
router.get('/operations/:operationId/activity-timeline', async (req, res) => {
  const operationId = parseOperationId(req.params.operationId);
  if (operationId == null) return res.status(400).json({ error: 'Invalid operationId' });
  if (!(await ensureOperationExists(operationId))) {
    return res.status(404).json({ error: 'Operation not found' });
  }

  const [sp, opAct] = await Promise.all([
    pool.query(
      `SELECT id, operation_id, phase, sub_process_key, status, occurred_at, start_at, end_at, skip_reason, remark, updated_at, created_at
       FROM operation_sub_processes
       WHERE operation_id = $1 AND deleted_at IS NULL
       ORDER BY COALESCE(start_at, occurred_at, updated_at, created_at) ASC NULLS LAST, id ASC`,
      [operationId]
    ),
    pool.query(
      `SELECT oa.id, oa.entry_type, oa.milestone_key, oa.sub_step_title, oa.remark, oa.reason,
              oa.start_at, oa.end_at, oa.marked_at, oa.created_at, oa.cargo_handling_method_id,
              mhm.name AS cargo_handling_method_name
       FROM operation_operational_activities oa
       LEFT JOIN master_cargo_handling_methods mhm
         ON mhm.id = oa.cargo_handling_method_id
        AND mhm.deleted_at IS NULL
       WHERE oa.operation_id = $1 AND oa.deleted_at IS NULL`,
      [operationId]
    ),
  ]);

  const events = [];

  for (const r of sp.rows) {
    const phase = r.phase;
    const key = r.sub_process_key;
    const sortTs = r.start_at || r.occurred_at || r.updated_at || r.created_at;
    events.push({
      id: `sp-${r.id}`,
      source: 'sub_process',
      phase,
      subProcessKey: key,
      title: titleForSubProcessKey(key),
      status: r.status ?? null,
      skipReason: r.skip_reason ?? null,
      remark: r.remark ?? null,
      occurredAt: r.occurred_at ?? null,
      startAt: r.start_at ?? r.occurred_at ?? null,
      endAt: r.end_at ?? null,
      sortAt: sortTs ? new Date(sortTs).toISOString() : new Date(r.created_at).toISOString(),
    });
  }

  for (const r of opAct.rows) {
    if (r.entry_type === 'activity') {
      const sortTs = r.start_at || r.created_at;
      events.push({
        id: `op-${r.id}`,
        source: 'operational_activity',
        phase: 'Operational',
        milestoneKey: r.milestone_key,
        title: operationalActivityTitle(r.milestone_key),
        subStepTitle: r.sub_step_title ?? null,
        cargoHandlingMethodId: r.cargo_handling_method_id ?? null,
        cargoHandlingMethodName: r.cargo_handling_method_name ?? null,
        remark: r.remark ?? null,
        occurredAt: null,
        startAt: r.start_at ?? null,
        endAt: r.end_at ?? null,
        sortAt: sortTs ? new Date(sortTs).toISOString() : new Date(r.created_at).toISOString(),
      });
    } else {
      const sortTs = r.marked_at || r.created_at;
      events.push({
        id: `op-${r.id}`,
        source: 'operational_milestone_na',
        phase: 'Operational',
        milestoneKey: r.milestone_key,
        title: `${operationalActivityTitle(r.milestone_key)} · N/A`,
        reason: r.reason ?? null,
        occurredAt: null,
        startAt: null,
        endAt: null,
        sortAt: sortTs ? new Date(sortTs).toISOString() : new Date(r.created_at).toISOString(),
      });
    }
  }

  events.sort((a, b) => {
    const ta = new Date(a.sortAt).getTime();
    const tb = new Date(b.sortAt).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });

  res.json({ events });
});

export default router;
