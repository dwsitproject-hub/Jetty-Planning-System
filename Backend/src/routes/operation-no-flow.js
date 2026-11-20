/**
 * No-flow log of a voyage: list recorded + unexplained stops, and add / edit / remove
 * a stop with its reason. Same access rule as cargo entries (operation in selected port).
 */
import express from 'express';
import { pool } from '../db.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { actorUserIdFromReq } from '../lib/master-row-audit.js';
import { loadLiveNudge } from '../lib/no-flow-live.js';
import { loadNoFlowSummary, mapNoFlowEvent, NO_FLOW_EVENT_SELECT } from '../lib/no-flow-store.js';
import { assertOperationInSelectedPort } from '../lib/operation-access.js';
import { loadOperationScheduleTimezone, parseScheduleInstantToIso } from '../lib/schedule-instant.js';

const router = express.Router();
const SOURCES = new Set(['atg_flat', 'gap', 'manual', 'cargo_stop', 'flow_pause', 'atg_nudge']);

function parseId(raw) {
  const v = parseInt(raw, 10);
  return Number.isFinite(v) && v > 0 ? v : null;
}

async function withOperation(req, res) {
  const operationId = parseId(req.params.operationId);
  if (operationId == null) {
    res.status(400).json({ error: 'Invalid operationId' });
    return null;
  }
  await assertOperationInSelectedPort(operationId, req.selectedPortId);
  return operationId;
}

/**
 * Validate times, reason and note; reject overlap with another recorded stop.
 * No endedAt = open stop (flow stopped now); only one can be open per voyage.
 */
async function parseEventBody(operationId, body, excludeEventId) {
  const tz = await loadOperationScheduleTimezone(pool, operationId);
  const startedAt = parseScheduleInstantToIso(body?.startedAt, tz);
  const endedAt = parseScheduleInstantToIso(body?.endedAt ?? null, tz);
  if (!startedAt || endedAt === undefined) return { error: 'A valid start time is required' };
  if (!endedAt && new Date(startedAt).getTime() > Date.now() + 5 * 60000) {
    return { error: 'An open stop cannot start in the future' };
  }
  if (endedAt && new Date(endedAt) <= new Date(startedAt)) return { error: 'End must be after start' };
  const reasonId = parseId(body?.reasonId);
  if (reasonId == null) return { error: 'reasonId is required' };
  const reason = await pool.query(
    `SELECT id, requires_note FROM master_no_flow_reasons WHERE id = $1 AND deleted_at IS NULL AND is_active`,
    [reasonId]
  );
  if (!reason.rows[0]) return { error: 'Reason not found or inactive' };
  const note = String(body?.note ?? '').trim() || null;
  if (reason.rows[0].requires_note && (!note || note.length < 3)) return { error: 'A note is required for this reason' };
  const source = SOURCES.has(body?.source) ? body.source : 'manual';
  const overlap = await pool.query(
    `SELECT 1 FROM operation_no_flow_events
     WHERE operation_id = $1 AND deleted_at IS NULL AND ($4::bigint IS NULL OR id <> $4)
       AND started_at < COALESCE($3::timestamptz, 'infinity')
       AND COALESCE(ended_at, 'infinity') > $2 LIMIT 1`,
    [operationId, startedAt, endedAt, excludeEventId]
  );
  if (overlap.rows.length) {
    return { error: 'This time overlaps another recorded stop (or a stop is still open)', status: 409 };
  }
  return { startedAt, endedAt, reasonId, note, source };
}

async function fetchEvent(operationId, eventId) {
  const r = await pool.query(
    `${NO_FLOW_EVENT_SELECT} WHERE e.id = $1 AND e.operation_id = $2 AND e.deleted_at IS NULL`,
    [eventId, operationId]
  );
  return r.rows[0] ? mapNoFlowEvent(r.rows[0]) : null;
}

function logEvent(req, action, operationId, ev) {
  writeActivityLog({
    pageKey: 'at-berth',
    action,
    entityType: 'NoFlowEvent',
    entityId: String(ev.id),
    entityLabel: `Operation ${operationId}`,
    summary: `${action === 'add' ? 'Added' : action === 'update' ? 'Updated' : 'Removed'} no-flow stop ${ev.startedAt} – ${ev.endedAt}: ${ev.reasonNameEn}`,
    actorUserId: req.userId ?? null,
  }).catch(() => {});
}

/** GET /no-flow-reasons/options — active reasons for the stop form (any signed-in user). */
router.get('/no-flow-reasons/options', async (_req, res) => {
  const r = await pool.query(
    `SELECT id, code, name_en, name_id, category, requires_note
     FROM master_no_flow_reasons WHERE deleted_at IS NULL AND is_active
     ORDER BY sort_order, code`
  );
  res.json(
    r.rows.map((x) => ({
      id: String(x.id),
      code: x.code,
      nameEn: x.name_en,
      nameId: x.name_id,
      category: x.category,
      requiresNote: x.requires_note === true,
    }))
  );
});

