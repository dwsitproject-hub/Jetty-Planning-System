/**
 * Dashboard V2 — weekly aggregates and pipeline actuals for the selected date range.
 */
import express from 'express';
import { pool } from '../db.js';
import {
  appendOpPlanFilters,
  appendPlanFilters,
  buildDateRangeWindow,
  buildWeekChunks,
  parseDashboardFilters,
} from '../lib/dashboard-v2-filters.js';
import { computePipelineActuals } from '../lib/dashboard-pipeline-actuals.js';
import { computeDashboardSlotOccupancy, computeSlotOccupancyAtSnapshot } from '../lib/dashboard-slot-occupancy.js';
import { computeDashboardSlaAtRisk, slaAtRiskAtSnapshot } from '../lib/dashboard-sla-at-risk.js';
import { computeAtgSyncHealth } from '../lib/dashboard-atg-sync-health.js';
import {
  applyCommodityMovingMean,
  countAnchorageAtSnapshot,
  countAtBerthAtSnapshot,
  flowRatesByCommodityInRange,
  lookbackStartYmd,
  meanWaitingHoursInRange,
  movingMean,
  round1,
} from '../lib/dashboard-weekly-ops-metrics.js';

const router = express.Router();

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

async function countApprovedPlansInRange(client, portId, wsIso, weIso, filters) {
  const params = [portId, wsIso, weIso];
  const { filterSql } = appendPlanFilters('', params, 4, filters);

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
  const { filterSql } = appendOpPlanFilters('', params, 4, filters);

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

router.get('/weekly-trends', async (req, res) => {
  const portId = Number(req.selectedPortId);
  if (!Number.isFinite(portId)) {
    return res.status(400).json({ error: 'Port scope required' });
  }
  const { start_date: startDate, end_date: endDate } = req.query;
  if (!startDate || !endDate || typeof startDate !== 'string' || typeof endDate !== 'string') {
    return res.status(400).json({ error: 'start_date and end_date are required (YYYY-MM-DD)' });
  }
  const rangeStart = startDate.trim();
  const rangeEnd = endDate.trim();
  const visibleChunks = buildWeekChunks(rangeStart, rangeEnd);
  if (visibleChunks.length === 0) {
    return res.status(400).json({ error: 'Invalid or empty date range' });
  }
  const lookbackStart = lookbackStartYmd(rangeStart) || rangeStart;
  const allChunks = buildWeekChunks(lookbackStart, rangeEnd);
  const visibleKeys = new Set(visibleChunks.map((ch) => `${ch.startDate}|${ch.endDate}`));

  const filters = parseDashboardFilters(req);

  const client = await pool.connect();
  try {
    const totalSlots = await totalServiceSlots(client, portId);
    const waitingRaw = [];
    const flowRaw = [];
    for (const ch of allChunks) {
      waitingRaw.push(await meanWaitingHoursInRange(
        client, portId, ch.rangeStartIso, ch.rangeEndExclusiveIso, filters
      ));
      flowRaw.push(await flowRatesByCommodityInRange(
        client, portId, ch.rangeStartIso, ch.rangeEndExclusiveIso, filters
      ));
    }
    const waitingMa = movingMean(waitingRaw);
    const flowMa = applyCommodityMovingMean(flowRaw);

    const weeks = [];
    for (let i = 0; i < allChunks.length; i++) {
      const ch = allChunks[i];
      if (!visibleKeys.has(`${ch.startDate}|${ch.endDate}`)) continue;
      // Same historical snapshot as the slot-occupancy KPI. Do not use current
      // `operations.status` — vessels that later sailed must still count at T.
      const occ = await computeSlotOccupancyAtSnapshot(client, portId, ch.snapshotIso, filters);
      const approvedPlans = await countApprovedPlansInRange(client, portId, ch.rangeStartIso, ch.rangeEndExclusiveIso, filters);
      const sailedCount = await countSailedPlansInRange(client, portId, ch.rangeStartIso, ch.rangeEndExclusiveIso, filters);
      const sailedQtyMt = await sumSailedQtyMtInRange(client, portId, ch.rangeStartIso, ch.rangeEndExclusiveIso, filters);
      const sla = await slaAtRiskAtSnapshot(client, portId, ch.snapshotIso, filters);
      const anchorageCount = await countAnchorageAtSnapshot(client, portId, ch.snapshotIso, filters);
      const atBerthCount = await countAtBerthAtSnapshot(client, portId, ch.snapshotIso, filters);
      weeks.push({
        startDate: ch.startDate,
        endDate: ch.endDate,
        slotOccupancyPct: occ.totalSlots > 0 ? occ.pct : null,
        berthOccupiedPlans: occ.usedSlots,
        approvedPlans,
        sailedCount,
        sailedQtyMt: Math.round(sailedQtyMt),
        slaAtRiskCount: sla.count,
        slaOverHoursSum: Math.round(sla.overHoursSum * 10) / 10,
        waitingHoursMa: round1(waitingMa[i]),
        anchorageCount,
        atBerthCount,
        flowRateByCommodity: flowMa[i] || [],
      });
    }
    res.json({ totalSlots, weeks });
  } finally {
    client.release();
  }
});

router.get('/pipeline-actuals', async (req, res) => {
  const portId = Number(req.selectedPortId);
  if (!Number.isFinite(portId)) {
    return res.status(400).json({ error: 'Port scope required' });
  }
  const { start_date: startDate, end_date: endDate } = req.query;
  if (!startDate || !endDate || typeof startDate !== 'string' || typeof endDate !== 'string') {
    return res.status(400).json({ error: 'start_date and end_date are required (YYYY-MM-DD)' });
  }
  const window = buildDateRangeWindow(startDate.trim(), endDate.trim());
  if (!window) {
    return res.status(400).json({ error: 'Invalid or empty date range' });
  }

  const filters = parseDashboardFilters(req);
  const client = await pool.connect();
  try {
    const counts = await computePipelineActuals(
      client,
      portId,
      window.rangeStartIso,
      window.rangeEndExclusiveIso,
      filters
    );
    res.json(counts);
  } finally {
    client.release();
  }
});

router.get('/slot-occupancy', async (req, res) => {
  const portId = Number(req.selectedPortId);
  if (!Number.isFinite(portId)) {
    return res.status(400).json({ error: 'Port scope required' });
  }
  const { start_date: startDate, end_date: endDate } = req.query;
  if (!startDate || !endDate || typeof startDate !== 'string' || typeof endDate !== 'string') {
    return res.status(400).json({ error: 'start_date and end_date are required (YYYY-MM-DD)' });
  }

  const filters = parseDashboardFilters(req);
  const client = await pool.connect();
  try {
    const result = await computeDashboardSlotOccupancy(
      client,
      portId,
      startDate.trim(),
      endDate.trim(),
      filters
    );
    res.json(result);
  } catch (e) {
    const msg = e?.message || 'Invalid date range';
    return res.status(400).json({ error: msg });
  } finally {
    client.release();
  }
});

router.get('/atg-sync-health', async (req, res) => {
  const portId = Number(req.selectedPortId);
  if (!Number.isFinite(portId)) {
    return res.status(400).json({ error: 'Port scope required' });
  }

  const client = await pool.connect();
  try {
    const result = await computeAtgSyncHealth(client, portId);
    res.json(result);
  } finally {
    client.release();
  }
});

router.get('/sla-at-risk', async (req, res) => {
  const portId = Number(req.selectedPortId);
  if (!Number.isFinite(portId)) {
    return res.status(400).json({ error: 'Port scope required' });
  }
  const { start_date: startDate, end_date: endDate } = req.query;
  if (!startDate || !endDate || typeof startDate !== 'string' || typeof endDate !== 'string') {
    return res.status(400).json({ error: 'start_date and end_date are required (YYYY-MM-DD)' });
  }

  const filters = parseDashboardFilters(req);
  const client = await pool.connect();
  try {
    const result = await computeDashboardSlaAtRisk(
      client,
      portId,
      startDate.trim(),
      endDate.trim(),
      filters
    );
    res.json(result);
  } catch (e) {
    const msg = e?.message || 'Invalid date range';
    return res.status(400).json({ error: msg });
  } finally {
    client.release();
  }
});

export default router;
