/**
 * Tank farm gauging read API (latest snapshots from Tankvision poller).
 */
import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePortScope } from '../middleware/port-scope.js';
import { requirePageView } from '../middleware/permissions.js';

const router = express.Router();
router.use(requireAuth, requirePortScope);

const PAGE_KEY = 'tank-farm';

function parsePortId(raw) {
  const n = parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
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
    levelMm: row.level_mm != null ? Number(row.level_mm) : null,
    temperatureC: row.temperature_c != null ? Number(row.temperature_c) : null,
    totalMass: row.total_mass != null ? Number(row.total_mass) : null,
    flowRateTph: row.flow_rate_tph != null ? Number(row.flow_rate_tph) : null,
    statusText: row.status_text ?? null,
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
       l.level_mm,
       l.temperature_c,
       l.total_mass,
       l.flow_rate_tph,
       l.status_text,
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

export default router;
