/**
 * Dashboard V2 — weekly aggregates for the selected date range (UTC calendar-day chunks).
 */
import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

function parseYmd(s) {
  if (!s || typeof s !== 'string') return null;
  const t = new Date(s.trim());
  return Number.isNaN(t.getTime()) ? null : t;
}

/**
 * Split [start, end] inclusive into chunks of up to 7 days (UTC date arithmetic).
 */
function buildWeekChunks(startIso, endIso) {
  const start = parseYmd(startIso);
  const end = parseYmd(endIso);
  if (!start || !end || start > end) return [];
  const chunks = [];
  const cur = new Date(start);
  const endDay = new Date(end);
  while (cur <= endDay) {
    const chunkStart = new Date(cur);
    const chunkEnd = new Date(cur);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 6);
    if (chunkEnd > endDay) chunkEnd.setTime(endDay.getTime());
    const ws = new Date(Date.UTC(chunkStart.getUTCFullYear(), chunkStart.getUTCMonth(), chunkStart.getUTCDate()));
    const we = new Date(Date.UTC(chunkEnd.getUTCFullYear(), chunkEnd.getUTCMonth(), chunkEnd.getUTCDate()));
    we.setUTCDate(we.getUTCDate() + 1);
    const snapshot = new Date(we.getTime() - 1);
    chunks.push({
      startDate: chunkStart.toISOString().slice(0, 10),
      endDate: chunkEnd.toISOString().slice(0, 10),
      rangeStartIso: ws.toISOString(),
      rangeEndExclusiveIso: we.toISOString(),
      snapshotIso: snapshot.toISOString(),
    });
    cur.setUTCDate(chunkEnd.getUTCDate() + 1);
  }
  return chunks;
}

async function totalServiceSlots(client, portId) {
  const r = await client.query(
    `SELECT COALESCE(SUM(
        CASE
          WHEN j.status = 'Out of Service' THEN 0
          WHEN j.capacity IS NOT NULL AND j.capacity >= 1 THEN j.capacity::int
          ELSE 1
        END
      ), 0)::int AS total
     FROM jetties j
     WHERE j.port_id = $1 AND j.deleted_at IS NULL`,
    [portId]
  );
  return Number(r.rows[0]?.total) || 0;
}

async function berthOccupiedPlansAt(client, portId, tIso) {
  const r = await client.query(
    `SELECT COUNT(*)::int AS c
     FROM (
       SELECT si.shipment_plan_id
       FROM operations o
       JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
       LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
       LEFT JOIN jetties j ON j.id = COALESCE(o.jetty_id, sp.jetty_id) AND j.deleted_at IS NULL
       LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id) AND p.deleted_at IS NULL
       WHERE o.deleted_at IS NULL
         AND COALESCE(o.port_id, p.id) = $1
         AND COALESCE(o.shifting_out, sp.shifting_out, false) = false
         AND si.shipment_plan_id IS NOT NULL
       GROUP BY si.shipment_plan_id
       HAVING BOOL_OR(
         COALESCE(o.tb, sp.tb, o.docking_start_time, sp.docking_start_time) IS NOT NULL
         AND COALESCE(o.tb, sp.tb, o.docking_start_time, sp.docking_start_time) <= $2::timestamptz
         AND o.status <> 'SAILED'
         AND (
           COALESCE(o.cast_off_at, o.actual_completion_time, sp.cast_off_at, sp.sailed_at) IS NULL
           OR COALESCE(o.cast_off_at, o.actual_completion_time, sp.cast_off_at, sp.sailed_at) > $2::timestamptz
         )
       )
     ) x`,
    [portId, tIso]
  );
  return Number(r.rows[0]?.c) || 0;
}

async function countApprovedPlansInRange(client, portId, wsIso, weIso) {
  const r = await client.query(
    `SELECT COUNT(*)::int AS c
     FROM shipment_plans sp
     WHERE sp.port_id = $1
       AND sp.deleted_at IS NULL
       AND sp.approval_status = 'Approved'
       AND sp.approved_at IS NOT NULL
       AND sp.approved_at >= $2::timestamptz
       AND sp.approved_at < $3::timestamptz`,
    [portId, wsIso, weIso]
  );
  return Number(r.rows[0]?.c) || 0;
}

async function countSailedPlansInRange(client, portId, wsIso, weIso) {
  const r = await client.query(
    `SELECT COUNT(DISTINCT si.shipment_plan_id)::int AS c
     FROM operations o
     JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
     LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
     LEFT JOIN jetties j ON j.id = COALESCE(o.jetty_id, sp.jetty_id) AND j.deleted_at IS NULL
     LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id) AND p.deleted_at IS NULL
     WHERE o.deleted_at IS NULL
       AND COALESCE(o.port_id, p.id) = $1
       AND o.status = 'SAILED'
       AND si.shipment_plan_id IS NOT NULL
       AND COALESCE(o.cast_off_at, o.actual_completion_time, sp.sailed_at, sp.cast_off_at) IS NOT NULL
       AND COALESCE(o.cast_off_at, o.actual_completion_time, sp.sailed_at, sp.cast_off_at) >= $2::timestamptz
       AND COALESCE(o.cast_off_at, o.actual_completion_time, sp.sailed_at, sp.cast_off_at) < $3::timestamptz`,
    [portId, wsIso, weIso]
  );
  return Number(r.rows[0]?.c) || 0;
}

