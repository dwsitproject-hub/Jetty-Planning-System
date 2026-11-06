/**
 * Scan operations for ATG sample coverage gaps during cargo segments.
 */
import {
  DEFAULT_LOOKBACK_DAYS,
  DEFAULT_MIN_GAP_MS,
  MAX_LIST_OPERATIONS,
  buildGapKey,
  gapsFromIncompleteHourlyBuckets,
  gapsFromSampleTimeline,
  rollupLineGaps,
  rollupOperationGaps,
} from './atg-cargo-gap-detect.js';
import { partitionLineTanks } from './operational-progress.js';
import { DEFAULT_RECENT_GAP_MS, annotateAcknowledgedGaps, deriveGapCheckStatus } from './atg-cargo-gap-status.js';
import { loadAcknowledgements } from './atg-cargo-gap-store.js';

const CANDIDATE_OPS_SQL = `
  SELECT DISTINCT
         o.id AS operation_id,
         o.status AS op_status,
         o.port_id,
         p.name AS port_name,
         sp.vessel_name,
         si.reference_number,
         sp.cast_off_at,
         sp.sailed_at,
         o.tb
  FROM operations o
  JOIN ports p ON p.id = o.port_id AND p.deleted_at IS NULL
  JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
  LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
  JOIN operation_operational_activities oa
    ON oa.operation_id = o.id AND oa.deleted_at IS NULL AND oa.milestone_key = 'cargo_operations'
  JOIN operation_cargo_load_lines l ON l.operational_activity_id = oa.id
  WHERE o.deleted_at IS NULL
    AND l.started_at IS NOT NULL
    AND l.started_at >= NOW() - ($1::int * INTERVAL '1 day')
    AND COALESCE(l.atg_qty_mode, 'auto') <> 'manual'
  ORDER BY o.id DESC`;

const LINES_FOR_OPS_SQL = `
  SELECT l.id AS load_line_id,
         l.started_at,
         l.ended_at,
         l.atg_qty_mode,
         l.atg_hourly_detail,
         oa.operation_id,
         sc.short_name AS commodity_short_name,
         sc.name AS commodity_name,
         COALESCE(sc.commodity_type, 'Liquid') AS commodity_type,
         COALESCE(
           (SELECT array_agg(clt.tank_id ORDER BY clt.tank_id)
            FROM operation_cargo_load_line_tanks clt
            WHERE clt.load_line_id = l.id),
           ARRAY[]::bigint[]
         ) AS tank_ids
  FROM operation_cargo_load_lines l
  JOIN operation_operational_activities oa ON oa.id = l.operational_activity_id AND oa.deleted_at IS NULL
  LEFT JOIN si_commodities sc ON sc.id = l.commodity_id AND sc.deleted_at IS NULL
  WHERE oa.operation_id = ANY($1::bigint[])
    AND l.started_at IS NOT NULL
    AND l.started_at >= NOW() - ($2::int * INTERVAL '1 day')
  ORDER BY oa.operation_id, l.started_at, l.id`;

const HOURLY_INCOMPLETE_SQL = `
  SELECT load_line_id, hour_start, hour_end, movement_status
  FROM operation_hourly_cargo_progress
  WHERE load_line_id = ANY($1::bigint[])
    AND source IN ('atg', 'hybrid')
    AND movement_status = 'incomplete'`;

const SAMPLES_SQL = `
  SELECT tank_id, sampled_at
  FROM tank_gauging_samples
  WHERE tank_id = ANY($1::bigint[])
    AND sampled_at >= $2::timestamptz
    AND sampled_at <= $3::timestamptz
  ORDER BY tank_id, sampled_at`;

const TANK_CODES_SQL = `
  SELECT t.id AS tank_id, t.code
  FROM master_tanks t
  WHERE t.id = ANY($1::bigint[]) AND t.deleted_at IS NULL`;

