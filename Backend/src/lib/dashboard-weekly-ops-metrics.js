/**
 * Ops Analytics weekly trends — waiting, anchorage, at-berth, flow rate.
 * Snapshot counts use the time window only (current SAILED status is ignored).
 */
import { appendOpPlanFilters, appendPlanFilters, parseYmd } from './dashboard-v2-filters.js';

export const MOVING_AVG_WEEKS = 4;
export const LOOKBACK_DAYS = 21;
const MAX_WAIT_HOURS = 8760;

export function lookbackStartYmd(startYmd, days = LOOKBACK_DAYS) {
  const start = parseYmd(startYmd);
  if (!start) return null;
  const utc = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  utc.setUTCDate(utc.getUTCDate() - days);
  return utc.toISOString().slice(0, 10);
}

/** Mean of the last `window` finite values up to each index (skips nulls). */
export function movingMean(values, window = MOVING_AVG_WEEKS) {
  if (!Array.isArray(values)) return [];
  const w = Number(window) > 0 ? Number(window) : MOVING_AVG_WEEKS;
  return values.map((_, i) => {
    const slice = [];
    for (let j = Math.max(0, i - w + 1); j <= i; j++) {
      const v = values[j];
      if (v != null && Number.isFinite(Number(v))) slice.push(Number(v));
    }
    if (!slice.length) return null;
    return slice.reduce((sum, n) => sum + n, 0) / slice.length;
  });
}

export function round1(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n) * 10) / 10;
}

/** Arrived (TA) and not yet alongside at snapshot T. */
export function isAtAnchorageAtSnapshot({ ta, alongsideAt }, snapshotIso) {
  if (!ta || !snapshotIso) return false;
  const t = new Date(snapshotIso).getTime();
  if (!Number.isFinite(t) || new Date(ta).getTime() > t) return false;
  if (alongsideAt && new Date(alongsideAt).getTime() <= t) return false;
  return true;
}

/**
 * Alongside at snapshot T. Uses the time window only — current status is ignored
 * so vessels that later sailed still count on historical dates.
 */
export function isAtBerthAtSnapshot({ alongsideAt, departedAt }, snapshotIso) {
  if (!alongsideAt || !snapshotIso) return false;
  const t = new Date(snapshotIso).getTime();
  if (!Number.isFinite(t) || new Date(alongsideAt).getTime() > t) return false;
  if (departedAt && new Date(departedAt).getTime() <= t) return false;
  return true;
}

function planPortFrom() {
  return `
     FROM shipment_plans sp
     LEFT JOIN shipping_instructions si ON si.shipment_plan_id = sp.id AND si.deleted_at IS NULL
     LEFT JOIN operations o ON o.shipping_instruction_id = si.id AND o.deleted_at IS NULL
     LEFT JOIN jetties j ON j.id = COALESCE(o.jetty_id, sp.jetty_id) AND j.deleted_at IS NULL
     LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id, sp.port_id) AND p.deleted_at IS NULL`;
}

export async function meanWaitingHoursInRange(client, portId, wsIso, weIso, filters) {
  const params = [portId, wsIso, weIso];
  const { filterSql } = appendPlanFilters('', params, 4, filters);

  const r = await client.query(
    `SELECT AVG(x.wait_h)::float AS m
     FROM (
       SELECT EXTRACT(EPOCH FROM (
                MIN(COALESCE(o.tb, sp.tb)) - MIN(COALESCE(o.ta, sp.ta))
              )) / 3600.0 AS wait_h
       ${planPortFrom()}
       WHERE sp.deleted_at IS NULL
         AND COALESCE(sp.port_id, p.id) = $1
         AND sp.approval_status <> 'Rejected'
         AND COALESCE(sp.shifting_out, false) = false
         ${filterSql}
       GROUP BY sp.id
       HAVING MIN(COALESCE(o.ta, sp.ta)) IS NOT NULL
          AND MIN(COALESCE(o.tb, sp.tb)) IS NOT NULL
          AND MIN(COALESCE(o.tb, sp.tb)) > MIN(COALESCE(o.ta, sp.ta))
          AND MIN(COALESCE(o.tb, sp.tb)) >= $2::timestamptz
          AND MIN(COALESCE(o.tb, sp.tb)) < $3::timestamptz
          AND EXTRACT(EPOCH FROM (
                MIN(COALESCE(o.tb, sp.tb)) - MIN(COALESCE(o.ta, sp.ta))
              )) / 3600.0 <= ${MAX_WAIT_HOURS}
     ) x`,
    params
  );
  const m = Number(r.rows[0]?.m);
  return Number.isFinite(m) ? m : null;
}