/** GET /operations/:operationId/no-flow */
router.get('/operations/:operationId/no-flow', async (req, res) => {
  const operationId = await withOperation(req, res);
  if (operationId == null) return undefined;
  return res.json(await loadNoFlowSummary(pool, operationId));
});

/** GET /operations/:operationId/no-flow/live — open stop + ATG nudge for the operator screen. */
router.get('/operations/:operationId/no-flow/live', async (req, res) => {
  const operationId = await withOperation(req, res);
  if (operationId == null) return undefined;
  const open = await pool.query(
    `${NO_FLOW_EVENT_SELECT} WHERE e.operation_id = $1 AND e.ended_at IS NULL AND e.deleted_at IS NULL`,
    [operationId]
  );
  const openStop = open.rows[0] ? mapNoFlowEvent(open.rows[0]) : null;
  const nudge = openStop ? null : await loadLiveNudge(pool, operationId);
  return res.json({ openStop, nudge });
});

/** POST /operations/:operationId/no-flow-events */
router.post('/operations/:operationId/no-flow-events', async (req, res) => {
  const operationId = await withOperation(req, res);
  if (operationId == null) return undefined;
  const v = await parseEventBody(operationId, req.body, null);
  if (v.error) return res.status(v.status || 400).json({ error: v.error });
  const actorId = actorUserIdFromReq(req);
  const ins = await pool.query(
    `INSERT INTO operation_no_flow_events (operation_id, started_at, ended_at, reason_id, note, source, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id`,
    [operationId, v.startedAt, v.endedAt, v.reasonId, v.note, v.source, actorId]
  );
  const ev = await fetchEvent(operationId, Number(ins.rows[0].id));
  logEvent(req, 'add', operationId, ev);
  return res.status(201).json(ev);
});

/** PUT /operations/:operationId/no-flow-events/:eventId */
router.put('/operations/:operationId/no-flow-events/:eventId', async (req, res) => {
  const operationId = await withOperation(req, res);
  if (operationId == null) return undefined;
  const eventId = parseId(req.params.eventId);
  if (eventId == null || !(await fetchEvent(operationId, eventId))) return res.status(404).json({ error: 'Stop not found' });
  const v = await parseEventBody(operationId, req.body, eventId);
  if (v.error) return res.status(v.status || 400).json({ error: v.error });
  await pool.query(
    `UPDATE operation_no_flow_events
     SET started_at = $1, ended_at = $2::timestamptz, reason_id = $3, note = $4, updated_by = $5, updated_at = NOW(),
         close_source = CASE WHEN $2::timestamptz IS NULL THEN NULL ELSE COALESCE(close_source, 'manual') END
     WHERE id = $6`,
    [v.startedAt, v.endedAt, v.reasonId, v.note, actorUserIdFromReq(req), eventId]
  );
  const ev = await fetchEvent(operationId, eventId);
  logEvent(req, 'update', operationId, ev);
  return res.json(ev);
});

/** POST /operations/:operationId/no-flow-events/:eventId/close — Flow resumed (end = now unless given). */
router.post('/operations/:operationId/no-flow-events/:eventId/close', async (req, res) => {
  const operationId = await withOperation(req, res);
  if (operationId == null) return undefined;
  const eventId = parseId(req.params.eventId);
  const ev = eventId != null ? await fetchEvent(operationId, eventId) : null;
  if (!ev) return res.status(404).json({ error: 'Stop not found' });
  if (!ev.isOpen) return res.status(409).json({ error: 'This stop is already closed' });
  const tz = await loadOperationScheduleTimezone(pool, operationId);
  const endedAt = req.body?.endedAt ? parseScheduleInstantToIso(req.body.endedAt, tz) : new Date().toISOString();
  if (!endedAt || new Date(endedAt) <= new Date(ev.startedAt)) {
    return res.status(400).json({ error: 'End must be after the stop started' });
  }
  await pool.query(
    `UPDATE operation_no_flow_events
     SET ended_at = $1, close_source = 'manual', updated_by = $2, updated_at = NOW()
     WHERE id = $3 AND ended_at IS NULL`,
    [endedAt, actorUserIdFromReq(req), eventId]
  );
  const closed = await fetchEvent(operationId, eventId);
  logEvent(req, 'update', operationId, closed);
  return res.json(closed);
});

/** DELETE /operations/:operationId/no-flow-events/:eventId — soft delete */
router.delete('/operations/:operationId/no-flow-events/:eventId', async (req, res) => {
  const operationId = await withOperation(req, res);
  if (operationId == null) return undefined;
  const eventId = parseId(req.params.eventId);
  const ev = eventId != null ? await fetchEvent(operationId, eventId) : null;
  if (!ev) return res.status(404).json({ error: 'Stop not found' });
  await pool.query(
    `UPDATE operation_no_flow_events SET deleted_at = NOW(), updated_by = $1, updated_at = NOW() WHERE id = $2`,
    [actorUserIdFromReq(req), eventId]
  );
  logEvent(req, 'delete', operationId, ev);
  return res.status(204).send();
});

export default router;