/** ATG_GAP_LOOKBACK_DAYS overrides the default 30-day window. */
function resolveLookbackDays() {
  const n = Number(process.env.ATG_GAP_LOOKBACK_DAYS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LOOKBACK_DAYS;
}

/**
 * @param {object} row
 */
function isAtBerth(row) {
  if (row.sailed_at) return false;
  if (row.cast_off_at) return false;
  const st = String(row.op_status || '').toUpperCase();
  if (st === 'SAILED') return false;
  return Boolean(row.tb);
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {number} loadLineId
 * @param {Array} hourlyByLine
 * @param {Array} atgHourlyDetail
 */
function gapsFromLineFastPath(loadLineId, hourlyByLine, atgHourlyDetail) {
  if (Array.isArray(atgHourlyDetail) && atgHourlyDetail.length) {
    const buckets = atgHourlyDetail.map((b) => ({
      hourStart: b.hourStart,
      hourEnd: b.hourEnd,
      movementStatus: b.movementStatus,
    }));
    const gaps = gapsFromIncompleteHourlyBuckets(buckets);
    if (gaps.length) return { gaps, method: 'hourly_snapshot' };
  }
  const rows = (hourlyByLine || []).filter((r) => Number(r.load_line_id) === Number(loadLineId));
  if (rows.length) {
    const gaps = gapsFromIncompleteHourlyBuckets(
      rows.map((r) => ({
        hourStart: r.hour_start,
        hourEnd: r.hour_end,
        movementStatus: r.movement_status,
      }))
    );
    if (gaps.length) return { gaps, method: 'hourly_persisted' };
  }
  return null;
}

/**
 * @param {import('pg').Pool} db
 * @param {object} [opts]
 * @param {number} [opts.lookbackDays]
 * @param {number} [opts.minGapMs]
 * @param {number} [opts.recentWindowMs] at-berth gaps that ended within this window are unhealthy
 * @param {number} [opts.nowMs]
 * @param {number} [opts.operationId] single-op scan for resync
 */
export async function scanAtgCargoGaps(db, opts = {}) {
  const lookbackDays = Number.isFinite(opts.lookbackDays) ? opts.lookbackDays : resolveLookbackDays();
  const minGapMs = Number.isFinite(opts.minGapMs) ? opts.minGapMs : DEFAULT_MIN_GAP_MS;
  const recentWindowMs = Number.isFinite(opts.recentWindowMs) ? opts.recentWindowMs : DEFAULT_RECENT_GAP_MS;
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const nowIso = new Date(nowMs).toISOString();

  let opRows = [];
  if (opts.operationId != null) {
    const single = await db.query(
      `SELECT DISTINCT
              o.id AS operation_id,
              o.status AS op_status,
              o.port_id,
              p.name AS port_name,
              sp.vessel_name,
              si.reference_number,
              sp.cast_off_at,
              sp.sailed_at,
              o.tb
       FROM operations o
       JOIN ports p ON p.id = o.port_id AND p.deleted_at IS NULL
       JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
       LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
       WHERE o.id = $1 AND o.deleted_at IS NULL`,
      [Number(opts.operationId)]
    );
    opRows = single.rows;
  } else {
    const opsR = await db.query(CANDIDATE_OPS_SQL, [lookbackDays]);
    opRows = opsR.rows;
  }

  if (!opRows.length) {
    return {
      lookbackDays,
      minGapMinutes: minGapMs / 60000,
      recentWindowMinutes: recentWindowMs / 60000,
      operations: [],
      totalWithGaps: 0,
      truncated: false,
      severity: deriveGapCheckStatus([], recentWindowMs, nowMs),
    };
  }

  const opIds = opRows.map((r) => Number(r.operation_id));
  const linesR = await db.query(LINES_FOR_OPS_SQL, [opIds, lookbackDays]);
  const lines = linesR.rows;

  const loadLineIds = lines.map((l) => Number(l.load_line_id));
  let hourlyRows = [];
  if (loadLineIds.length) {
    try {
      const h = await db.query(HOURLY_INCOMPLETE_SQL, [loadLineIds]);
      hourlyRows = h.rows;
    } catch {
      hourlyRows = [];
    }
  }

  const linesByOp = new Map();
  for (const line of lines) {
    const opId = Number(line.operation_id);
    if (!linesByOp.has(opId)) linesByOp.set(opId, []);
    linesByOp.get(opId).push(line);
  }

  const operationResults = [];

  for (const op of opRows) {
    const opId = Number(op.operation_id);
    const opLines = linesByOp.get(opId) || [];
    const lineGapInputs = [];

    for (const line of opLines) {
      if (String(line.commodity_type || 'Liquid') === 'Solid') continue;
      if (String(line.atg_qty_mode || 'auto') === 'manual') continue;

      const tankIds = (line.tank_ids || []).map(Number).filter((n) => n > 0);
      const { atgTankIds } = await partitionLineTanks(db, tankIds);
      if (!atgTankIds.length) continue;

      const windowStart = new Date(line.started_at).toISOString();
      const windowEnd = line.ended_at ? new Date(line.ended_at).toISOString() : nowIso;

      let detail = line.atg_hourly_detail;
      if (detail && typeof detail === 'string') {
        try {
          detail = JSON.parse(detail);
        } catch {
          detail = null;
        }
      }

      const fast = gapsFromLineFastPath(line.load_line_id, hourlyRows, detail);
      let gaps = [];
      let detectionMethod = 'samples';

      if (fast?.gaps?.length) {
        gaps = fast.gaps;
        detectionMethod = fast.method;
      } else {
        const samplesR = await db.query(SAMPLES_SQL, [atgTankIds, windowStart, windowEnd]);
        const byTank = new Map();
        for (const s of samplesR.rows) {
          const tid = Number(s.tank_id);
          if (!byTank.has(tid)) byTank.set(tid, []);
          byTank.get(tid).push(new Date(s.sampled_at).toISOString());
        }
        const perTankGaps = [];
        for (const tid of atgTankIds) {
          perTankGaps.push(
            gapsFromSampleTimeline(byTank.get(tid) || [], windowStart, windowEnd, minGapMs)
          );
        }
        gaps = rollupLineGaps(perTankGaps);
        detectionMethod = 'samples';
      }

      if (!gaps.length) continue;

      const codesR = await db.query(TANK_CODES_SQL, [atgTankIds]);
      const tankCodes = codesR.rows.map((r) => r.code).filter(Boolean);

      lineGapInputs.push({
        loadLineId: Number(line.load_line_id),
        commodity: line.commodity_short_name || line.commodity_name || null,
        tankCodes,
        atgTankIds,
        detectionMethod,
        gaps: gaps.map((g) => ({
          ...g,
          gapKey: buildGapKey(line.load_line_id, g.startAt, g.endAt),
        })),
      });
    }

    if (!lineGapInputs.length) continue;

    const rolled = rollupOperationGaps(lineGapInputs);
    const planRef = op.reference_number || null;
    const vesselName = op.vessel_name || '—';

    operationResults.push({
      operationId: opId,
      portId: Number(op.port_id),
      portName: op.port_name,
      planRef,
      vesselName,
      operationLabel: planRef ? `${vesselName} (${planRef})` : vesselName,
      opStatus: op.op_status,
      atBerth: isAtBerth(op),
      longestGapMinutes: rolled.longestGapMinutes,
      totalGapMinutes: rolled.totalGapMinutes,
      segmentCountWithGaps: rolled.segmentCountWithGaps,
      gaps: rolled.gaps,
      unionGaps: rolled.unionGaps,
      lines: lineGapInputs,
    });
  }

  operationResults.sort((a, b) => {
    if (a.atBerth !== b.atBerth) return a.atBerth ? -1 : 1;
    return (b.longestGapMinutes || 0) - (a.longestGapMinutes || 0);
  });

  const ackByGapKey = await loadAcknowledgements(db, operationResults.map((o) => o.operationId));
  const annotated = operationResults.map((o) => annotateAcknowledgedGaps(o, ackByGapKey));
  annotated.sort((x, y) => Number(y.openGapCount > 0) - Number(x.openGapCount > 0));
  const truncated = annotated.length > MAX_LIST_OPERATIONS;
  const listed = truncated ? annotated.slice(0, MAX_LIST_OPERATIONS) : annotated;
  const severity = deriveGapCheckStatus(annotated, recentWindowMs, nowMs);

  return {
    lookbackDays,
    minGapMinutes: minGapMs / 60000,
    recentWindowMinutes: recentWindowMs / 60000,
    operations: listed,
    totalWithGaps: annotated.length,
    truncated,
    severity,
  };
}

/**
 * @param {import('pg').Pool} db
 */
export async function scanOperationGapsForRecovery(db, operationId, opts = {}) {
  return scanAtgCargoGaps(db, { ...opts, operationId: Number(operationId) });
}
