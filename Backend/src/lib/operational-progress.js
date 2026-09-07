/**
 * Hybrid operational progress: ATG daily aggregates + manual proportional by operational day.
 */

import { computeAtgWindowMassDelta, computeAtgWindowVolumeDelta } from './atg-window-rate.js';
import { getHourlyOperationalProgress, aggregateHourlyProgressForOperation, computeDirectionalMovedQtyForWindow } from './atg-hourly-progress.js';
import {
  readAtgQtyFromResult,
  resolveAtgMeasurementBasis,
  resolveFlatThresholds,
} from './atg-measurement.js';
import { attachScheduleComparisonToSummary, evaluateCargoScheduleComparison } from './cargo-schedule-progress.js';
import {
  currentOperationalDateKey,
  DEFAULT_OPERATIONAL_DAY_START,
  formatOperationalDateLabel,
  listOperationalDateKeysInRange,
  operationalDayBounds,
  parseOperationalDayStart,
} from './operational-day.js';

/**
 * Pick moved qty for overview surfaces: hourly ATG only while a cargo segment is still open.
 * Closed segments use saved line qty / cargo summary so incomplete hourly persistence cannot under-report.
 * @param {Awaited<ReturnType<typeof summarizeCargoProgressContext>>|null|undefined} cargoSummary
 * @param {{ movedQty?: number|null, completionPercent?: number|null }|null|undefined} hourlyProgress
 * @param {number} [fallbackQty]
 */
