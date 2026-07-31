/**
 * Dashboard V2 — SLA at risk snapshots and range averages.
 */
import { appendOpPlanFilters } from './dashboard-v2-filters.js';
import { enumerateUtcDays, snapshotIsoForDay } from './dashboard-slot-occupancy.js';

function slaBaseWhere(filterSql) {
  return `
     WHERE o.deleted_at IS NULL
       AND COALESCE(o.port_id, p.id) = $1
       AND si.shipment_plan_id IS NOT NULL
       AND o.status NOT IN ('PENDING', 'ALLOCATED')
       AND COALESCE(sp.estimated_completion_time, o.estimated_completion_time) IS NOT NULL
       AND COALESCE(sp.estimated_completion_time, o.estimated_completion_time) < $2::timestamptz
       AND (
         COALESCE(o.cast_off_at, o.actual_completion_time, sp.cast_off_at, sp.sailed_at) IS NULL
         OR COALESCE(o.cast_off_at, o.actual_completion_time, sp.cast_off_at, sp.sailed_at) > $2::timestamptz
       )
       ${filterSql}`;
}

const SLA_FROM = `
     FROM operations o
     JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
     LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
     LEFT JOIN jetties j ON j.id = COALESCE(o.jetty_id, sp.jetty_id) AND j.deleted_at IS NULL
     LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id) AND p.deleted_at IS NULL`;

/**
 * @returns {{ count: number, overHoursSum: number }}
 */
export async function slaAtRiskAtSnapshot(client, portId, tIso, filters) {
  const params = [portId, tIso];
  const { filterSql } = appendOpPlanFilters('', params, 3, filters);
  const baseWhere = slaBaseWhere(filterSql);

  const countR = await client.query(
    `SELECT COUNT(DISTINCT si.shipment_plan_id)::int AS c
     ${SLA_FROM}
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
     ${SLA_FROM}
     ${baseWhere}`,
    params
  );
  return {
    count: Number(countR.rows[0]?.c) || 0,
    overHoursSum: Number(hoursR.rows[0]?.h) || 0,
  };
}

/**
 * Top at-risk plans at snapshot for KPI tooltip (exact mode only).
 * @returns {Promise<Array<{ primary: string, secondary: string }>>}
 */
async function slaAtRiskItemsAtSnapshot(client, portId, tIso, filters, limit = 5) {
  const params = [portId, tIso];
  const { filterSql } = appendOpPlanFilters('', params, 3, filters);
  const baseWhere = slaBaseWhere(filterSql);

  const r = await client.query(
    `SELECT si.shipment_plan_id,
            MAX(COALESCE(NULLIF(TRIM(sp.vessel_name), ''), '—')) AS vessel_name,
            MAX(COALESCE(NULLIF(TRIM(j.name), ''), '—')) AS jetty_name,
            MAX(
              GREATEST(0,
                EXTRACT(EPOCH FROM (
                  $2::timestamptz - COALESCE(sp.estimated_completion_time, o.estimated_completion_time)
                )) / 3600.0
              )
            )::float AS over_hours
     ${SLA_FROM}
     ${baseWhere}
     GROUP BY si.shipment_plan_id
     ORDER BY MAX(
       GREATEST(0,
         EXTRACT(EPOCH FROM (
           $2::timestamptz - COALESCE(sp.estimated_completion_time, o.estimated_completion_time)
         )) / 3600.0
       )
     ) DESC, si.shipment_plan_id ASC
     LIMIT $3`,
    [...params, limit]
  );

  return r.rows.map((row) => {
    const h = Number(row.over_hours) || 0;
    const overLabel = h < 1 ? `+${Math.max(1, Math.round(h * 60))}m` : `+${h.toFixed(1)}h`;
    const jetty = String(row.jetty_name || '—').replace(/^Jetty\s+/i, '').trim() || '—';
    return {
      primary: row.vessel_name || '—',
      secondary: `${jetty} · ${overLabel} over ETC`,
    };
  });
}

/**
 * In 'exact' mode (single day) items are the at-risk vessels; in 'average' mode
 * (multi-day range) items are a per-day breakdown (primary=date, secondary=count
 * + avg overdue hours) since there's no single vessel list across an averaged range.
 * @returns {Promise<{ mode: 'exact'|'average', count: number, overHoursSum: number, dayCount: number, items: Array<{ primary: string, secondary: string }> }>}
 */
export async function computeDashboardSlaAtRisk(
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
    const tIso = snapshotIsoForDay(start, now);
    const snap = await slaAtRiskAtSnapshot(client, portId, tIso, filters);
    const items = await slaAtRiskItemsAtSnapshot(client, portId, tIso, filters);
    return {
      mode: 'exact',
      count: snap.count,
      overHoursSum: Math.round(snap.overHoursSum * 10) / 10,
      dayCount: 1,
      items,
    };
  }

  const days = enumerateUtcDays(start, end);
  if (days.length === 0) {
    throw new Error('Invalid or empty date range');
  }

  let countSum = 0;
  let hoursSum = 0;
  const items = [];
  for (const day of days) {
    const daily = await slaAtRiskAtSnapshot(
      client,
      portId,
      snapshotIsoForDay(day, now),
      filters
    );
    countSum += daily.count;
    hoursSum += daily.overHoursSum;
    const dailyHours = Math.round(daily.overHoursSum * 10) / 10;
    items.push({ primary: day, secondary: `${daily.count} at risk · ${dailyHours}h avg overdue` });
  }
  const dayCount = days.length;
  const avgCount = dayCount > 0 ? Math.round((countSum / dayCount) * 10) / 10 : 0;
  const avgHours = dayCount > 0 ? Math.round((hoursSum / dayCount) * 10) / 10 : 0;

  return {
    mode: 'average',
    count: avgCount,
    overHoursSum: avgHours,
    dayCount,
    items,
  };
}
