/**
 * Tank farm gauging read API (latest snapshots from Tankvision poller).
 */
import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePortScope } from '../middleware/port-scope.js';
import { requirePageView } from '../middleware/permissions.js';
import { computeAtgWindowMassDelta } from '../lib/atg-window-rate.js';

const router = express.Router();
router.use(requireAuth, requirePortScope);

const PAGE_KEY = 'tank-farm';

function parsePortId(raw) {
  const n = parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseTankIds(raw) {
  if (raw == null || raw === '') return [];
  const parts = Array.isArray(raw) ? raw : String(raw).split(',');
  const ids = [];
  for (const p of parts) {
    const n = parseInt(String(p).trim(), 10);
    if (Number.isFinite(n) && n > 0 && !ids.includes(n)) ids.push(n);
  }
  return ids;
}

function assertPortAllowed(req, portId) {
  const allowed = Array.isArray(req.assignedPortIds) ? req.assignedPortIds : [];
  return allowed.includes(Number(portId));
}

function toReading(row) {
  return {
    tankId: String(row.tank_id),
    code: row.code,
    name: row.name ?? null,
    productName: row.product_name ?? null,
    tankComment: row.tank_comment ?? null,
    levelMm: row.level_mm != null ? Number(row.level_mm) : null,
    temperatureC: row.temperature_c != null ? Number(row.temperature_c) : null,
    observedDensityKgM3:
      row.observed_density_kg_m3 != null ? Number(row.observed_density_kg_m3) : null,
    totalObservedVolume:
      row.total_observed_volume != null ? Number(row.total_observed_volume) : null,
    totalMass: row.total_mass != null ? Number(row.total_mass) : null,
    flowRateTph: row.flow_rate_tph != null ? Number(row.flow_rate_tph) : null,
    statusText: row.status_text ?? null,
    tankStatusCode: row.tank_status_code != null ? Number(row.tank_status_code) : null,
    levelMovement: row.level_movement != null ? Number(row.level_movement) : null,
    gaugeRefHeightMm:
      row.gauge_ref_height_mm != null ? Number(row.gauge_ref_height_mm) : null,
    recordedAt: row.recorded_at ?? null,
    fetchedAt: row.fetched_at ?? null,
    sourceBaseUrl: row.source_base_url ?? null,
    sourceUnitName: row.source_unit_name ?? null,
  };
}

/** GET /tank-gauging/latest?portId= — mapped tanks with latest reading (null metrics if never polled) */
router.get('/latest', ...requirePageView(PAGE_KEY), async (req, res) => {
  const portId = parsePortId(req.query.portId ?? req.query.port_id);
  if (portId == null) {
    return res.status(400).json({ error: 'portId is required' });
  }
  if (!assertPortAllowed(req, portId)) {
    return res.status(403).json({ error: 'Selected port is not assigned to this user' });
  }

  const r = await pool.query(
    `SELECT
       m.tank_id,
       t.code,
       t.name,
       t.sort_order,
       m.source_base_url,
       COALESCE(l.source_unit_name, m.source_unit_name) AS source_unit_name,
       l.product_name,
       l.tank_comment,
       l.level_mm,
       l.temperature_c,
       l.observed_density_kg_m3,
       l.total_observed_volume,
       l.total_mass,
       l.flow_rate_tph,
       l.status_text,
       l.tank_status_code,
       l.level_movement,
       l.gauge_ref_height_mm,
       l.recorded_at,
       l.fetched_at
     FROM tank_gauging_tank_map m
     JOIN master_tanks t
       ON t.id = m.tank_id
      AND t.deleted_at IS NULL
     LEFT JOIN tank_gauging_latest l ON l.tank_id = m.tank_id
     WHERE m.port_id = $1
       AND t.port_id = $1
     ORDER BY m.source_base_url ASC, t.sort_order ASC, LOWER(t.code) ASC, t.id ASC`,
    [portId]
  );

  res.json(r.rows.map(toReading));
});

/** GET /tank-gauging/mass-delta — segment mass Δ for cargo ops (no tank-farm page permission required) */
router.get('/mass-delta', async (req, res) => {
  const portId = parsePortId(req.query.portId ?? req.query.port_id);
  const tankIds = parseTankIds(req.query.tankIds ?? req.query.tank_ids);
  const startAt = req.query.startAt ?? req.query.start_at;
  const endAtRaw = req.query.endAt ?? req.query.end_at;
  const endAt = endAtRaw != null && endAtRaw !== '' ? endAtRaw : new Date().toISOString();

  if (portId == null) {
    return res.status(400).json({ error: 'portId is required' });
  }
  if (!assertPortAllowed(req, portId)) {
    return res.status(403).json({ error: 'Selected port is not assigned to this user' });
  }
  if (!tankIds.length) {
    return res.status(400).json({ error: 'tankIds is required' });
  }
  if (!startAt) {
    return res.status(400).json({ error: 'startAt is required' });
  }

  const portCheck = await pool.query(
    `SELECT id FROM master_tanks
     WHERE id = ANY($1::bigint[]) AND port_id = $2 AND deleted_at IS NULL`,
    [tankIds, portId]
  );
  if (portCheck.rows.length !== tankIds.length) {
    return res.status(400).json({ error: 'One or more tanks are invalid for this port' });
  }

  const result = await computeAtgWindowMassDelta(pool, { tankIds, startAt, endAt });
  res.json({
    sumDeltaMass: result.sumDeltaMass,
    incomplete: result.incomplete,
    error: result.error,
    tanks: result.tanks,
  });
});

export default router;
