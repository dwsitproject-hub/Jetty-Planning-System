/**
 * Operator Mode: start and stop kuras on another palka while the open cargo entry keeps pumping
 * (movement type Mixed). Starting sets the entry to Mixed; the periods are saved like the ones of
 * the At-Berth form (see lib/kuras-periods.js). Only while FEATURE_NET_RATE is on.
 */
import express from 'express';
import { pool } from '../db.js';
import { requireFeature } from '../lib/feature-flags.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { actorUserIdFromReq } from '../lib/master-row-audit.js';
import { mapKurasPeriodRow } from '../lib/kuras-periods.js';
import { assertOperationInSelectedPort } from '../lib/operation-access.js';
import { loadOperationScheduleTimezone, parseScheduleInstantToIso } from '../lib/schedule-instant.js';

const router = express.Router();
const PALKA_RE = /^[A-Z0-9]{1,3}$/;

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

function log(req, operationId, summary, entityId) {
  writeActivityLog({
    pageKey: 'at-berth',
    action: 'update',
    entityType: 'CargoKurasPeriod',
    entityId: String(entityId),
    entityLabel: `Operation ${operationId}`,
    summary,
    actorUserId: req.userId ?? null,
  }).catch(() => {});
}

/** POST /operations/:operationId/cargo-kuras-periods — start kuras on a palka (palka, startAt optional). */
router.post('/operations/:operationId/cargo-kuras-periods', requireFeature('netRate'), async (req, res) => {
  const operationId = await withOperation(req, res);
  if (operationId == null) return undefined;
  const palka = String(req.body?.palka ?? '').trim().toUpperCase();
  if (!PALKA_RE.test(palka)) return res.status(400).json({ error: 'Palka is required (1 to 3 letters or digits)' });

  const tz = await loadOperationScheduleTimezone(pool, operationId);
  const startedAt = req.body?.startAt ? parseScheduleInstantToIso(req.body.startAt, tz) : new Date().toISOString();
  if (!startedAt) return res.status(400).json({ error: 'A valid start time is required' });
  if (new Date(startedAt).getTime() > Date.now() + 5 * 60000) return res.status(400).json({ error: 'The start cannot be in the future' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const open = await client.query(
      `SELECT l.id, l.started_at
       FROM operation_cargo_load_lines l
       JOIN operation_operational_activities oa ON oa.id = l.operational_activity_id AND oa.deleted_at IS NULL
       WHERE oa.operation_id = $1 AND oa.milestone_key = 'cargo_operations' AND l.started_at IS NOT NULL AND l.ended_at IS NULL
       ORDER BY l.started_at DESC LIMIT 1 FOR UPDATE OF l`,
      [operationId]
    );
    const line = open.rows[0];
    if (!line) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'No cargo entry is running' });
    }
    if (new Date(startedAt) < new Date(line.started_at)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'The start cannot be before the cargo entry start' });
    }
    const running = await client.query(
      `SELECT 1 FROM operation_cargo_kuras_periods WHERE load_line_id = $1 AND ended_at IS NULL LIMIT 1`,
      [line.id]
    );
    if (running.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Kuras is already running on this entry. Stop it first.' });
    }
    const actor = actorUserIdFromReq(req);
    await client.query(
      `UPDATE operation_cargo_load_lines
       SET movement_type = 'mixed', movement_type_source = 'manual', movement_type_reason = '{"code":"manual"}'::jsonb,
           movement_type_set_by = $2, movement_type_set_at = NOW(),
           kuras_started_at = NULL, kuras_start_source = 'manual', kuras_start_reason = '{"code":"manual"}'::jsonb,
           kuras_start_set_by = $2, kuras_start_set_at = NOW()
       WHERE id = $1 AND movement_type IS DISTINCT FROM 'mixed'`,
      [line.id, actor]
    );
    const ins = await client.query(
      `INSERT INTO operation_cargo_kuras_periods (load_line_id, palka, started_at) VALUES ($1, $2, $3)
       RETURNING id, palka, started_at, ended_at, qty`,
      [line.id, palka, startedAt]
    );
    await client.query('COMMIT');
    const period = mapKurasPeriodRow(ins.rows[0]);
    log(req, operationId, `Started kuras on palka ${palka} at ${startedAt}`, period.id);
    return res.status(201).json(period);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

/** POST /operations/:operationId/cargo-kuras-periods/:periodId/stop — end now unless endAt is given; qty optional. */
router.post('/operations/:operationId/cargo-kuras-periods/:periodId/stop', requireFeature('netRate'), async (req, res) => {
  const operationId = await withOperation(req, res);
  if (operationId == null) return undefined;
  const periodId = parseId(req.params.periodId);
  if (periodId == null) return res.status(400).json({ error: 'Invalid periodId' });

  const found = await pool.query(
    `SELECT p.id, p.palka, p.started_at, p.ended_at, l.ended_at AS line_end, COALESCE(l.qty, l.manual_qty) AS line_qty
     FROM operation_cargo_kuras_periods p
     JOIN operation_cargo_load_lines l ON l.id = p.load_line_id
     JOIN operation_operational_activities oa ON oa.id = l.operational_activity_id AND oa.deleted_at IS NULL
     WHERE p.id = $1 AND oa.operation_id = $2`,
    [periodId, operationId]
  );
  const row = found.rows[0];
  if (!row) return res.status(404).json({ error: 'Kuras period not found' });
  if (row.ended_at) return res.status(409).json({ error: 'This kuras period is already stopped' });

  const tz = await loadOperationScheduleTimezone(pool, operationId);
  let endedAt = req.body?.endAt ? parseScheduleInstantToIso(req.body.endAt, tz) : new Date().toISOString();
  if (!endedAt) return res.status(400).json({ error: 'A valid end time is required' });
  // the period stays inside its cargo entry: after the entry ended, it ends with it
  if (row.line_end && new Date(endedAt) > new Date(row.line_end)) endedAt = new Date(row.line_end).toISOString();
  if (new Date(endedAt) <= new Date(row.started_at)) return res.status(400).json({ error: 'The end must be after the start' });

  let qty = null;
  if (req.body?.qty != null && String(req.body.qty).trim() !== '') {
    qty = Number(req.body.qty);
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'Quantity must be above 0' });
    if (row.line_qty != null && qty > Number(row.line_qty)) return res.status(400).json({ error: 'Quantity cannot be more than the entry quantity' });
  }

  const upd = await pool.query(
    `UPDATE operation_cargo_kuras_periods SET ended_at = $2, qty = $3 WHERE id = $1 AND ended_at IS NULL
     RETURNING id, palka, started_at, ended_at, qty`,
    [periodId, endedAt, qty]
  );
  if (!upd.rows[0]) return res.status(409).json({ error: 'This kuras period is already stopped' });
  const period = mapKurasPeriodRow(upd.rows[0]);
  log(req, operationId, `Stopped kuras on palka ${row.palka} at ${endedAt}`, period.id);
  return res.json(period);
});

export default router;
