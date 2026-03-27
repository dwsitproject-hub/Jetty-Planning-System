/**
 * Operational milestone activities (timed) + milestone N/A rows (merged entry_type).
 * Timeline merges with operation_sub_processes (Pre + Post) for unified activity log.
 */
import express from 'express';
import { pool } from '../db.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { optionalAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(optionalAuth);

const MILESTONE_KEYS = new Set([
  'opening_h1_h2',
  'hose_on',
  'comm_discharge',
  'compl_discharge',
  'comm_load',
  'compl_load',
  'other',
]);

const SUB_PROCESS_TITLE = {
  key_meeting: 'KEY MEETING',
  nor_accepted: 'NOR ACCEPTED',
  tank_inspection: 'TANK INSPECTION',
  hold_inspection: 'HOLD INSPECTION',
  sampling: 'SAMPLING',
  initial_sounding: 'INITIAL SOUNDING',
  initial_draft_survey: 'INITIAL DRAFT SURVEY',
  final_tank_inspection: 'FINAL TANK INSPECTION',
  final_hold_inspection: 'FINAL HOLD INSPECTION',
  final_sounding: 'FINAL SOUNDING',
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
    `SELECT id, operation_id, entry_type, milestone_key, sub_step_title, remark, reason,
            start_at, end_at, marked_at, created_at, updated_at
     FROM operation_operational_activities
     WHERE operation_id = $1 AND deleted_at IS NULL
     ORDER BY
       CASE entry_type WHEN 'milestone_na' THEN 0 ELSE 1 END,
       COALESCE(start_at, marked_at, created_at) ASC NULLS LAST,
       id ASC`,
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
      if (!startAt || !endAt) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'startAt and endAt are required for activity' });
      }
      const ta = new Date(startAt);
      const tb = new Date(endAt);
      if (Number.isNaN(ta.getTime()) || Number.isNaN(tb.getTime()) || tb < ta) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Invalid startAt/endAt' });
      }

      await softDeleteMilestoneNaFor(operationId, milestoneKey, client);

      const ins = await client.query(
        `INSERT INTO operation_operational_activities
         (operation_id, entry_type, milestone_key, sub_step_title, remark, start_at, end_at)
         VALUES ($1,'activity',$2,$3,$4,$5,$6)
         RETURNING id, operation_id, entry_type, milestone_key, sub_step_title, remark, reason,
                   start_at, end_at, marked_at, created_at, updated_at`,
        [operationId, milestoneKey, subStepTitle || null, remark, ta.toISOString(), tb.toISOString()]
      );
      await client.query('COMMIT');
      const row = ins.rows[0];
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
    const endAt = body.endAt || body.end_at || row0.end_at;
    if (!remark) return res.status(400).json({ error: 'remark is required' });
    const ta = new Date(startAt);
    const tb = new Date(endAt);
    if (Number.isNaN(ta.getTime()) || Number.isNaN(tb.getTime()) || tb < ta) {
      return res.status(400).json({ error: 'Invalid startAt/endAt' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (milestoneKey !== row0.milestone_key) {
        await softDeleteMilestoneNaFor(operationId, milestoneKey, client);
      }
      const up = await client.query(
        `UPDATE operation_operational_activities SET
           milestone_key = $1,
           sub_step_title = $2,
           remark = $3,
           start_at = $4,
           end_at = $5,
           updated_at = NOW()
         WHERE id = $6 AND operation_id = $7 AND entry_type = 'activity' AND deleted_at IS NULL
         RETURNING id, operation_id, entry_type, milestone_key, sub_step_title, remark, reason,
                   start_at, end_at, marked_at, created_at, updated_at`,
        [milestoneKey, subStepTitle || null, remark, ta.toISOString(), tb.toISOString(), entryId, operationId]
      );
      await client.query('COMMIT');
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
      return res.json(toRow(up.rows[0]));
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
  const up = await pool.query(
    `UPDATE operation_operational_activities SET reason = $1, marked_at = $2, updated_at = NOW()
     WHERE id = $3 AND operation_id = $4 AND entry_type = 'milestone_na' AND deleted_at IS NULL
     RETURNING id, operation_id, entry_type, milestone_key, sub_step_title, remark, reason,
               start_at, end_at, marked_at, created_at, updated_at`,
    [reason, markedAt, entryId, operationId]
  );
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
      `SELECT id, operation_id, phase, sub_process_key, status, occurred_at, remark, updated_at, created_at
       FROM operation_sub_processes
       WHERE operation_id = $1 AND deleted_at IS NULL
       ORDER BY COALESCE(occurred_at, updated_at, created_at) ASC NULLS LAST, id ASC`,
      [operationId]
    ),
    pool.query(
      `SELECT id, entry_type, milestone_key, sub_step_title, remark, reason, start_at, end_at, marked_at, created_at
       FROM operation_operational_activities
       WHERE operation_id = $1 AND deleted_at IS NULL`,
      [operationId]
    ),
  ]);

  const events = [];

  for (const r of sp.rows) {
    const phase = r.phase;
    const key = r.sub_process_key;
    const sortTs = r.occurred_at || r.updated_at || r.created_at;
    events.push({
      id: `sp-${r.id}`,
      source: 'sub_process',
      phase,
      subProcessKey: key,
      title: titleForSubProcessKey(key),
      status: r.status ?? null,
      remark: r.remark ?? null,
      occurredAt: r.occurred_at ?? null,
      startAt: null,
      endAt: null,
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
        title: r.milestone_key.replace(/_/g, ' ').toUpperCase(),
        subStepTitle: r.sub_step_title ?? null,
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
        title: `${r.milestone_key.replace(/_/g, ' ').toUpperCase()} · N/A`,
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
