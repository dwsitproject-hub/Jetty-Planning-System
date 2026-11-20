/**
 * Live no-flow check on open cargo entries (ATG tanks only):
 *  - finds since when the tanks have been flat (15-min windows, newest first)
 *  - closes an open stop when ATG shows flow again (close_source = atg_resume)
 *  - alerts the supervisor once a flat run reaches the port minimum and nobody logged a stop
 * Runs after each tank gauging poll; the operator screen reads the same evaluation.
 */
import { DateTime } from 'luxon';
import { computeAtgWindowMassDelta, computeAtgWindowVolumeDelta } from './atg-window-rate.js';
import { readAtgQtyFromResult, resolveFlatThresholds } from './atg-measurement.js';
import { classifyFlatRun } from './no-flow-detect.js';
import { NO_FLOW_NOTIFICATION_EVENT } from './notification-events.js';
import { getPublicAppBaseUrl, triggerNotification } from './notifications.js';
import { overrideTankIdsFromJson, partitionLineTanks } from './operational-progress.js';

export const LIVE_WINDOW_MINUTES = 15;
const MAX_LOOKBACK_HOURS = 12;

async function loadOpenLine(db, operationId) {
  const r = await db.query(
    `SELECT l.id, l.started_at, l.manual_override,
            COALESCE(array_agg(clt.tank_id) FILTER (WHERE clt.tank_id IS NOT NULL), '{}') AS tank_ids,
            COALESCE(string_agg(t.code, ', ' ORDER BY t.code) FILTER (WHERE t.code IS NOT NULL), '') AS tank_codes,
            (SELECT UPPER(m.code) FROM operations o
             JOIN shipping_instruction_breakdown b ON b.shipping_instruction_id = o.shipping_instruction_id AND b.deleted_at IS NULL
             LEFT JOIN metric m ON m.id = b.metric_id
             WHERE o.id = $1 ORDER BY b.line_order, b.id LIMIT 1) AS si_metric
     FROM operation_cargo_load_lines l
     JOIN operation_operational_activities oa ON oa.id = l.operational_activity_id AND oa.deleted_at IS NULL
     LEFT JOIN operation_cargo_load_line_tanks clt ON clt.load_line_id = l.id
     LEFT JOIN master_tanks t ON t.id = clt.tank_id
     WHERE oa.operation_id = $1 AND oa.milestone_key = 'cargo_operations' AND l.ended_at IS NULL
     GROUP BY l.id
     ORDER BY l.started_at DESC LIMIT 1`,
    [operationId]
  );
  return r.rows[0] || null;
}

/**
 * Flow state of the open cargo entry, or null when there is none / no ATG tank on it.
 * @returns {Promise<null|{ lineId: number, tankCodes: string, flowingNow: boolean, flatSince: string|null, flatMinutes: number }>}
 */
export async function evaluateLiveFlow(db, operationId, nowMs = Date.now()) {
  const line = await loadOpenLine(db, operationId);
  if (!line) return null;
  const { atgTankIds } = await partitionLineTanks(
    db,
    (line.tank_ids || []).map(Number),
    overrideTankIdsFromJson(line.manual_override)
  );
  if (!atgTankIds.length) return null;
  const thresholds = resolveFlatThresholds(line.si_metric || 'MT');
  const compute = thresholds.measurementBasis === 'volume' ? computeAtgWindowVolumeDelta : computeAtgWindowMassDelta;
  const lineStartMs = new Date(line.started_at).getTime();
  const floorMs = Math.max(lineStartMs, nowMs - MAX_LOOKBACK_HOURS * 3600000);
  const stepMs = LIVE_WINDOW_MINUTES * 60000;

  const windows = [];
  for (let end = nowMs; end - stepMs >= floorMs; end -= stepMs) {
    const result = await compute(db, {
      tankIds: atgTankIds,
      startAt: new Date(end - stepMs).toISOString(),
      endAt: new Date(end).toISOString(),
    });
    windows.push({ startMs: end - stepMs, endMs: end, qty: result?.ok ? readAtgQtyFromResult(result) : null });
    const run = classifyFlatRun(windows, thresholds.flatRateThresholdTph);
    if (!run.known || run.flowingNow) break;
    const last = windows[windows.length - 1];
    if (last.qty != null && Math.abs(last.qty) / (stepMs / 3600000) >= thresholds.flatRateThresholdTph) break;
  }
  const run = classifyFlatRun(windows, thresholds.flatRateThresholdTph);
  if (!run.known) return null;
  return {
    lineId: Number(line.id),
    tankCodes: line.tank_codes,
    flowingNow: run.flowingNow,
    flatSince: run.flatSinceMs != null ? new Date(run.flatSinceMs).toISOString() : null,
    flatMinutes: run.flatSinceMs != null ? Math.round((nowMs - run.flatSinceMs) / 60000) : 0,
  };
}

