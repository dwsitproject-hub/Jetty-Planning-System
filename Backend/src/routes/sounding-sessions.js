/**
 * ATG sounding session API — temporary high-frequency poll for Initial Cargo Checking.
 */
import express from 'express';
import { assertOperationInSelectedPort } from '../lib/operation-access.js';
import { pool } from '../db.js';
import {
  cancelSoundingSession,
  confirmManualSoundingReading,
  createSoundingSession,
  getSoundingSession,
  lockSoundingTank,
  setSoundingTankManualMode,
  unlockSoundingTank,
} from '../lib/sounding-session-manager.js';

const router = express.Router();

function parseOperationId(raw) {
  const v = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function parseTankId(raw) {
  const v = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function parseTankIds(body) {
  const raw = body?.tankIds ?? body?.tank_ids;
  if (!Array.isArray(raw)) return [];
  const ids = [];
  for (const item of raw) {
    const n = parseInt(String(item), 10);
    if (Number.isFinite(n) && n > 0 && !ids.includes(n)) ids.push(n);
  }
  return ids;
}

async function loadOperationPort(operationId) {
  const r = await pool.query(
    `SELECT o.id, COALESCE(o.port_id, j.port_id) AS port_id,
            COALESCE(
              (SELECT sc.commodity_type FROM shipping_instruction_breakdown b
               JOIN si_commodities sc ON sc.id = b.commodity_id AND sc.deleted_at IS NULL
               WHERE b.shipping_instruction_id = o.shipping_instruction_id AND b.deleted_at IS NULL
               ORDER BY b.line_order, b.id LIMIT 1),
              'Liquid'
            ) AS commodity_type,
            COALESCE(
              (SELECT m.code FROM shipping_instruction_breakdown b
               LEFT JOIN metric m ON m.id = b.metric_id AND m.deleted_at IS NULL
               WHERE b.shipping_instruction_id = o.shipping_instruction_id AND b.deleted_at IS NULL
               ORDER BY b.line_order, b.id LIMIT 1),
              'MT'
            ) AS si_metric
     FROM operations o
     LEFT JOIN jetties j ON o.jetty_id = j.id AND j.deleted_at IS NULL
     WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [operationId]
  );
  return r.rows[0] ?? null;
}

async function assertOperationAccess(operationId, req) {
  await assertOperationInSelectedPort(operationId, req.selectedPortId);
}

/** POST /operations/:operationId/sounding-sessions */
router.post('/operations/:operationId/sounding-sessions', async (req, res) => {
  const operationId = parseOperationId(req.params.operationId);
  if (operationId == null) return res.status(400).json({ error: 'Invalid operationId' });
  await assertOperationAccess(operationId, req);

  const op = await loadOperationPort(operationId);
  if (!op) return res.status(404).json({ error: 'Operation not found' });
  if (op.commodity_type !== 'Liquid') {
    return res.status(400).json({ error: 'Sounding sessions are only available for liquid cargo' });
  }

  const tankIds = parseTankIds(req.body);
  if (!tankIds.length) return res.status(400).json({ error: 'tankIds is required' });

  const siMetric = req.body?.siMetric ?? req.body?.si_metric ?? op.si_metric ?? 'MT';
  try {
    const session = await createSoundingSession({
      operationId,
      portId: Number(op.port_id),
      tankIds,
      siMetric,
      userId: req.userId ?? null,
    });
    res.status(201).json(session);
  } catch (err) {
    const status = err.statusCode ?? 500;
    res.status(status).json({ error: err.message || 'Failed to create sounding session' });
  }
});

/** GET /sounding-sessions/:sessionId */
router.get('/sounding-sessions/:sessionId', async (req, res) => {
  const session = getSoundingSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Sounding session not found' });
  await assertOperationAccess(Number(session.operationId), req);
  res.json(session);
});

/** DELETE /sounding-sessions/:sessionId */
router.delete('/sounding-sessions/:sessionId', async (req, res) => {
  const existing = getSoundingSession(req.params.sessionId);
  if (!existing) return res.status(404).json({ error: 'Sounding session not found' });
  await assertOperationAccess(Number(existing.operationId), req);
  cancelSoundingSession(req.params.sessionId);
  res.json({ ok: true });
});

/** POST /sounding-sessions/:sessionId/lock */
router.post('/sounding-sessions/:sessionId/lock', async (req, res) => {
  const existing = getSoundingSession(req.params.sessionId);
  if (!existing) return res.status(404).json({ error: 'Sounding session not found' });
  await assertOperationAccess(Number(existing.operationId), req);

  const tankId = parseTankId(req.body?.tankId ?? req.body?.tank_id);
  if (tankId == null) return res.status(400).json({ error: 'tankId is required' });

  try {
    const tank = lockSoundingTank(req.params.sessionId, tankId);
    res.json({ tank, session: getSoundingSession(req.params.sessionId) });
  } catch (err) {
    const status = err.statusCode ?? 500;
    res.status(status).json({ error: err.message || 'Failed to lock reading' });
  }
});

/** POST /sounding-sessions/:sessionId/unlock */
router.post('/sounding-sessions/:sessionId/unlock', async (req, res) => {
  const existing = getSoundingSession(req.params.sessionId);
  if (!existing) return res.status(404).json({ error: 'Sounding session not found' });
  await assertOperationAccess(Number(existing.operationId), req);

  const tankId = parseTankId(req.body?.tankId ?? req.body?.tank_id);
  if (tankId == null) return res.status(400).json({ error: 'tankId is required' });

  try {
    const tank = unlockSoundingTank(req.params.sessionId, tankId);
    res.json({ tank, session: getSoundingSession(req.params.sessionId) });
  } catch (err) {
    const status = err.statusCode ?? 500;
    res.status(status).json({ error: err.message || 'Failed to unlock tank' });
  }
});

/** POST /sounding-sessions/:sessionId/manual-mode */
router.post('/sounding-sessions/:sessionId/manual-mode', async (req, res) => {
  const existing = getSoundingSession(req.params.sessionId);
  if (!existing) return res.status(404).json({ error: 'Sounding session not found' });
  await assertOperationAccess(Number(existing.operationId), req);

  const tankId = parseTankId(req.body?.tankId ?? req.body?.tank_id);
  if (tankId == null) return res.status(400).json({ error: 'tankId is required' });
  const enabled = req.body?.enabled !== false;

  try {
    const tank = setSoundingTankManualMode(req.params.sessionId, tankId, enabled);
    res.json({ tank, session: getSoundingSession(req.params.sessionId) });
  } catch (err) {
    const status = err.statusCode ?? 500;
    res.status(status).json({ error: err.message || 'Failed to set manual mode' });
  }
});

/** POST /sounding-sessions/:sessionId/manual */
router.post('/sounding-sessions/:sessionId/manual', async (req, res) => {
  const existing = getSoundingSession(req.params.sessionId);
  if (!existing) return res.status(404).json({ error: 'Sounding session not found' });
  await assertOperationAccess(Number(existing.operationId), req);

  const tankId = parseTankId(req.body?.tankId ?? req.body?.tank_id);
  if (tankId == null) return res.status(400).json({ error: 'tankId is required' });

  const temperatureC = Number(req.body?.temperatureC ?? req.body?.temperature_c);
  if (!Number.isFinite(temperatureC)) {
    return res.status(400).json({ error: 'temperatureC is required' });
  }

  try {
    const tank = confirmManualSoundingReading(req.params.sessionId, tankId, {
      massMt: req.body?.massMt ?? req.body?.mass_mt,
      volumeKl: req.body?.volumeKl ?? req.body?.volume_kl,
      temperatureC,
    });
    res.json({ tank, session: getSoundingSession(req.params.sessionId) });
  } catch (err) {
    const status = err.statusCode ?? 500;
    res.status(status).json({ error: err.message || 'Failed to save manual reading' });
  }
});

export default router;