export function resolveCanonicalMovedQty(cargoSummary, hourlyProgress, fallbackQty = 0) {
  const summaryMoved = cargoSummary?.movedQty ?? fallbackQty;
  const useHourly = Boolean(cargoSummary?.hasActiveCargo) && hourlyProgress?.movedQty != null;
  if (useHourly) return Number(hourlyProgress.movedQty) || 0;
  return Number(summaryMoved) || 0;
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {number|string} tankId
 */
export async function tankHasAtg(db, tankId) {
  const id = Number(tankId);
  if (!Number.isFinite(id) || id <= 0) return false;
  const r = await db.query(
    `SELECT 1
     FROM tank_gauging_tank_map m
     JOIN tank_gauging_sources s
       ON s.port_id = m.port_id
      AND s.base_url = m.source_base_url
      AND s.enabled = TRUE
     WHERE m.tank_id = $1
     LIMIT 1`,
    [id]
  );
  return r.rows.length > 0;
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {Array<number|string>} tankIds
 */
export async function partitionLineTanks(db, tankIds) {
  const atgTankIds = [];
  const manualTankIds = [];
  for (const raw of tankIds || []) {
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (await tankHasAtg(db, id)) atgTankIds.push(id);
    else manualTankIds.push(id);
  }
  return { atgTankIds, manualTankIds };
}

/**
 * @param {object} opts
 */
export function resolveLineMode({ commodityType, atgTankIds, manualTankIds, atgQtyMode }) {
  if (atgQtyMode === 'manual' || commodityType === 'Solid') return 'manual';
  if (!atgTankIds?.length && manualTankIds?.length) return 'manual';
  if (atgTankIds?.length && !manualTankIds?.length) return 'atg';
  if (atgTankIds?.length && manualTankIds?.length) return 'mixed';
  return 'manual';
}

/**
 * @param {Array<{ date: string, qtyMoved: number, atgQty?: number, manualQty?: number }>} arrays
 */
export function mergeDailyBars(...arrays) {
  const byDate = new Map();
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const row of arr) {
      const date = row?.date;
      if (!date) continue;
      const prev = byDate.get(date) || { date, qtyMoved: 0, atgQty: 0, manualQty: 0 };
      prev.qtyMoved += Number(row.qtyMoved) || 0;
      prev.atgQty += Number(row.atgQty) || 0;
      prev.manualQty += Number(row.manualQty) || 0;
      byDate.set(date, prev);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * @param {Array<{ date: string, qtyMoved: number }>} dailyBars
 */
export function buildCumulativeSeriesFromDailyBars(dailyBars) {
  let cumulative = 0;
  return (dailyBars || []).map((b) => {
    cumulative += Number(b.qtyMoved) || 0;
    return { date: b.date, cumulativeQty: cumulative };
  });
}

function formatQtyNumber(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-US');
}

function formatRateNumber(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {object} params
 * @param {'mass'|'volume'} params.measurementBasis
 */
async function computeAtgWindowDeltaForBasis(db, params) {
  if (params.measurementBasis === 'volume') {
    return computeAtgWindowVolumeDelta(db, params);
  }
  return computeAtgWindowMassDelta(db, params);
}

/**
 * @param {object} line
 * @param {string} timezone
 * @param {string} dayStartTime
 */
export function buildManualDailyBarsForLine(line, timezone, dayStartTime) {
  const qty = Number(line.manualQty ?? line.qty) || 0;
  if (qty <= 0) return [];

  const startIso = line.startedAt || line.startAt;
  const endIso = line.endedAt || line.endAt || new Date().toISOString();
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

  const durationMs = endMs - startMs;
  const dateKeys = listOperationalDateKeysInRange(startIso, endIso, timezone, dayStartTime);
  const bars = [];

  for (const dateKey of dateKeys) {
    const bounds = operationalDayBounds(dateKey, timezone, dayStartTime);
    if (!bounds) continue;
    const segStartMs = Math.max(startMs, bounds.start.toMillis());
    const segEndMs = Math.min(endMs, bounds.end.toMillis());
    if (segEndMs <= segStartMs) continue;
    const portion = (qty * (segEndMs - segStartMs)) / durationMs;
    if (portion <= 0) continue;
    bars.push({ date: dateKey, qtyMoved: portion, atgQty: 0, manualQty: portion });
  }
  return bars;
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 */
async function upsertDailyProgressRow(db, row) {
  await db.query(
    `INSERT INTO operation_daily_cargo_progress (
       operation_id, load_line_id, progress_date, qty_moved, source, tank_detail, sample_window, computed_at
     )
     VALUES ($1, $2, $3::date, $4, $5, $6::jsonb,
       CASE WHEN $7::timestamptz IS NOT NULL AND $8::timestamptz IS NOT NULL
         THEN tstzrange($7::timestamptz, $8::timestamptz, '[]')
         ELSE NULL
       END,
       NOW())
     ON CONFLICT (operation_id, load_line_id, progress_date)
     DO UPDATE SET
       qty_moved = EXCLUDED.qty_moved,
       source = EXCLUDED.source,
       tank_detail = EXCLUDED.tank_detail,
       sample_window = EXCLUDED.sample_window,
       computed_at = NOW()`,
    [
      row.operationId,
      row.loadLineId,
      row.progressDate,
      row.qtyMoved,
      row.source,
      row.tankDetail ? JSON.stringify(row.tankDetail) : null,
      row.windowStart,
      row.windowEnd,
    ]
  );
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {object} line
 * @param {Array<number>} atgTankIds
 * @param {string} timezone
 * @param {string} dayStartTime
 * @param {object} [opts]
 */
export async function computeAtgDailyBarsForLine(db, line, atgTankIds, timezone, dayStartTime, opts = {}) {
  if (!atgTankIds?.length) return { bars: [], atgStatus: 'unavailable', atgError: 'no_tanks' };

  const measurementBasis = opts.measurementBasis || 'mass';

  const startIso = line.startedAt || line.startAt;
  const endIso = line.endedAt || line.endAt || new Date().toISOString();
  if (!startIso) return { bars: [], atgStatus: 'unavailable', atgError: 'no_start' };

  const todayKey = currentOperationalDateKey(Date.now(), timezone, dayStartTime);
  const dateKeys = listOperationalDateKeysInRange(startIso, endIso, timezone, dayStartTime);
  const bars = [];
  let okDays = 0;
  let failDays = 0;
  let lastError = null;

  for (const dateKey of dateKeys) {
    const bounds = operationalDayBounds(dateKey, timezone, dayStartTime);
    if (!bounds) continue;

    const lineStartMs = new Date(startIso).getTime();
    const lineEndMs = new Date(endIso).getTime();
    const windowStartMs = Math.max(lineStartMs, bounds.start.toMillis());
    const windowEndMs = Math.min(lineEndMs, bounds.end.toMillis());
    if (windowEndMs <= windowStartMs) continue;

    const windowStart = new Date(windowStartMs).toISOString();
    const windowEnd = new Date(windowEndMs).toISOString();

    const result = await computeAtgWindowDeltaForBasis(db, {
      tankIds: atgTankIds,
      startAt: windowStart,
      endAt: windowEnd,
      measurementBasis,
    });

    const atgQty = readAtgQtyFromResult(result);
    if (result.ok && !result.incomplete && atgQty != null) {
      const qtyMoved = Number(atgQty) || 0;
      okDays += 1;
      bars.push({ date: dateKey, qtyMoved, atgQty: qtyMoved, manualQty: 0 });

      const shouldPersist = opts.persist && opts.operationId && line.id && dateKey !== todayKey;
      if (shouldPersist) {
        await upsertDailyProgressRow(db, {
          operationId: opts.operationId,
          loadLineId: line.id,
          progressDate: dateKey,
          qtyMoved,
          source: 'atg',
          tankDetail: {
            sumAtgQty: atgQty,
            sumDeltaMass: result.sumDeltaMass ?? null,
            sumDeltaVolumeKl: result.sumDeltaVolumeKl ?? null,
            measurementBasis,
            tanks: result.tanks,
          },
          windowStart,
          windowEnd,
        });
      }
    } else {
      failDays += 1;
      lastError = result.error || 'incomplete';
    }
  }

  let atgStatus = 'ok';
  if (okDays === 0 && failDays > 0) atgStatus = 'unavailable';
  else if (failDays > 0) atgStatus = 'partial';

  return { bars, atgStatus, atgError: lastError };
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {number} operationId
 * @param {object} [opts]
 */
export async function aggregateAtgDailyProgressForOperation(db, operationId, opts = {}) {
  const ctx = await loadOperationProgressContext(db, operationId);
  if (!ctx) return { ok: false, error: 'not_found' };

  const todayKey = currentOperationalDateKey(Date.now(), ctx.timezone, ctx.dayStartTime);
  let upserted = 0;

  for (const line of ctx.lines) {
    if (line.atgQtyMode === 'manual') continue;
    const { atgTankIds } = await partitionLineTanks(db, line.tankIds);
    if (!atgTankIds.length) continue;

    const dateKeys = listOperationalDateKeysInRange(
      line.startedAt,
      line.endedAt || new Date().toISOString(),
      ctx.timezone,
      ctx.dayStartTime
    );

    for (const dateKey of dateKeys) {
      if (dateKey >= todayKey && !opts.includeToday) continue;
      if (opts.throughDate && dateKey > opts.throughDate) continue;

      const bounds = operationalDayBounds(dateKey, ctx.timezone, ctx.dayStartTime);
      if (!bounds) continue;
      const lineStartMs = new Date(line.startedAt).getTime();
      const lineEndMs = new Date(line.endedAt || Date.now()).getTime();
      const windowStartMs = Math.max(lineStartMs, bounds.start.toMillis());
      const windowEndMs = Math.min(lineEndMs, bounds.end.toMillis());
      if (windowEndMs <= windowStartMs) continue;

      const result = await computeAtgWindowDeltaForBasis(db, {
        tankIds: atgTankIds,
        startAt: new Date(windowStartMs).toISOString(),
        endAt: new Date(windowEndMs).toISOString(),
        measurementBasis: ctx.measurementBasis || resolveAtgMeasurementBasis(ctx.siMetric),
      });

      const atgQty = readAtgQtyFromResult(result);
      if (result.ok && !result.incomplete && atgQty != null) {
        await upsertDailyProgressRow(db, {
          operationId,
          loadLineId: line.id,
          progressDate: dateKey,
          qtyMoved: Number(atgQty) || 0,
          source: 'atg',
          tankDetail: {
            sumAtgQty: atgQty,
            sumDeltaMass: result.sumDeltaMass ?? null,
            sumDeltaVolumeKl: result.sumDeltaVolumeKl ?? null,
            measurementBasis: ctx.measurementBasis,
            tanks: result.tanks,
          },
          windowStart: new Date(windowStartMs).toISOString(),
          windowEnd: new Date(windowEndMs).toISOString(),
        });
        upserted += 1;
      }
    }
  }

  return { ok: true, upserted };
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {number} operationId
 */
export async function loadOperationProgressContext(db, operationId) {
  const opR = await db.query(
    `SELECT o.id, o.port_id, o.purpose,
            p.schedule_timezone, p.operational_day_start,
            o.tb, o.docking_start_time,
            COALESCE(sp.estimated_completion_time, o.estimated_completion_time) AS estimated_completion_time,
            opening_agg.start_at AS opening_hatch_start_at,
            COALESCE(
              (SELECT sc.commodity_type
               FROM public.shipping_instruction_breakdown b
               JOIN public.si_commodities sc ON sc.id = b.commodity_id AND sc.deleted_at IS NULL
               WHERE b.shipping_instruction_id = si.id AND b.deleted_at IS NULL
               ORDER BY b.line_order, b.id
               LIMIT 1),
              'Liquid'
            ) AS commodity_type
     FROM operations o
     JOIN ports p ON p.id = o.port_id AND p.deleted_at IS NULL
     JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
     LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
     LEFT JOIN LATERAL (
       SELECT MIN(oa.start_at) AS start_at
       FROM operation_operational_activities oa
       WHERE oa.operation_id = o.id
         AND oa.deleted_at IS NULL
         AND oa.entry_type = 'activity'
         AND oa.milestone_key = 'opening_hatch'
         AND oa.start_at IS NOT NULL
     ) opening_agg ON true
     WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [operationId]
  );
  if (!opR.rows[0]) return null;

  const row = opR.rows[0];
  const dayStartTime = parseOperationalDayStart(row.operational_day_start).formatted;

  const linesR = await db.query(
    `SELECT l.id, l.qty, l.manual_qty, l.atg_qty_mode, l.started_at, l.ended_at,
            l.atg_hourly_detail,
            COALESCE(
              (SELECT array_agg(clt.tank_id ORDER BY clt.tank_id)
               FROM operation_cargo_load_line_tanks clt
               WHERE clt.load_line_id = l.id),
              ARRAY[]::bigint[]
            ) AS tank_ids
     FROM operation_cargo_load_lines l
     JOIN operation_operational_activities oa ON oa.id = l.operational_activity_id
     WHERE oa.operation_id = $1
       AND oa.deleted_at IS NULL
       AND oa.milestone_key = 'cargo_operations'
     ORDER BY l.started_at ASC, l.id ASC`,
    [operationId]
  );

  const lines = linesR.rows.map((l) => ({
    id: Number(l.id),
    qty: l.qty != null ? Number(l.qty) : null,
    manualQty: l.manual_qty != null ? Number(l.manual_qty) : null,
    atgQtyMode: l.atg_qty_mode || 'auto',
    startedAt: l.started_at ? new Date(l.started_at).toISOString() : null,
    endedAt: l.ended_at ? new Date(l.ended_at).toISOString() : null,
    atgHourlyDetail: Array.isArray(l.atg_hourly_detail) ? l.atg_hourly_detail : null,
    tankIds: (l.tank_ids || []).map(Number).filter((n) => n > 0),
  }));

  const siR = await db.query(
    `SELECT tot.s AS qty, mc.code AS metric_code
     FROM operations o
     JOIN shipping_instructions si ON o.shipping_instruction_id = si.id AND si.deleted_at IS NULL
     LEFT JOIN LATERAL (
       SELECT SUM(b.qty::numeric) AS s
       FROM shipping_instruction_breakdown b
       WHERE b.shipping_instruction_id = si.id AND b.deleted_at IS NULL
     ) tot ON true
     LEFT JOIN LATERAL (
       SELECT m.code
       FROM shipping_instruction_breakdown b
       LEFT JOIN metric m ON m.id = b.metric_id AND m.deleted_at IS NULL
       WHERE b.shipping_instruction_id = si.id AND b.deleted_at IS NULL
       ORDER BY b.line_order, b.id
       LIMIT 1
     ) mc ON true
     WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [operationId]
  );
  const siQty = siR.rows[0]?.qty != null ? Number(siR.rows[0].qty) : null;
  const siMetric = siR.rows[0]?.metric_code || 'MT';
  const thresholdConfig = resolveFlatThresholds(siMetric);
  const measurementBasis = thresholdConfig.measurementBasis;

  return {
    operationId,
    timezone: row.schedule_timezone || 'Asia/Jakarta',
    dayStartTime,
    commodityType: row.commodity_type === 'Solid' ? 'Solid' : 'Liquid',
    purpose: row.purpose === 'Unloading' ? 'Unloading' : 'Loading',
    flatRateThresholdTph: thresholdConfig.flatRateThresholdTph,
    minQtyMovedT: thresholdConfig.minQtyMovedT,
    measurementBasis,
    lines,
    siQty,
    siMetric,
    openingHatchStartAt: row.opening_hatch_start_at
      ? new Date(row.opening_hatch_start_at).toISOString()
      : null,
    tbAt: row.tb ? new Date(row.tb).toISOString() : null,
    dockingStartTime: row.docking_start_time
      ? new Date(row.docking_start_time).toISOString()
      : null,
    etcAt: row.estimated_completion_time
      ? new Date(row.estimated_completion_time).toISOString()
      : null,
  };
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {number} operationId
 */
export async function getOperationalProgress(db, operationId) {
  const ctx = await loadOperationProgressContext(db, operationId);
  if (!ctx) return null;

  const todayKey = currentOperationalDateKey(Date.now(), ctx.timezone, ctx.dayStartTime);

  const persistedR = await db.query(
    `SELECT progress_date, load_line_id, qty_moved, source
     FROM operation_daily_cargo_progress
     WHERE operation_id = $1`,
    [operationId]
  );

  const persistedByLineDate = new Map();
  for (const r of persistedR.rows) {
    const key = `${Number(r.load_line_id)}|${String(r.progress_date).slice(0, 10)}`;
    persistedByLineDate.set(key, Number(r.qty_moved) || 0);
  }

  const allBars = [];
  const lineMeta = [];
  const warnings = [];
  let hasAtg = false;
  let hasManual = false;

  for (const line of ctx.lines) {
    if (!line.startedAt) continue;

    const { atgTankIds, manualTankIds } = await partitionLineTanks(db, line.tankIds);
    const mode = resolveLineMode({
      commodityType: ctx.commodityType,
      atgTankIds,
      manualTankIds,
      atgQtyMode: line.atgQtyMode,
    });

    const lineInfo = {
      loadLineId: String(line.id),
      mode,
      atgQtyMode: line.atgQtyMode || 'auto',
      atgStatus: 'ok',
      atgError: null,
      atgTankIds: atgTankIds.map(String),
      manualTankIds: manualTankIds.map(String),
    };

    if (mode === 'manual') {
      hasManual = true;
      const manualBars = buildManualDailyBarsForLine(
        { ...line, manualQty: line.qty, qty: line.qty },
        ctx.timezone,
        ctx.dayStartTime
      );
      allBars.push(...manualBars);
      lineInfo.atgStatus = line.atgQtyMode === 'manual' ? 'manual_override' : 'unavailable';
      lineMeta.push(lineInfo);
      continue;
    }

    const useAtgTanks = mode === 'atg' || mode === 'mixed' ? atgTankIds : [];
    let atgBars = [];

    if (useAtgTanks.length && line.atgQtyMode !== 'manual') {
      const dateKeys = listOperationalDateKeysInRange(
        line.startedAt,
        line.endedAt || new Date().toISOString(),
        ctx.timezone,
        ctx.dayStartTime
      );

      for (const dateKey of dateKeys) {
        const persistKey = `${line.id}|${dateKey}`;
        const isToday = dateKey === todayKey;

        if (!isToday && persistedByLineDate.has(persistKey)) {
          const qtyMoved = persistedByLineDate.get(persistKey);
          atgBars.push({ date: dateKey, qtyMoved, atgQty: qtyMoved, manualQty: 0 });
          hasAtg = true;
          continue;
        }

        const bounds = operationalDayBounds(dateKey, ctx.timezone, ctx.dayStartTime);
        if (!bounds) continue;
        const lineStartMs = new Date(line.startedAt).getTime();
        const lineEndMs = new Date(line.endedAt || Date.now()).getTime();
        const windowStartMs = Math.max(lineStartMs, bounds.start.toMillis());
        const windowEndMs = Math.min(lineEndMs, bounds.end.toMillis());
        if (windowEndMs <= windowStartMs) continue;

        const result = await computeAtgWindowDeltaForBasis(db, {
          tankIds: useAtgTanks,
          startAt: new Date(windowStartMs).toISOString(),
          endAt: new Date(windowEndMs).toISOString(),
          measurementBasis: ctx.measurementBasis,
        });

        const atgQty = readAtgQtyFromResult(result);
        if (result.ok && !result.incomplete && atgQty != null) {
          const qtyMoved = Number(atgQty) || 0;
          atgBars.push({ date: dateKey, qtyMoved, atgQty: qtyMoved, manualQty: 0 });
          hasAtg = true;
        } else {
          lineInfo.atgStatus = result.incomplete ? 'partial' : 'unavailable';
          lineInfo.atgError = result.error || 'incomplete';
        }
      }
    }

    allBars.push(...atgBars);

    if (mode === 'mixed' || (mode === 'atg' && lineInfo.atgStatus !== 'ok')) {
      const manualQty =
        mode === 'mixed'
          ? line.manualQty
          : lineInfo.atgStatus !== 'ok'
            ? line.qty
            : null;
      if (manualQty != null && Number(manualQty) > 0) {
        const fallbackBars = buildManualDailyBarsForLine(
          { ...line, manualQty, qty: manualQty },
          ctx.timezone,
          ctx.dayStartTime
        );
        allBars.push(...fallbackBars);
        hasManual = true;
        if (lineInfo.atgStatus !== 'ok') {
          warnings.push('Some days used manual qty — ATG unavailable');
        }
      }
    }

    if (mode === 'atg' && lineInfo.atgStatus === 'ok') {
      // qty from ATG only
    }

    lineMeta.push(lineInfo);
  }

  const dailyBars = mergeDailyBars(allBars);
  const cumulativeSeries = buildCumulativeSeriesFromDailyBars(dailyBars);

  const totalMoved = ctx.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const done = totalMoved;

  let firstLoggedAt = null;
  let lastLoggedAt = null;
  for (const l of ctx.lines) {
    if (l.startedAt && (!firstLoggedAt || l.startedAt < firstLoggedAt)) firstLoggedAt = l.startedAt;
    const end = l.endedAt || l.startedAt;
    if (end && (!lastLoggedAt || end > lastLoggedAt)) lastLoggedAt = end;
  }

  const siTotal = ctx.siQty;
  const unit = ctx.siMetric || 'MT';
  let ratePerHour = 0;
  if (firstLoggedAt && lastLoggedAt) {
    const hours = (new Date(lastLoggedAt).getTime() - new Date(firstLoggedAt).getTime()) / 3600000;
    if (hours > 0) ratePerHour = done / hours;
  }

  const dailyPick =
    dailyBars.find((b) => b.date === todayKey) || dailyBars[dailyBars.length - 1] || null;

  let source = 'manual';
  if (hasAtg && hasManual) source = 'hybrid';
  else if (hasAtg) source = 'atg';

  const uniqueWarnings = [...new Set(warnings)];

  const cargoSummary = await summarizeCargoProgressContext(db, ctx);

  let hourlyProgress = {
    hourlyBuckets: [],
    movedQty: cargoSummary?.movedQty ?? done,
    completionPercent: cargoSummary?.completionPercent ?? null,
    siQtyVariance: null,
    rateSummary: { currentHourLine: null, lastActiveHourLine: null },
  };
  try {
    hourlyProgress = await getHourlyOperationalProgress(db, ctx);
  } catch {
    /* hourly engine optional if samples unavailable */
  }

  const hourlyMoved = resolveCanonicalMovedQty(cargoSummary, hourlyProgress, done);
  const scheduleComparison = buildScheduleComparisonFromCargoSummary(ctx, {
    ...(cargoSummary || {}),
    movedQty: hourlyMoved,
    siQty: siTotal,
    siMetric: unit,
  });
  const completionPercent =
    cargoSummary?.hasActiveCargo && hourlyProgress.completionPercent != null
      ? hourlyProgress.completionPercent
      : cargoSummary?.completionPercent ??
        (siTotal != null && siTotal > 0 ? Math.min(100, Math.round((hourlyMoved / siTotal) * 100)) : null);

  const hourlyRateSummary = hourlyProgress.rateSummary || {};

  return {
    source,
    purpose: ctx.purpose,
    scheduleTimezone: ctx.timezone,
    operationalDayStart: ctx.dayStartTime,
    warnings: uniqueWarnings,
    dailyBars,
    cumulativeSeries,
    siQty: siTotal,
    siMetric: unit,
    movedQty: hourlyMoved,
    completionPercent,
    siQtyVariance: hourlyProgress.siQtyVariance ?? null,
    hourlyBuckets: hourlyProgress.hourlyBuckets ?? [],
    scheduleComparison,
    rateSummary: {
      movedLine:
        siTotal != null
          ? `${formatQtyNumber(hourlyMoved)} ${unit} / ${formatQtyNumber(siTotal)} ${unit}`
          : `${formatQtyNumber(hourlyMoved)} ${unit}`,
      balanceLine:
        siTotal != null
          ? `Balance ${formatQtyNumber(Math.max(0, siTotal - hourlyMoved))} ${unit}`
          : null,
      hourlyLine:
        hourlyRateSummary.currentHourLine ||
        `Rate ${formatRateNumber(ratePerHour)} ${unit} / Hour`,
      currentHourLine: hourlyRateSummary.currentHourLine ?? null,
      lastActiveHourLine: hourlyRateSummary.lastActiveHourLine ?? null,
      dailyLine: dailyPick
        ? `${formatRateNumber(dailyPick.qtyMoved)} ${unit} / Day (${formatOperationalDateLabel(dailyPick.date)})`
        : null,
      unit,
    },
    lines: lineMeta,
  };
}

/**
 * Hourly sweeper: aggregate closed operational days for all ports.
 * @param {import('pg').Pool} db
 * @param {object} [opts]
 */
export async function runDailyProgressAggregationSweep(db, opts = {}) {
  const portsR = await db.query(
    `SELECT id, schedule_timezone, operational_day_start
     FROM ports
     WHERE deleted_at IS NULL
     ${opts.portId ? 'AND id = $1' : ''}`,
    opts.portId ? [opts.portId] : []
  );

  let totalUpserted = 0;
  let hourlyUpserted = 0;
  for (const port of portsR.rows) {
    const tz = port.schedule_timezone || 'Asia/Jakarta';
    const dayStart = parseOperationalDayStart(port.operational_day_start).formatted;
    const todayKey = currentOperationalDateKey(Date.now(), tz, dayStart);

    const opsR = await db.query(
      `SELECT DISTINCT o.id
       FROM operations o
       JOIN operation_operational_activities oa ON oa.operation_id = o.id AND oa.deleted_at IS NULL
       JOIN operation_cargo_load_lines l ON l.operational_activity_id = oa.id
       WHERE o.port_id = $1
         AND o.deleted_at IS NULL
         AND oa.milestone_key = 'cargo_operations'
         AND l.started_at IS NOT NULL
         AND l.started_at >= NOW() - INTERVAL '90 days'`,
      [port.id]
    );

    for (const op of opsR.rows) {
      const result = await aggregateAtgDailyProgressForOperation(db, Number(op.id), {
        throughDate: todayKey,
        includeToday: false,
      });
      totalUpserted += result.upserted || 0;
      try {
        const hourlyResult = await aggregateHourlyProgressForOperation(db, Number(op.id), {
          onlyClosedHours: true,
        });
        hourlyUpserted += hourlyResult.upserted || 0;
      } catch {
        /* hourly table may not exist pre-migration */
      }
    }
  }

  return { ok: true, upserted: totalUpserted, hourlyUpserted };
}

/**
 * Build schedule comparison from progress context + optional live cargo summary.
 * @param {Awaited<ReturnType<typeof loadOperationProgressContext>>} ctx
 * @param {Awaited<ReturnType<typeof summarizeCargoProgressContext>>|null} [cargoSummary]
 * @param {number} [nowMs]
 */
export function buildScheduleComparisonFromCargoSummary(ctx, cargoSummary, nowMs = Date.now()) {
  if (!ctx) {
    return evaluateCargoScheduleComparison({});
  }

  const movedQty =
    cargoSummary?.movedQty ??
    ctx.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const siQty = cargoSummary?.siQty ?? ctx.siQty;

  return {
    ...evaluateCargoScheduleComparison({
      openingHatchStartAt: ctx.openingHatchStartAt,
      tbAt: ctx.tbAt,
      dockingStartTime: ctx.dockingStartTime,
      etcMs: ctx.etcAt,
      movedQty,
      siQty,
      nowMs,
    }),
    movedQty,
    siQty,
    siMetric: ctx.siMetric || 'MT',
  };
}

/**
 * Attach schedule comparison fields to overview/allocation rows (logged cargo qty, no live ATG).
 * @param {object} row
 * @param {number} [nowMs]
 */
export function buildScheduleComparisonFromOverviewRow(row, nowMs = Date.now()) {
  const movedQty = row.cargoMovedQty ?? row.cargo_moved_qty ?? 0;
  const siQty = row.cargoSiQty ?? row.cargo_si_qty;
  return {
    ...evaluateCargoScheduleComparison({
      openingHatchStartAt: row.openingHatchStartAt ?? row.opening_hatch_start_datetime,
      tbAt: row.tbDateTime ?? row.tb_datetime,
      dockingStartTime: row.dockingStartTime ?? row.docking_start_time,
      etcMs: row.estimatedCompletionDateTime ?? row.estimated_completion_datetime,
      movedQty,
      siQty,
      nowMs,
    }),
    movedQty: Number(movedQty) || 0,
    siQty: siQty != null ? Number(siQty) : null,
  };
}

/**
 * Summarize moved cargo qty for dashboard (ATG live + manual saved).
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {Awaited<ReturnType<typeof loadOperationProgressContext>>} ctx
 */
export async function summarizeCargoProgressContext(db, ctx, opts = {}) {
  const measurementBasis = ctx?.measurementBasis || resolveAtgMeasurementBasis(ctx?.siMetric);
  const computeAtg =
    opts.computeAtg ??
    ((params) => {
      if (ctx?.purpose) {
        return computeDirectionalMovedQtyForWindow(db, {
          ...params,
          purpose: ctx.purpose,
          timezone: ctx.timezone,
          measurementBasis,
          siMetric: ctx.siMetric,
        });
      }
      if (measurementBasis === 'volume') {
        return computeAtgWindowVolumeDelta(db, params);
      }
      return computeAtgWindowMassDelta(db, params);
    });
  if (!ctx) return null;

  const hasTankLine = ctx.lines.some((l) => l.tankIds?.length > 0);
  if (!hasTankLine) return null;

  const activeLines = ctx.lines.filter((l) => l.startedAt && l.tankIds?.length > 0);
  if (activeLines.length === 0) return null;

  let movedQty = 0;
  let hasAtg = false;
  let hasManual = false;
  let isLive = false;
  let hasActiveCargo = false;
  let atgPartial = false;

  for (const line of ctx.lines) {
    if (!line.startedAt || !line.tankIds?.length) continue;

    const { atgTankIds, manualTankIds } = await partitionLineTanks(db, line.tankIds);
    const mode = resolveLineMode({
      commodityType: ctx.commodityType,
      atgTankIds,
      manualTankIds,
      atgQtyMode: line.atgQtyMode,
    });

    if (mode === 'atg' || mode === 'mixed') hasAtg = true;
    if (mode === 'manual' || mode === 'mixed') hasManual = true;

    if (line.endedAt) {
      movedQty += Number(line.qty) || 0;
      continue;
    }

    hasActiveCargo = true;

    if (mode === 'manual' || line.atgQtyMode === 'manual') {
      continue;
    }

    if ((mode === 'atg' || mode === 'mixed') && atgTankIds.length) {
      const result = await computeAtg({
        tankIds: atgTankIds,
        startAt: line.startedAt,
        endAt: new Date().toISOString(),
      });
      const atgQty = readAtgQtyFromResult(result);
      if (result.ok && atgQty != null) {
        movedQty += Number(atgQty) || 0;
        isLive = true;
        if (result.incomplete) atgPartial = true;
      } else if (mode === 'mixed' && line.manualQty != null) {
        movedQty += Number(line.manualQty) || 0;
      } else if (result.incomplete) {
        atgPartial = true;
      }
    }
  }

  let source = 'manual';
  if (hasAtg && hasManual) source = 'hybrid';
  else if (hasAtg) source = 'atg';

  const siQty = ctx.siQty;
  const completionPercent =
    siQty != null && siQty > 0 ? Math.min(100, Math.round((movedQty / siQty) * 100)) : null;

  return {
    connected: true,
    source,
    movedQty,
    siQty,
    siMetric: ctx.siMetric || 'MT',
    completionPercent,
    isLive,
    hasActiveCargo,
    atgPartial,
  };
}

/**
 * Canonical moved qty for live surfaces: hourly ATG aggregate (At-Berth engine), with fallbacks.
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {Awaited<ReturnType<typeof loadOperationProgressContext>>} ctx
 * @param {object} [opts]
 */
export async function resolveLiveCargoProgressTotals(db, ctx, opts = {}) {
  if (!ctx) {
    return {
      movedQty: 0,
      siQty: null,
      siMetric: 'MT',
      cargoSummary: null,
      hourlyProgress: null,
      completionPercent: null,
      source: 'manual',
      isLive: false,
      hasActiveCargo: false,
      atgPartial: false,
      connected: false,
    };
  }

  const cargoSummary = await summarizeCargoProgressContext(db, ctx, opts);
  let hourlyProgress = null;
  try {
    hourlyProgress = await getHourlyOperationalProgress(db, ctx, opts);
  } catch {
    /* hourly engine optional if samples unavailable */
  }

  const closedQty = ctx.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const movedQty = resolveCanonicalMovedQty(cargoSummary, hourlyProgress, closedQty);
  const siQty = ctx.siQty;
  const siMetric = ctx.siMetric || 'MT';
  const hasOpenCargo = ctx.lines.some((l) => l.startedAt && !l.endedAt);

  return {
    movedQty,
    siQty,
    siMetric,
    cargoSummary,
    hourlyProgress,
    completionPercent:
      cargoSummary?.hasActiveCargo && hourlyProgress?.completionPercent != null
        ? hourlyProgress.completionPercent
        : siQty != null && siQty > 0
          ? Math.min(100, Math.round((movedQty / siQty) * 100))
          : null,
    source: cargoSummary?.source ?? (hourlyProgress ? 'atg' : 'manual'),
    isLive: cargoSummary?.isLive ?? hasOpenCargo,
    hasActiveCargo: cargoSummary?.hasActiveCargo ?? hasOpenCargo,
    atgPartial: cargoSummary?.atgPartial ?? false,
    connected: cargoSummary?.connected ?? false,
  };
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {number} operationId
 */
export async function getAtBerthCargoProgressSummary(db, operationId, opts = {}) {
  const ctx = await loadOperationProgressContext(db, operationId);
  if (!ctx) return null;

  const totals = await resolveLiveCargoProgressTotals(db, ctx, opts);
  const hasActivity = ctx.lines.some((l) => l.startedAt) || totals.movedQty > 0;
  if (!hasActivity && !totals.cargoSummary) return null;

  const summary = {
    connected: totals.connected,
    source: totals.source,
    movedQty: totals.movedQty,
    siQty: totals.siQty,
    siMetric: totals.siMetric,
    completionPercent: totals.completionPercent,
    isLive: totals.isLive,
    hasActiveCargo: totals.hasActiveCargo,
    atgPartial: totals.atgPartial,
  };

  return attachScheduleComparisonToSummary(
    summary,
    {
      openingHatchStartAt: ctx.openingHatchStartAt,
      tbAt: ctx.tbAt,
      dockingStartTime: ctx.dockingStartTime,
      etcMs: ctx.etcAt,
    },
    opts.nowMs
  );
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {Array<number|string>} operationIds
 * @param {object} [opts]
 */
export async function getAtBerthCargoProgressSummaries(db, operationIds, opts = {}) {
  const concurrency = opts.concurrency ?? 5;
  const ids = [...new Set((operationIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  /** @type {Record<string, Awaited<ReturnType<typeof getAtBerthCargoProgressSummary>>>} */
  const summaries = {};

  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = ids.slice(i, i + concurrency);
    const pairs = await Promise.all(
      batch.map(async (id) => {
        try {
          const summary = await getAtBerthCargoProgressSummary(db, id);
          return [String(id), summary];
        } catch {
          return [String(id), null];
        }
      })
    );
    for (const [id, summary] of pairs) {
      summaries[id] = summary;
    }
  }

  return summaries;
}

export { DEFAULT_OPERATIONAL_DAY_START, parseOperationalDayStart, aggregateHourlyProgressForOperation };
