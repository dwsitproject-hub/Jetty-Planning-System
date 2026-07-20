/**
 * Dashboard V2 — slot-capacity occupancy snapshots and range averages.
 */
import { appendOpPlanFilters, buildDateRangeWindow, parseYmd } from './dashboard-v2-filters.js';

function jettyShortName(name) {
  if (!name) return '—';
  return String(name).replace(/^Jetty\s+/i, '').trim() || '—';
}

function jettyCapacity(cap) {
  const n = Number(cap);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** UTC calendar day YYYY-MM-DD for `now`. */
export function utcTodayYmd(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** Snapshot instant for a calendar day: live `now` when day is today (UTC), else end of UTC day. */
export function snapshotIsoForDay(dayYmd, now = new Date()) {
  if (dayYmd === utcTodayYmd(now)) {
    return now.toISOString();
  }
  const window = buildDateRangeWindow(dayYmd, dayYmd);
  if (!window) return now.toISOString();
  return new Date(new Date(window.rangeEndExclusiveIso).getTime() - 1).toISOString();
}

/** Inclusive UTC calendar days from startIso through endIso. */
export function enumerateUtcDays(startIso, endIso) {
  const start = parseYmd(startIso);
  const end = parseYmd(endIso);
  if (!start || !end || start > end) return [];
  const days = [];
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cur <= endDay) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

async function loadServiceJetties(client, portId) {
  const r = await client.query(
    `SELECT j.id, j.name, j.capacity
     FROM jetties j
     WHERE j.port_id = $1
       AND j.deleted_at IS NULL
       AND COALESCE(j.status, 'Available') <> 'Out of Service'
     ORDER BY j.name ASC, j.id ASC`,
    [portId]
  );
  return r.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    shortName: jettyShortName(row.name),
    capacity: jettyCapacity(row.capacity),
  }));
}

/**
 * Distinct alongside shipment plans per jetty at snapshot, with a representative vessel name.
 * @returns {Promise<Map<number, Array<{ shipmentPlanId: number, vesselName: string }>>>}
 */
async function berthOccupantsByJettyAt(client, portId, tIso, filters) {
  const params = [portId, tIso];
  const { filterSql } = appendOpPlanFilters('', params, 3, filters);

  const r = await client.query(
    `SELECT x.jetty_id,
            MAX(x.vessel_name) AS vessel_name,
            x.shipment_plan_id
     FROM (
       SELECT COALESCE(o.jetty_id, sp.jetty_id) AS jetty_id,
              si.shipment_plan_id,
              COALESCE(NULLIF(TRIM(sp.vessel_name), ''), '—') AS vessel_name
       FROM operations o
       JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
       LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
       LEFT JOIN jetties j ON j.id = COALESCE(o.jetty_id, sp.jetty_id) AND j.deleted_at IS NULL
       LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id) AND p.deleted_at IS NULL
       WHERE o.deleted_at IS NULL
         AND COALESCE(o.port_id, p.id) = $1
         AND COALESCE(o.shifting_out, sp.shifting_out, false) = false
         AND si.shipment_plan_id IS NOT NULL
         AND COALESCE(o.jetty_id, sp.jetty_id) IS NOT NULL
         ${filterSql}
       GROUP BY COALESCE(o.jetty_id, sp.jetty_id), si.shipment_plan_id,
                COALESCE(NULLIF(TRIM(sp.vessel_name), ''), '—')
       HAVING BOOL_OR(
         COALESCE(o.tb, sp.tb, o.docking_start_time, sp.docking_start_time) IS NOT NULL
         AND COALESCE(o.tb, sp.tb, o.docking_start_time, sp.docking_start_time) <= $2::timestamptz
         AND (
           COALESCE(o.cast_off_at, o.actual_completion_time, sp.cast_off_at, sp.sailed_at) IS NULL
           OR COALESCE(o.cast_off_at, o.actual_completion_time, sp.cast_off_at, sp.sailed_at) > $2::timestamptz
         )
       )
     ) x
     GROUP BY x.jetty_id, x.shipment_plan_id
     ORDER BY x.jetty_id ASC, x.shipment_plan_id ASC`,
    params
  );

  const byJetty = new Map();
  for (const row of r.rows) {
    const jettyId = Number(row.jetty_id);
    if (!Number.isFinite(jettyId)) continue;
    const arr = byJetty.get(jettyId) || [];
    arr.push({
      shipmentPlanId: Number(row.shipment_plan_id),
      vesselName: row.vessel_name || '—',
    });
    byJetty.set(jettyId, arr);
  }
  return byJetty;
}

