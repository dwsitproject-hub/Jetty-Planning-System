/**
 * Port-scoped tank cargo movement board (read-only audit API).
 */
import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePortScope } from '../middleware/port-scope.js';
import { requirePageView } from '../middleware/permissions.js';
import { groupTankBoardRows } from '../lib/tank-cargo-movements.js';
import { buildSegmentInspectPayload } from '../lib/tank-cargo-movements-inspect.js';

const router = express.Router();
router.use(requireAuth, requirePortScope);

const PAGE_KEY = 'cargo-movement';

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

function parseIso(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 3600 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function assertPortAllowed(req, portId) {
  const allowed = Array.isArray(req.assignedPortIds) ? req.assignedPortIds : [];
  return allowed.includes(Number(portId));
}

/** GET /tank-cargo-movements/board?portId=&from=&to=&tankIds= */
router.get('/board', ...requirePageView(PAGE_KEY), async (req, res) => {
  const portId = parsePortId(req.query.portId ?? req.query.port_id);
  if (portId == null) {
    return res.status(400).json({ error: 'portId is required' });
  }
  if (!assertPortAllowed(req, portId)) {
    return res.status(403).json({ error: 'Selected port is not assigned to this user' });
  }

  const defaults = defaultRange();
  const from = parseIso(req.query.from ?? req.query.from_at, defaults.from);
  const to = parseIso(req.query.to ?? req.query.to_at, defaults.to);
  if (!from || !to) {
    return res.status(400).json({ error: 'from and to must be valid ISO datetimes' });
  }
  if (Date.parse(from) >= Date.parse(to)) {
    return res.status(400).json({ error: 'from must be before to' });
  }

  const tankIds = parseTankIds(req.query.tankIds ?? req.query.tank_ids);

  const portR = await pool.query(
    `SELECT id, schedule_timezone FROM ports WHERE id = $1 AND deleted_at IS NULL`,
    [portId]
  );
  if (!portR.rows[0]) {
    return res.status(404).json({ error: 'Port not found' });
  }

  const params = [portId, from, to];
  let tankFilterSql = '';
  if (tankIds.length) {
    params.push(tankIds);
    tankFilterSql = ` AND t.id = ANY($${params.length}::bigint[])`;
  }

  const r = await pool.query(
    `SELECT
       t.id AS tank_id,
       t.code,
       t.name,
       t.sort_order,
       (m.tank_id IS NOT NULL) AS has_atg,
       src.last_poll_ok AS source_last_poll_ok,
       src.last_poll_at AS source_last_poll_at,
       src.last_error AS source_last_error,
       m.source_base_url,
       gl.product_name,
       gl.total_mass AS current_mass,
       gl.total_observed_volume AS current_volume,
       gl.recorded_at,
       l.id AS load_line_id,
       l.line_order,
       l.qty,
       l.manual_qty,
       l.atg_qty_mode,
       l.started_at,
       l.ended_at,
       l.atg_mass_delta,
       l.atg_mass_detail,
       l.atg_mass_computed_at,
       oa.id AS activity_id,
       o.id AS operation_id,
       COALESCE(NULLIF(BTRIM(sp.vessel_name), ''), NULLIF(BTRIM(si.reference_number), ''), '—') AS vessel_name,
       spp.code AS purpose,
       j.name AS jetty_name,
       si.reference_number
     FROM master_tanks t
     LEFT JOIN tank_gauging_tank_map m
       ON m.tank_id = t.id AND m.port_id = t.port_id
     LEFT JOIN tank_gauging_sources src
       ON src.port_id = t.port_id
      AND src.base_url = m.source_base_url
     LEFT JOIN tank_gauging_latest gl ON gl.tank_id = t.id
     LEFT JOIN operation_cargo_load_line_tanks clt ON clt.tank_id = t.id
     LEFT JOIN operation_cargo_load_lines l ON l.id = clt.load_line_id
     LEFT JOIN operation_operational_activities oa
       ON oa.id = l.operational_activity_id
      AND oa.deleted_at IS NULL
      AND oa.milestone_key = 'cargo_operations'
      AND oa.entry_type = 'activity'
     LEFT JOIN operations o
       ON o.id = oa.operation_id
      AND o.deleted_at IS NULL
      AND o.port_id = $1
     LEFT JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
     LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
     LEFT JOIN si_purposes spp ON spp.id = sp.purpose_id AND spp.deleted_at IS NULL
     LEFT JOIN jetties j ON j.id = COALESCE(sp.jetty_id, o.jetty_id) AND j.deleted_at IS NULL
     WHERE t.port_id = $1
       AND t.deleted_at IS NULL
       ${tankFilterSql}
       AND (
         l.id IS NULL
         OR (
           l.started_at IS NOT NULL
           AND l.started_at < $3::timestamptz
           AND (l.ended_at IS NULL OR l.ended_at > $2::timestamptz)
         )
       )
     ORDER BY t.sort_order ASC, LOWER(t.code) ASC, t.id ASC,
              l.started_at ASC NULLS LAST, l.line_order ASC, l.id ASC`,
    params
  );

  const tanks = groupTankBoardRows(r.rows);

  res.json({
    portId: String(portId),
    from,
    to,
    scheduleTimezone: portR.rows[0].schedule_timezone || 'Asia/Jakarta',
    tanks,
  });
});

/** GET /tank-cargo-movements/segments/:loadLineId/inspect?portId=&tankId= */
router.get('/segments/:loadLineId/inspect', ...requirePageView(PAGE_KEY), async (req, res) => {
  const portId = parsePortId(req.query.portId ?? req.query.port_id);
  const loadLineId = parseInt(String(req.params.loadLineId ?? '').trim(), 10);
  const tankId = parseInt(String(req.query.tankId ?? req.query.tank_id ?? '').trim(), 10);

  if (portId == null) {
    return res.status(400).json({ error: 'portId is required' });
  }
  if (!Number.isFinite(loadLineId) || loadLineId <= 0) {
    return res.status(400).json({ error: 'Invalid loadLineId' });
  }
  if (!Number.isFinite(tankId) || tankId <= 0) {
    return res.status(400).json({ error: 'tankId is required' });
  }
  if (!assertPortAllowed(req, portId)) {
    return res.status(403).json({ error: 'Selected port is not assigned to this user' });
  }

  const payload = await buildSegmentInspectPayload(pool, { portId, loadLineId, tankId });
  if (!payload) {
    return res.status(404).json({ error: 'Segment not found for this tank and port' });
  }

  res.json(payload);
});

export default router;
