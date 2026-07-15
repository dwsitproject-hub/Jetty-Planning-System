/**
 * Dashboard V2 — weekly aggregates for the selected date range (UTC calendar-day chunks).
 */
import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

const VALID_PURPOSES = new Set(['Loading', 'Unloading']);

function parseYmd(s) {
  if (!s || typeof s !== 'string') return null;
  const t = new Date(s.trim());
  return Number.isNaN(t.getTime()) ? null : t;
}

/**
 * Parse optional dashboard filter query params.
 * @returns {{ purposeCodes: string[]|null, commodityIds: number[]|null }}
 */
function parseDashboardFilters(req) {
  const purposeRaw = req.query.purpose;
  const purposeParts = [];
  if (Array.isArray(purposeRaw)) {
    for (const p of purposeRaw) {
      if (typeof p === 'string') purposeParts.push(...p.split(','));
    }
  } else if (typeof purposeRaw === 'string' && purposeRaw.trim()) {
    purposeParts.push(...purposeRaw.split(','));
  }
  const purposeCodes = [...new Set(
    purposeParts.map((p) => p.trim()).filter((p) => VALID_PURPOSES.has(p))
  )];
  const purposeFilter = purposeCodes.length > 0 ? purposeCodes : null;

  const commodityRaw = req.query.commodity_id;
  const commodityParts = [];
  if (Array.isArray(commodityRaw)) {
    for (const c of commodityRaw) {
      if (typeof c === 'string') commodityParts.push(...c.split(','));
    }
  } else if (typeof commodityRaw === 'string' && commodityRaw.trim()) {
    commodityParts.push(...commodityRaw.split(','));
  }
  const commodityIds = [...new Set(
    commodityParts
      .map((c) => parseInt(String(c).trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0)
  )];
  const commodityFilter = commodityIds.length > 0 ? commodityIds : null;

  return { purposeCodes: purposeFilter, commodityIds: commodityFilter };
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
    cur.setTime(chunkEnd.getTime());
    cur.setUTCDate(cur.getUTCDate() + 1);
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

async function berthOccupiedPlansAt(client, portId, tIso, filters) {
  const params = [portId, tIso];
  let i = 3;
  let filterSql = '';
  if (filters.purposeCodes) {
    filterSql += ` AND EXISTS (
      SELECT 1 FROM shipment_plans spf
      JOIN si_purposes sppf ON sppf.id = spf.purpose_id AND sppf.deleted_at IS NULL
      WHERE spf.id = si.shipment_plan_id
        AND spf.deleted_at IS NULL
        AND sppf.code = ANY($${i++}::text[])
    )`;
    params.push(filters.purposeCodes);
  }
  if (filters.commodityIds) {
    filterSql += ` AND EXISTS (
      SELECT 1 FROM shipping_instructions sif
      JOIN shipping_instruction_breakdown bf ON bf.shipping_instruction_id = sif.id AND bf.deleted_at IS NULL
      WHERE sif.shipment_plan_id = si.shipment_plan_id
        AND sif.deleted_at IS NULL
        AND bf.commodity_id = ANY($${i++}::int[])
    )`;
    params.push(filters.commodityIds);
  }

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
         ${filterSql}
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
    params
  );
  return Number(r.rows[0]?.c) || 0;
}

async function countApprovedPlansInRange(client, portId, wsIso, weIso, filters) {
  const params = [portId, wsIso, weIso];
  let i = 4;
  let filterSql = '';
  if (filters.purposeCodes) {
    filterSql += ` AND EXISTS (
      SELECT 1 FROM si_purposes sppf
      WHERE sppf.id = sp.purpose_id AND sppf.deleted_at IS NULL
        AND sppf.code = ANY($${i++}::text[])
    )`;
    params.push(filters.purposeCodes);
  }
  if (filters.commodityIds) {
    filterSql += ` AND EXISTS (
      SELECT 1 FROM shipping_instructions sif
      JOIN shipping_instruction_breakdown bf ON bf.shipping_instruction_id = sif.id AND bf.deleted_at IS NULL
      WHERE sif.shipment_plan_id = sp.id
        AND sif.deleted_at IS NULL
        AND bf.commodity_id = ANY($${i++}::int[])
    )`;
    params.push(filters.commodityIds);
  }

  const r = await client.query(
    `SELECT COUNT(*)::int AS c
     FROM shipment_plans sp
     WHERE sp.port_id = $1
       AND sp.deleted_at IS NULL
       AND sp.approval_status = 'Approved'
       AND sp.approved_at IS NOT NULL
       AND sp.approved_at >= $2::timestamptz
       AND sp.approved_at < $3::timestamptz
       ${filterSql}`,
    params
  );
  return Number(r.rows[0]?.c) || 0;
}

async function countSailedPlansInRange(client, portId, wsIso, weIso, filters) {
  const params = [portId, wsIso, weIso];
  let i = 4;
  let filterSql = '';
  if (filters.purposeCodes) {
    filterSql += ` AND EXISTS (
      SELECT 1 FROM shipment_plans spf
      JOIN si_purposes sppf ON sppf.id = spf.purpose_id AND sppf.deleted_at IS NULL
      WHERE spf.id = si.shipment_plan_id
        AND spf.deleted_at IS NULL
        AND sppf.code = ANY($${i++}::text[])
    )`;
    params.push(filters.purposeCodes);
  }
  if (filters.commodityIds) {
    filterSql += ` AND EXISTS (
      SELECT 1 FROM shipping_instructions sif
      JOIN shipping_instruction_breakdown bf ON bf.shipping_instruction_id = sif.id AND bf.deleted_at IS NULL
      WHERE sif.shipment_plan_id = si.shipment_plan_id
        AND sif.deleted_at IS NULL
        AND bf.commodity_id = ANY($${i++}::int[])
    )`;
    params.push(filters.commodityIds);
  }

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
       AND COALESCE(o.cast_off_at, o.actual_completion_time, sp.sailed_at, sp.cast_off_at) < $3::timestamptz
       ${filterSql}`,
    params
  );
  return Number(r.rows[0]?.c) || 0;
}

/** Sum of MT cargo on SIs whose operation sailed within the range (same window rule as countSailedPlansInRange). */
async function sumSailedQtyMtInRange(client, portId, wsIso, weIso, filters) {
  const params = [portId, wsIso, weIso];
  let i = 4;
  let filterSql = '';
  if (filters.purposeCodes) {
    filterSql += ` AND EXISTS (
      SELECT 1 FROM shipment_plans spf
      JOIN si_purposes sppf ON sppf.id = spf.purpose_id AND sppf.deleted_at IS NULL
      WHERE spf.id = si.shipment_plan_id
        AND spf.deleted_at IS NULL
        AND sppf.code = ANY($${i++}::text[])
    )`;
    params.push(filters.purposeCodes);
  }
  if (filters.commodityIds) {
    filterSql += ` AND EXISTS (
      SELECT 1 FROM shipping_instructions sif
      JOIN shipping_instruction_breakdown bf2 ON bf2.shipping_instruction_id = sif.id AND bf2.deleted_at IS NULL
      WHERE sif.shipment_plan_id = si.shipment_plan_id
        AND sif.deleted_at IS NULL
        AND bf2.commodity_id = ANY($${i++}::int[])
    )`;
    params.push(filters.commodityIds);
  }

  const r = await client.query(
    `SELECT COALESCE(SUM(bf.qty), 0)::float AS s
     FROM operations o
     JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
     JOIN shipping_instruction_breakdown bf ON bf.shipping_instruction_id = si.id AND bf.deleted_at IS NULL
     JOIN metric m ON m.id = bf.metric_id AND m.deleted_at IS NULL AND UPPER(m.code) = 'MT'
     LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
     LEFT JOIN jetties j ON j.id = COALESCE(o.jetty_id, sp.jetty_id) AND j.deleted_at IS NULL
     LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id) AND p.deleted_at IS NULL
     WHERE o.deleted_at IS NULL
       AND COALESCE(o.port_id, p.id) = $1
       AND o.status = 'SAILED'
       AND si.shipment_plan_id IS NOT NULL
       AND COALESCE(o.cast_off_at, o.actual_completion_time, sp.sailed_at, sp.cast_off_at) IS NOT NULL
       AND COALESCE(o.cast_off_at, o.actual_completion_time, sp.sailed_at, sp.cast_off_at) >= $2::timestamptz
       AND COALESCE(o.cast_off_at, o.actual_completion_time, sp.sailed_at, sp.cast_off_at) < $3::timestamptz
       ${filterSql}`,
    params
  );
  return Number(r.rows[0]?.s) || 0;
}

async function slaAtRiskAtSnapshot(client, portId, tIso, filters) {
  const params = [portId, tIso];
  let i = 3;
  let filterSql = '';
  if (filters.purposeCodes) {
    filterSql += ` AND EXISTS (
      SELECT 1 FROM shipment_plans spf
      JOIN si_purposes sppf ON sppf.id = spf.purpose_id AND sppf.deleted_at IS NULL
      WHERE spf.id = si.shipment_plan_id
        AND spf.deleted_at IS NULL
        AND sppf.code = ANY($${i++}::text[])
    )`;
    params.push(filters.purposeCodes);
  }
  if (filters.commodityIds) {
    filterSql += ` AND EXISTS (
      SELECT 1 FROM shipping_instructions sif
      JOIN shipping_instruction_breakdown bf ON bf.shipping_instruction_id = sif.id AND bf.deleted_at IS NULL
      WHERE sif.shipment_plan_id = si.shipment_plan_id
        AND sif.deleted_at IS NULL
        AND bf.commodity_id = ANY($${i++}::int[])
    )`;
    params.push(filters.commodityIds);
  }

  const baseWhere = `
     WHERE o.deleted_at IS NULL
       AND COALESCE(o.port_id, p.id) = $1
       AND si.shipment_plan_id IS NOT NULL
       AND o.status NOT IN ('SAILED', 'PENDING', 'ALLOCATED')
       AND COALESCE(sp.estimated_completion_time, o.estimated_completion_time) IS NOT NULL
       AND COALESCE(sp.estimated_completion_time, o.estimated_completion_time) < $2::timestamptz
       AND (
         COALESCE(o.cast_off_at, o.actual_completion_time, sp.cast_off_at, sp.sailed_at) IS NULL
         OR COALESCE(o.cast_off_at, o.actual_completion_time, sp.cast_off_at, sp.sailed_at) > $2::timestamptz
       )
       ${filterSql}`;

  const countR = await client.query(
    `SELECT COUNT(DISTINCT si.shipment_plan_id)::int AS c
     FROM operations o
     JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
     LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
     LEFT JOIN jetties j ON j.id = COALESCE(o.jetty_id, sp.jetty_id) AND j.deleted_at IS NULL
     LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id) AND p.deleted_at IS NULL
     ${baseWhere}`,
    params
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
     ${baseWhere}`,
    params
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

  const filters = parseDashboardFilters(req);

  const client = await pool.connect();
  try {
    const totalSlots = await totalServiceSlots(client, portId);
    const weeks = [];
    for (const ch of chunks) {
      const occupied = await berthOccupiedPlansAt(client, portId, ch.snapshotIso, filters);
      const pct =
        totalSlots > 0 ? Math.min(100, Math.round((occupied / totalSlots) * 1000) / 10) : null;
      const approvedPlans = await countApprovedPlansInRange(client, portId, ch.rangeStartIso, ch.rangeEndExclusiveIso, filters);
      const sailedCount = await countSailedPlansInRange(client, portId, ch.rangeStartIso, ch.rangeEndExclusiveIso, filters);
      const sailedQtyMt = await sumSailedQtyMtInRange(client, portId, ch.rangeStartIso, ch.rangeEndExclusiveIso, filters);
      const sla = await slaAtRiskAtSnapshot(client, portId, ch.snapshotIso, filters);
      weeks.push({
        startDate: ch.startDate,
        endDate: ch.endDate,
        slotOccupancyPct: pct,
        berthOccupiedPlans: occupied,
        approvedPlans,
        sailedCount,
        sailedQtyMt: Math.round(sailedQtyMt),
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