/**
 * @returns {{ usedSlots: number, totalSlots: number, pct: number, overCapacity: boolean, items: Array<{ primary: string }> }}
 */
export async function computeSlotOccupancyAtSnapshot(client, portId, tIso, filters) {
  const jetties = await loadServiceJetties(client, portId);
  const byJetty = await berthOccupantsByJettyAt(client, portId, tIso, filters);

  let totalSlots = 0;
  let usedSlots = 0;
  const items = [];

  for (const j of jetties) {
    const cap = j.capacity;
    const occs = byJetty.get(j.id) || [];
    const used = Math.min(Math.max(0, occs.length), cap);
    totalSlots += cap;
    usedSlots += used;
    for (let i = 0; i < Math.min(cap, occs.length); i++) {
      const slot = `${j.shortName}-${String(i + 1).padStart(2, '0')}`;
      const name = (occs[i]?.vesselName || '').trim() || '—';
      items.push({ primary: `${slot} — ${name}` });
    }
  }

  const pct = totalSlots > 0 ? Math.round((usedSlots / totalSlots) * 100) : 0;
  return {
    usedSlots,
    totalSlots,
    pct,
    overCapacity: usedSlots > totalSlots && totalSlots > 0,
    items,
  };
}

/**
 * Dashboard slot occupancy for selected date range.
 * @returns {Promise<{ mode: 'exact'|'average', usedSlots: number, totalSlots: number, pct: number, dayCount: number, overCapacity: boolean, items: Array<{ primary: string }> }>}
 */
export async function computeDashboardSlotOccupancy(
  client,
  portId,
  startDate,
  endDate,
  filters,
  now = new Date()
) {
  const start = String(startDate || '').trim();
  const end = String(endDate || '').trim();
  if (!start || !end) {
    throw new Error('start_date and end_date are required');
  }

  if (start === end) {
    const result = await computeSlotOccupancyAtSnapshot(
      client,
      portId,
      snapshotIsoForDay(start, now),
      filters
    );
    return {
      mode: 'exact',
      usedSlots: result.usedSlots,
      totalSlots: result.totalSlots,
      pct: result.pct,
      dayCount: 1,
      overCapacity: result.overCapacity,
      items: result.items,
    };
  }

  const days = enumerateUtcDays(start, end);
  if (days.length === 0) {
    throw new Error('Invalid or empty date range');
  }

  let pctSum = 0;
  let usedSum = 0;
  let totalSum = 0;
  for (const day of days) {
    const daily = await computeSlotOccupancyAtSnapshot(
      client,
      portId,
      snapshotIsoForDay(day, now),
      filters
    );
    pctSum += daily.pct;
    usedSum += daily.usedSlots;
    totalSum += daily.totalSlots;
  }
  const dayCount = days.length;
  const avgPct = dayCount > 0 ? Math.round(pctSum / dayCount) : 0;
  const avgUsed = dayCount > 0 ? Math.round(usedSum / dayCount) : 0;
  const avgTotal = dayCount > 0 ? Math.round(totalSum / dayCount) : 0;

  return {
    mode: 'average',
    usedSlots: avgUsed,
    totalSlots: avgTotal,
    pct: avgPct,
    dayCount,
    overCapacity: false,
    items: [],
  };
}