export async function countAnchorageAtSnapshot(client, portId, tIso, filters) {
  const params = [portId, tIso];
  const { filterSql } = appendPlanFilters('', params, 3, filters);

  const r = await client.query(
    `SELECT COUNT(*)::int AS c
     FROM (
       SELECT sp.id
       ${planPortFrom()}
       WHERE sp.deleted_at IS NULL
         AND COALESCE(sp.port_id, p.id) = $1
         AND sp.approval_status <> 'Rejected'
         AND COALESCE(sp.shifting_out, o.shifting_out, false) = false
         ${filterSql}
       GROUP BY sp.id
       HAVING BOOL_OR(
            COALESCE(o.ta, sp.ta) IS NOT NULL
            AND COALESCE(o.ta, sp.ta) <= $2::timestamptz
          )
          AND NOT BOOL_OR(
            COALESCE(o.tb, sp.tb, o.docking_start_time, sp.docking_start_time) IS NOT NULL
            AND COALESCE(o.tb, sp.tb, o.docking_start_time, sp.docking_start_time) <= $2::timestamptz
          )
     ) x`,
    params
  );
  return Number(r.rows[0]?.c) || 0;
}

export async function countAtBerthAtSnapshot(client, portId, tIso, filters) {
  const params = [portId, tIso];
  const { filterSql } = appendOpPlanFilters('', params, 3, filters);

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

/**
 * Per-commodity mean of (product MT ÷ voyage cargo-ops hours) for voyages that
 * cast off in [ws, we).
 * @returns {Promise<Array<{ commodityId: number, code: string, mtPerHour: number, qtyMt: number }>>}
 */
export async function flowRatesByCommodityInRange(client, portId, wsIso, weIso, filters) {
  const params = [portId, wsIso, weIso];
  const { filterSql, nextIndex } = appendOpPlanFilters('', params, 4, filters);
  let qtyCommoditySql = '';
  if (filters?.commodityIds?.length) {
    qtyCommoditySql = ` AND bf.commodity_id = ANY($${nextIndex}::int[])`;
    params.push(filters.commodityIds);
  }

  const r = await client.query(
    `WITH plan_ops AS (
       SELECT si.shipment_plan_id,
              MIN(oa.start_at) AS ops_start,
              MAX(COALESCE(oa.end_at, oa.start_at)) AS ops_end,
              MIN(COALESCE(o.cast_off_at, o.actual_completion_time, sp.sailed_at, sp.cast_off_at)) AS cast_off
       FROM operations o
       JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
       LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
       LEFT JOIN jetties j ON j.id = COALESCE(o.jetty_id, sp.jetty_id) AND j.deleted_at IS NULL
       LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id) AND p.deleted_at IS NULL
       JOIN operation_operational_activities oa
         ON oa.operation_id = o.id
        AND oa.deleted_at IS NULL
        AND oa.milestone_key = 'cargo_operations'
        AND oa.start_at IS NOT NULL
       WHERE o.deleted_at IS NULL
         AND COALESCE(o.port_id, p.id) = $1
         AND si.shipment_plan_id IS NOT NULL
         ${filterSql}
       GROUP BY si.shipment_plan_id
       HAVING MIN(COALESCE(o.cast_off_at, o.actual_completion_time, sp.sailed_at, sp.cast_off_at)) IS NOT NULL
          AND MIN(COALESCE(o.cast_off_at, o.actual_completion_time, sp.sailed_at, sp.cast_off_at)) >= $2::timestamptz
          AND MIN(COALESCE(o.cast_off_at, o.actual_completion_time, sp.sailed_at, sp.cast_off_at)) < $3::timestamptz
          AND MAX(COALESCE(oa.end_at, oa.start_at)) > MIN(oa.start_at)
     ),
     plan_qty AS (
       SELECT si.shipment_plan_id,
              bf.commodity_id,
              COALESCE(NULLIF(TRIM(sc.short_name), ''), NULLIF(TRIM(sc.name), ''), '—') AS code,
              SUM(bf.qty)::float AS qty
       FROM shipping_instructions si
       JOIN shipping_instruction_breakdown bf
         ON bf.shipping_instruction_id = si.id AND bf.deleted_at IS NULL
       JOIN metric m ON m.id = bf.metric_id AND m.deleted_at IS NULL AND UPPER(m.code) = 'MT'
       JOIN si_commodities sc ON sc.id = bf.commodity_id AND sc.deleted_at IS NULL
       WHERE si.deleted_at IS NULL
         AND si.shipment_plan_id IN (SELECT shipment_plan_id FROM plan_ops)
         ${qtyCommoditySql}
       GROUP BY si.shipment_plan_id, bf.commodity_id, sc.short_name, sc.name
     )
     SELECT q.commodity_id,
            q.code,
            q.qty,
            EXTRACT(EPOCH FROM (p.ops_end - p.ops_start)) / 3600.0 AS ops_h
     FROM plan_ops p
     JOIN plan_qty q ON q.shipment_plan_id = p.shipment_plan_id`,
    params
  );

  const byCommodity = new Map();
  for (const row of r.rows) {
    const hours = Number(row.ops_h);
    const qty = Number(row.qty);
    const id = Number(row.commodity_id);
    if (!Number.isFinite(hours) || hours <= 0 || !Number.isFinite(qty) || !Number.isFinite(id)) continue;
    const rate = qty / hours;
    if (!Number.isFinite(rate)) continue;
    const cur = byCommodity.get(id) || { commodityId: id, code: row.code || '—', rates: [], qtyMt: 0 };
    cur.rates.push(rate);
    cur.qtyMt += qty;
    if (row.code) cur.code = row.code;
    byCommodity.set(id, cur);
  }

  return [...byCommodity.values()].map((c) => ({
    commodityId: c.commodityId,
    code: c.code,
    mtPerHour: c.rates.reduce((s, n) => s + n, 0) / c.rates.length,
    qtyMt: c.qtyMt,
  }));
}

/**
 * @param {Array<Array<{ commodityId: number, code: string, mtPerHour: number }>>} weeklyRows
 * @returns {Array<Array<{ commodityId: number, code: string, mtPerHourMa: number }>>}
 */
export function applyCommodityMovingMean(weeklyRows, window = MOVING_AVG_WEEKS) {
  const ids = new Map();
  for (const week of weeklyRows || []) {
    for (const row of week || []) {
      if (row?.commodityId != null) ids.set(Number(row.commodityId), row.code || '—');
    }
  }
  const result = (weeklyRows || []).map(() => []);
  for (const [id, code] of ids) {
    const series = (weeklyRows || []).map((week) => {
      const hit = (week || []).find((r) => Number(r.commodityId) === id);
      return hit != null && Number.isFinite(Number(hit.mtPerHour)) ? Number(hit.mtPerHour) : null;
    });
    const ma = movingMean(series, window);
    ma.forEach((v, i) => {
      if (v == null) return;
      const hit = (weeklyRows[i] || []).find((r) => Number(r.commodityId) === id);
      result[i].push({
        commodityId: id,
        code,
        mtPerHourMa: round1(v),
        qtyMt: Number(hit?.qtyMt) || 0,
      });
    });
  }
  return result;
}