async function loadVoyageInfo(db, operationId) {
  const r = await db.query(
    `SELECT COALESCE(o.port_id, j.port_id) AS port_id, p.no_flow_min_minutes, p.schedule_timezone,
            COALESCE(NULLIF(TRIM(sp.vessel_name), ''), 'Vessel') AS vessel_name,
            COALESCE(NULLIF(TRIM(j.name), ''), '—') AS jetty_name,
            (SELECT id FROM operation_no_flow_events e
             WHERE e.operation_id = o.id AND e.ended_at IS NULL AND e.deleted_at IS NULL) AS open_stop_id,
            (SELECT started_at FROM operation_no_flow_events e
             WHERE e.operation_id = o.id AND e.ended_at IS NULL AND e.deleted_at IS NULL) AS open_stop_started_at
     FROM operations o
     LEFT JOIN jetties j ON j.id = o.jetty_id
     JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id)
     LEFT JOIN shipping_instructions si ON si.id = o.shipping_instruction_id
     LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id
     WHERE o.id = $1`,
    [operationId]
  );
  return r.rows[0] || null;
}

/** Operator nudge: flat run long enough and no stop open yet. */
export async function loadLiveNudge(db, operationId, nowMs = Date.now()) {
  const info = await loadVoyageInfo(db, operationId);
  if (!info || info.open_stop_id) return null;
  const live = await evaluateLiveFlow(db, operationId, nowMs);
  if (!live?.flatSince || live.flatMinutes < Number(info.no_flow_min_minutes)) return null;
  return { flatSince: live.flatSince, minutes: live.flatMinutes, tankCodes: live.tankCodes };
}

/** One voyage: close an open stop when flow is back, alert when flat with no stop logged. */
export async function checkVoyageLiveFlow(db, operationId, nowMs = Date.now()) {
  const info = await loadVoyageInfo(db, operationId);
  if (!info) return { action: 'none' };
  const live = await evaluateLiveFlow(db, operationId, nowMs);
  if (!live) return { action: 'none' };

  if (info.open_stop_id && live.flowingNow) {
    const endedMs = Math.max(new Date(info.open_stop_started_at).getTime() + 60000, nowMs - LIVE_WINDOW_MINUTES * 60000);
    await db.query(
      `UPDATE operation_no_flow_events SET ended_at = $1, close_source = 'atg_resume', updated_at = NOW()
       WHERE id = $2 AND ended_at IS NULL`,
      [new Date(endedMs).toISOString(), info.open_stop_id]
    );
    return { action: 'closed', stopId: Number(info.open_stop_id) };
  }

  if (!info.open_stop_id && live.flatSince && live.flatMinutes >= Number(info.no_flow_min_minutes)) {
    const zone = info.schedule_timezone || 'Asia/Jakarta';
    const result = await triggerNotification(db, {
      eventKey: NO_FLOW_NOTIFICATION_EVENT,
      correlationId: `no_flow:${operationId}:${live.flatSince}`,
      portId: Number(info.port_id),
      payloadVars: {
        vesselName: info.vessel_name,
        jettyName: info.jetty_name,
        tankCodes: live.tankCodes || '—',
        minutes: live.flatMinutes,
        flatSinceFormatted: DateTime.fromISO(live.flatSince).setZone(zone).toFormat('dd/LL HH:mm'),
        primaryHref: `${getPublicAppBaseUrl()}/operator/execution/${operationId}`,
      },
    });
    return { action: 'alerted', sent: result.sent || 0 };
  }
  return { action: 'none' };
}

/** All voyages with an open cargo entry. */
export async function runNoFlowLiveCheck(db, nowMs = Date.now()) {
  const r = await db.query(
    `SELECT DISTINCT oa.operation_id
     FROM operation_cargo_load_lines l
     JOIN operation_operational_activities oa ON oa.id = l.operational_activity_id AND oa.deleted_at IS NULL
     JOIN operations o ON o.id = oa.operation_id AND o.deleted_at IS NULL
     WHERE oa.milestone_key = 'cargo_operations' AND l.ended_at IS NULL`
  );
  const summary = { checked: 0, closed: 0, alerted: 0 };
  for (const row of r.rows) {
    try {
      const res = await checkVoyageLiveFlow(db, Number(row.operation_id), nowMs);
      summary.checked += 1;
      if (res.action === 'closed') summary.closed += 1;
      if (res.action === 'alerted') summary.alerted += 1;
    } catch (e) {
      console.error('[no-flow-live] check failed', { operationId: row.operation_id, err: e?.message || e });
    }
  }
  return summary;
}