async function slaAtRiskAtSnapshot(client, portId, tIso) {
  const countR = await client.query(
    `SELECT COUNT(DISTINCT si.shipment_plan_id)::int AS c
     FROM operations o
     JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
     LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
     LEFT JOIN jetties j ON j.id = COALESCE(o.jetty_id, sp.jetty_id) AND j.deleted_at IS NULL
     LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id) AND p.deleted_at IS NULL
     WHERE o.deleted_at IS NULL
       AND COALESCE(o.port_id, p.id) = $1
       AND si.shipment_plan_id IS NOT NULL
       AND o.status NOT IN ('SAILED', 'PENDING', 'ALLOCATED')
       AND COALESCE(sp.estimated_completion_time, o.estimated_completion_time) IS NOT NULL
       AND COALESCE(sp.estimated_completion_time, o.estimated_completion_time) < $2::timestamptz
       AND (
         COALESCE(o.cast_off_at, o.actual_completion_time, sp.cast_off_at, sp.sailed_at) IS NULL
         OR COALESCE(o.cast_off_at, o.actual_completion_time, sp.cast_off_at, sp.sailed_at) > $2::timestamptz
       )`,
    [portId, tIso]
  );
  const hoursR = await client.query(
    `SELECT COALESCE(SUM(
        GREATEST(0,
          EXTRACT(EPOCH FROM (
            $2::timestamptz - COALESCE(sp.estimated_completion_time, o.estimated_completion_time)
          )) / 3600.0
        )
      ), 0)::float AS h
     FROM operations o
     JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
     LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
     LEFT JOIN jetties j ON j.id = COALESCE(o.jetty_id, sp.jetty_id) AND j.deleted_at IS NULL
     LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id) AND p.deleted_at IS NULL
     WHERE o.deleted_at IS NULL
       AND COALESCE(o.port_id, p.id) = $1
       AND si.shipment_plan_id IS NOT NULL
       AND o.status NOT IN ('SAILED', 'PENDING', 'ALLOCATED')
       AND COALESCE(sp.estimated_completion_time, o.estimated_completion_time) IS NOT NULL
       AND COALESCE(sp.estimated_completion_time, o.estimated_completion_time) < $2::timestamptz
       AND (
         COALESCE(o.cast_off_at, o.actual_completion_time, sp.cast_off_at, sp.sailed_at) IS NULL
         OR COALESCE(o.cast_off_at, o.actual_completion_time, sp.cast_off_at, sp.sailed_at) > $2::timestamptz
       )`,
    [portId, tIso]
  );
  return {
    count: Number(countR.rows[0]?.c) || 0,
    overHoursSum: Number(hoursR.rows[0]?.h) || 0,
  };
}

router.get('/weekly-trends', async (req, res) => {
  const portId = Number(req.selectedPortId);
  if (!Number.isFinite(portId)) {
    return res.status(400).json({ error: 'Port scope required' });
  }
  const { start_date: startDate, end_date: endDate } = req.query;
  if (!startDate || !endDate || typeof startDate !== 'string' || typeof endDate !== 'string') {
    return res.status(400).json({ error: 'start_date and end_date are required (YYYY-MM-DD)' });
  }
  const chunks = buildWeekChunks(startDate.trim(), endDate.trim());
  if (chunks.length === 0) {
    return res.status(400).json({ error: 'Invalid or empty date range' });
  }

  const client = await pool.connect();
  try {
    const totalSlots = await totalServiceSlots(client, portId);
    const weeks = [];
    for (const ch of chunks) {
      const occupied = await berthOccupiedPlansAt(client, portId, ch.snapshotIso);
      const pct =
        totalSlots > 0 ? Math.min(100, Math.round((occupied / totalSlots) * 1000) / 10) : null;
      const approvedPlans = await countApprovedPlansInRange(client, portId, ch.rangeStartIso, ch.rangeEndExclusiveIso);
      const sailedCount = await countSailedPlansInRange(client, portId, ch.rangeStartIso, ch.rangeEndExclusiveIso);
      const sla = await slaAtRiskAtSnapshot(client, portId, ch.snapshotIso);
      weeks.push({
        startDate: ch.startDate,
        endDate: ch.endDate,
        slotOccupancyPct: pct,
        berthOccupiedPlans: occupied,
        approvedPlans,
        sailedCount,
        slaAtRiskCount: sla.count,
        slaOverHoursSum: Math.round(sla.overHoursSum * 10) / 10,
      });
    }
    res.json({ totalSlots, weeks });
  } finally {
    client.release();
  }
});

export default router;
