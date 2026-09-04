/**
 * Clock-aligned hourly cargo progress from ATG samples (port timezone).
 * Direction-aware Loading/Unloading deltas + Flat Movement classification.
 */

import { DateTime } from 'luxon';
import {
  DEFAULT_FLAT_RATE_THRESHOLD_KL,
  DEFAULT_FLAT_RATE_THRESHOLD_MT,
  DEFAULT_MIN_QTY_MOVED_KL,
  DEFAULT_MIN_QTY_MOVED_MT,
  attachAtgQtyFields,
  observedVolumeToKl,
  resolveAtgMeasurementBasis,
} from './atg-measurement.js';
import {
  DEFAULT_TOLERANCE_MS,
  nearestSampleAtOrBefore,
  nearestVolumeSampleAtOrBefore,
} from './atg-window-rate.js';

export const DEFAULT_FLAT_RATE_THRESHOLD_TPH = DEFAULT_FLAT_RATE_THRESHOLD_MT;
export const DEFAULT_MIN_QTY_MOVED_T = DEFAULT_MIN_QTY_MOVED_MT;

async function getCargoProgressHelpers() {
  return import('./operational-progress.js');
}

/**
 * @param {string|Date} windowStart
 * @param {string|Date} windowEnd
 * @param {string} timezone
 * @returns {Array<{
 *   hourStart: string,
 *   hourEnd: string,
 *   hourLabelLocal: string,
 *   effectiveHours: number,
 *   isPartial: boolean,
 * }>}
 */
export function buildClockHourBuckets(windowStart, windowEnd, timezone) {
  const tz = timezone || 'Asia/Jakarta';
  const startDt = DateTime.fromISO(
    windowStart instanceof Date ? windowStart.toISOString() : String(windowStart),
    { zone: tz }
  );
  const endDt = DateTime.fromISO(
    windowEnd instanceof Date ? windowEnd.toISOString() : String(windowEnd),
    { zone: tz }
  );
  if (!startDt.isValid || !endDt.isValid) return [];
  if (endDt.toMillis() <= startDt.toMillis()) return [];

  const tzAbbrev = startDt.offsetNameShort || tz;
  const buckets = [];
  let cursor = startDt;

  while (cursor.toMillis() < endDt.toMillis()) {
    const nextHourBoundary = cursor.startOf('hour').plus({ hours: 1 });
    const bucketEnd = nextHourBoundary < endDt ? nextHourBoundary : endDt;
    const effectiveHours = (bucketEnd.toMillis() - cursor.toMillis()) / 3600000;
    const isPartial =
      cursor.toMillis() > cursor.startOf('hour').toMillis() ||
      bucketEnd.toMillis() < nextHourBoundary.toMillis();

    buckets.push({
      hourStart: cursor.toUTC().toISO(),
      hourEnd: bucketEnd.toUTC().toISO(),
      hourLabelLocal: `${cursor.toFormat('dd/LL HH:mm')}–${bucketEnd.toFormat('HH:mm')} ${tzAbbrev}`,
      effectiveHours,
      isPartial,
    });
    cursor = bucketEnd;
  }

  return buckets;
}

/**
 * @param {number|null} massStart
 * @param {number|null} massEnd
 * @param {'Loading'|'Unloading'|string|null} purpose
 * @returns {{ qtyMoved: number, directionMismatch: boolean, rawDeltaMass: number|null }}
 */
export function computeDirectionalTankDelta(massStart, massEnd, purpose) {
  if (massStart == null || massEnd == null) {
    return { qtyMoved: 0, directionMismatch: false, rawDeltaMass: null };
  }
  const start = Number(massStart);
  const end = Number(massEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { qtyMoved: 0, directionMismatch: false, rawDeltaMass: null };
  }

  const rawDelta = end - start;
  const p = String(purpose || 'Loading');

  if (p === 'Unloading') {
    if (rawDelta < 0) return { qtyMoved: 0, directionMismatch: true, rawDeltaMass: rawDelta };
    return { qtyMoved: Math.max(0, rawDelta), directionMismatch: false, rawDeltaMass: rawDelta };
  }

  // Loading (default): shore tank mass decreases
  if (rawDelta > 0) return { qtyMoved: 0, directionMismatch: true, rawDeltaMass: rawDelta };
  return { qtyMoved: Math.max(0, start - end), directionMismatch: false, rawDeltaMass: rawDelta };
}

/**
 * @param {number} qtyMoved
 * @param {number} rateTph
 * @param {{ flatRateThresholdTph?: number, minQtyMovedT?: number }} thresholds
 * @param {{ incomplete?: boolean }} [opts]
 * @returns {'active'|'flat_movement'|'incomplete'}
 */
export function classifyHourMovement(qtyMoved, rateTph, thresholds = {}, opts = {}) {
  if (opts.incomplete) return 'incomplete';

  const flatThreshold = Number(thresholds.flatRateThresholdTph ?? DEFAULT_FLAT_RATE_THRESHOLD_TPH);
  const minQty = Number(thresholds.minQtyMovedT ?? DEFAULT_MIN_QTY_MOVED_T);
  const qty = Number(qtyMoved) || 0;
  const rate = Number(rateTph) || 0;

  if (qty < minQty || rate < flatThreshold) return 'flat_movement';
  return 'active';
}

/**
 * Classify hourly row status for display (ATG raw delta), separate from progress qtyMoved.
 * @param {number} displayQtyMoved signed raw ATG delta (massEnd - massStart)
 * @param {boolean} directionMismatch
 * @param {number} displayRateTph abs(displayQtyMoved) / effectiveHours
 * @param {{ flatRateThresholdTph?: number, minQtyMovedT?: number }} thresholds
 * @param {{ incomplete?: boolean }} [opts]
 * @returns {'active'|'flat_movement'|'direction_mismatch'|'incomplete'}
 */
export function classifyHourDisplayStatus(
  displayQtyMoved,
  directionMismatch,
  displayRateTph,
  thresholds = {},
  opts = {}
) {
  if (opts.incomplete) return 'incomplete';

  const flatThreshold = Number(thresholds.flatRateThresholdTph ?? DEFAULT_FLAT_RATE_THRESHOLD_TPH);
  const minQty = Number(thresholds.minQtyMovedT ?? DEFAULT_MIN_QTY_MOVED_T);
  const absQty = Math.abs(Number(displayQtyMoved) || 0);
  const rate = Number(displayRateTph) || 0;

  if (absQty < minQty || rate < flatThreshold) return 'flat_movement';
  if (directionMismatch) return 'direction_mismatch';
  return 'active';
}

/**
 * Resolve display fields from bucket (including legacy persisted rows without displayQtyMoved).
 * @param {object} bucket
 * @returns {{ displayQtyMoved: number, directionMismatch: boolean }}
 */
export function resolveBucketDisplayFields(bucket) {
  const tanks = normalizeTankDetailArray(bucket?.tankDetail);
  let displayQtyMoved = Number(bucket?.displayQtyMoved);

  if (!Number.isFinite(displayQtyMoved) && tanks.length) {
    displayQtyMoved = tanks.reduce((sum, t) => {
      if (t.displayQtyMoved != null && Number.isFinite(Number(t.displayQtyMoved))) {
        return sum + Number(t.displayQtyMoved);
      }
      if (t.rawDeltaLiters != null && Number.isFinite(Number(t.rawDeltaLiters))) {
        return sum + Number(t.rawDeltaLiters);
      }
      if (t.rawDeltaKl != null && Number.isFinite(Number(t.rawDeltaKl))) {
        return sum + Number(t.rawDeltaKl) * 1000;
      }
      if (t.rawDeltaMass != null && Number.isFinite(Number(t.rawDeltaMass))) {
        return sum + Number(t.rawDeltaMass);
      }
      if (t.volumeStartKl != null && t.volumeEndKl != null) {
        const start = Number(t.volumeStartKl);
        const end = Number(t.volumeEndKl);
        if (Number.isFinite(start) && Number.isFinite(end)) return sum + (end - start) * 1000;
      }
      if (t.massStart != null && t.massEnd != null) {
        const start = Number(t.massStart);
        const end = Number(t.massEnd);
        if (Number.isFinite(start) && Number.isFinite(end)) return sum + (end - start);
      }
      return sum;
    }, 0);
  }

  if (!Number.isFinite(displayQtyMoved)) {
    displayQtyMoved = Number(bucket?.qtyMoved) || 0;
  }

  let directionMismatch = Boolean(bucket?.directionMismatch);
  if (!directionMismatch) {
    directionMismatch = tanks.some((t) => t.directionMismatch);
  }

  return { displayQtyMoved, directionMismatch };
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {object} opts
 */
async function computeDirectionalMassDeltaForWindow(db, opts) {
  const startAt = new Date(opts.startAt);
  const endAt = new Date(opts.endAt);
  const toleranceMs = Number.isFinite(opts.toleranceMs) ? opts.toleranceMs : DEFAULT_TOLERANCE_MS;
  const purpose = opts.purpose || 'Loading';

  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
    return { ok: false, sumQtyMoved: null, tanks: [], incomplete: true, directionMismatch: false };
  }

  const tankIds = (opts.tankIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);

  if (!tankIds.length) {
    return { ok: false, sumQtyMoved: null, tanks: [], incomplete: true, directionMismatch: false };
  }

  const meta = await db.query(
    `SELECT id, code, name FROM master_tanks WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
    [tankIds]
  );
  const metaById = new Map(meta.rows.map((row) => [Number(row.id), row]));

  const tanks = [];
  let sumQtyMoved = 0;
  let sumDisplayQtyMoved = 0;
  let okCount = 0;
  let anyDirectionMismatch = false;

  for (const tankId of tankIds) {
    const m = metaById.get(tankId);
    const sStart = await nearestSampleAtOrBefore(db, tankId, startAt, toleranceMs);
    const sEnd = await nearestSampleAtOrBefore(db, tankId, endAt, toleranceMs);

    if (!sStart || !sEnd) {
      tanks.push({
        tankId: String(tankId),
        code: m?.code ?? null,
        name: m?.name ?? null,
        massStart: sStart?.total_mass != null ? Number(sStart.total_mass) : null,
        massEnd: sEnd?.total_mass != null ? Number(sEnd.total_mass) : null,
        qtyMoved: null,
        rawDeltaMass: null,
        displayQtyMoved: null,
        directionMismatch: false,
        error: !sStart && !sEnd ? 'no_sample' : !sStart ? 'no_sample_start' : 'no_sample_end',
      });
      continue;
    }

    const massStart = Number(sStart.total_mass);
    const massEnd = Number(sEnd.total_mass);
    const { qtyMoved, directionMismatch, rawDeltaMass } = computeDirectionalTankDelta(
      massStart,
      massEnd,
      purpose
    );
    if (directionMismatch) anyDirectionMismatch = true;
    sumQtyMoved += qtyMoved;
    sumDisplayQtyMoved += rawDeltaMass ?? 0;
    okCount += 1;

    tanks.push({
      tankId: String(tankId),
      code: m?.code ?? null,
      name: m?.name ?? null,
      massStart,
      massEnd,
      qtyMoved,
      rawDeltaMass,
      displayQtyMoved: rawDeltaMass,
      directionMismatch,
      error: null,
    });
  }

  const incomplete = okCount < tankIds.length;
  return {
    ok: okCount > 0,
    sumQtyMoved: okCount > 0 ? sumQtyMoved : null,
    sumDisplayQtyMoved: okCount > 0 ? sumDisplayQtyMoved : null,
    tanks,
    incomplete,
    directionMismatch: anyDirectionMismatch,
  };
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {object} opts
 */
async function computeDirectionalVolumeDeltaForWindow(db, opts) {
  const startAt = new Date(opts.startAt);
  const endAt = new Date(opts.endAt);
  const toleranceMs = Number.isFinite(opts.toleranceMs) ? opts.toleranceMs : DEFAULT_TOLERANCE_MS;
  const purpose = opts.purpose || 'Loading';

  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
    return { ok: false, sumQtyMoved: null, tanks: [], incomplete: true, directionMismatch: false };
  }

  const tankIds = (opts.tankIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);

  if (!tankIds.length) {
    return { ok: false, sumQtyMoved: null, tanks: [], incomplete: true, directionMismatch: false };
  }

  const meta = await db.query(
    `SELECT id, code, name FROM master_tanks WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
    [tankIds]
  );
  const metaById = new Map(meta.rows.map((row) => [Number(row.id), row]));

  const tanks = [];
  let sumQtyMoved = 0;
  let sumDisplayQtyMoved = 0;
  let okCount = 0;
  let anyDirectionMismatch = false;

  for (const tankId of tankIds) {
    const m = metaById.get(tankId);
    const sStart = await nearestVolumeSampleAtOrBefore(db, tankId, startAt, toleranceMs);
    const sEnd = await nearestVolumeSampleAtOrBefore(db, tankId, endAt, toleranceMs);

    if (!sStart || !sEnd) {
      tanks.push({
        tankId: String(tankId),
        code: m?.code ?? null,
        name: m?.name ?? null,
        volumeStartKl: sStart ? observedVolumeToKl(sStart.total_observed_volume) : null,
        volumeEndKl: sEnd ? observedVolumeToKl(sEnd.total_observed_volume) : null,
        qtyMoved: null,
        rawDeltaKl: null,
        rawDeltaLiters: null,
        displayQtyMoved: null,
        directionMismatch: false,
        error: !sStart && !sEnd ? 'no_sample' : !sStart ? 'no_sample_start' : 'no_sample_end',
      });
      continue;
    }

    const volumeStartKl = observedVolumeToKl(sStart.total_observed_volume);
    const volumeEndKl = observedVolumeToKl(sEnd.total_observed_volume);
    if (volumeStartKl == null || volumeEndKl == null) {
      tanks.push({
        tankId: String(tankId),
        code: m?.code ?? null,
        name: m?.name ?? null,
        volumeStartKl,
        volumeEndKl,
        qtyMoved: null,
        rawDeltaKl: null,
        rawDeltaLiters: null,
        displayQtyMoved: null,
        directionMismatch: false,
        error: 'invalid_volume',
      });
      continue;
    }

    const { qtyMoved, directionMismatch, rawDeltaMass: rawDeltaKl } = computeDirectionalTankDelta(
      volumeStartKl,
      volumeEndKl,
      purpose
    );
    const rawDeltaLiters = rawDeltaKl != null ? rawDeltaKl * 1000 : null;
    if (directionMismatch) anyDirectionMismatch = true;
    sumQtyMoved += qtyMoved;
    sumDisplayQtyMoved += rawDeltaLiters ?? 0;
    okCount += 1;

    tanks.push({
      tankId: String(tankId),
      code: m?.code ?? null,
      name: m?.name ?? null,
      volumeStartKl,
      volumeEndKl,
      qtyMoved,
      rawDeltaKl,
      rawDeltaLiters,
      displayQtyMoved: rawDeltaLiters,
      directionMismatch,
      error: null,
    });
  }

  const incomplete = okCount < tankIds.length;
  return {
    ok: okCount > 0,
    sumQtyMoved: okCount > 0 ? sumQtyMoved : null,
    sumDisplayQtyMoved: okCount > 0 ? sumDisplayQtyMoved : null,
    tanks,
    incomplete,
    directionMismatch: anyDirectionMismatch,
  };
}

function computeDirectionalDeltaForWindow(db, opts) {
  const basis = opts.measurementBasis === 'volume' ? 'volume' : 'mass';
  if (basis === 'volume') {
    return computeDirectionalVolumeDeltaForWindow(db, opts);
  }
  return computeDirectionalMassDeltaForWindow(db, opts);
}

/**
 * Directional moved qty over [startAt, endAt]: sum of clock-hour bucket qtyMoved (matches hourly progress).
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {object} opts
 * @param {Array<number|string>} opts.tankIds
 * @param {string|Date} opts.startAt
 * @param {string|Date} opts.endAt
 * @param {'Loading'|'Unloading'|string|null} [opts.purpose]
 * @param {string} [opts.timezone]
 * @param {number} [opts.toleranceMs]
 * @returns {Promise<{
 *   ok: boolean,
 *   sumDeltaMass: number|null,
 *   tanks: Array<object>,
 *   incomplete: boolean,
 *   directionMismatch: boolean,
 *   error?: string|null,
 * }>}
 */
export async function computeDirectionalMovedQtyForWindow(db, opts) {
  const purpose = opts.purpose === 'Unloading' ? 'Unloading' : 'Loading';
  const timezone = opts.timezone || 'Asia/Jakarta';
  const toleranceMs = Number.isFinite(opts.toleranceMs) ? opts.toleranceMs : DEFAULT_TOLERANCE_MS;
  const measurementBasis =
    opts.measurementBasis === 'volume' || opts.measurementBasis === 'mass'
      ? opts.measurementBasis
      : resolveAtgMeasurementBasis(opts.siMetric);
  const tankIds = (opts.tankIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);

  if (!tankIds.length) {
    return attachAtgQtyFields(
      {
        ok: false,
        sumDeltaMass: null,
        tanks: [],
        incomplete: true,
        directionMismatch: false,
        error: 'no_tanks',
      },
      measurementBasis
    );
  }

  const buckets = buildClockHourBuckets(opts.startAt, opts.endAt, timezone);
  if (!buckets.length) {
    return attachAtgQtyFields(
      {
        ok: false,
        sumDeltaMass: null,
        tanks: [],
        incomplete: true,
        directionMismatch: false,
        error: 'invalid_window',
      },
      measurementBasis
    );
  }

  let sumQtyMoved = 0;
  let mergedTankDetail = null;
  let anyIncomplete = false;
  let anyDirectionMismatch = false;
  const deltaOpts = { tankIds, purpose, toleranceMs, measurementBasis };

  for (const bucket of buckets) {
    const result = await computeDirectionalDeltaForWindow(db, {
      ...deltaOpts,
      startAt: bucket.hourStart,
      endAt: bucket.hourEnd,
    });
    if (result.incomplete) anyIncomplete = true;
    if (result.directionMismatch) anyDirectionMismatch = true;
    if (result.ok && result.sumQtyMoved != null) {
      sumQtyMoved += Number(result.sumQtyMoved) || 0;
    }
    mergedTankDetail = mergeTankDetailArrays(mergedTankDetail, result.tanks);
  }

  const endpoint = await computeDirectionalDeltaForWindow(db, {
    ...deltaOpts,
    startAt: opts.startAt,
    endAt: opts.endAt,
  });
  if (endpoint.incomplete) anyIncomplete = true;
  if (endpoint.directionMismatch) anyDirectionMismatch = true;

  const endpointById = new Map((endpoint.tanks || []).map((t) => [String(t.tankId), t]));
  const mergedTanks = normalizeTankDetailArray(mergedTankDetail);
  const tanks = mergedTanks.map((t) => {
    const ep = endpointById.get(String(t.tankId));
    if (measurementBasis === 'volume') {
      return {
        tankId: t.tankId,
        code: t.code ?? ep?.code ?? null,
        name: t.name ?? ep?.name ?? null,
        qtyMoved: Number(t.qtyMoved) || 0,
        deltaKl: ep?.rawDeltaKl ?? (ep?.displayQtyMoved != null ? ep.displayQtyMoved / 1000 : null),
        volumeStartKl: ep?.volumeStartKl ?? null,
        volumeEndKl: ep?.volumeEndKl ?? null,
        rawDeltaLiters: ep?.rawDeltaLiters ?? null,
        directionMismatch: Boolean(t.directionMismatch || ep?.directionMismatch),
        error: t.error ?? ep?.error ?? null,
      };
    }
    return {
      tankId: t.tankId,
      code: t.code ?? ep?.code ?? null,
      name: t.name ?? ep?.name ?? null,
      qtyMoved: Number(t.qtyMoved) || 0,
      deltaMass: ep?.rawDeltaMass ?? ep?.displayQtyMoved ?? null,
      massStart: ep?.massStart ?? null,
      massEnd: ep?.massEnd ?? null,
      directionMismatch: Boolean(t.directionMismatch || ep?.directionMismatch),
      error: t.error ?? ep?.error ?? null,
    };
  });

  const ok = endpoint.ok || sumQtyMoved > 0;
  const base = {
    ok,
    sumDeltaMass: measurementBasis === 'mass' && ok ? sumQtyMoved : null,
    sumDeltaVolumeKl: measurementBasis === 'volume' && ok ? sumQtyMoved : null,
    tanks,
    incomplete: anyIncomplete,
    directionMismatch: anyDirectionMismatch,
    error: ok ? (anyIncomplete ? 'partial_samples' : null) : endpoint.error || 'no_samples',
  };
  return attachAtgQtyFields(base, measurementBasis);
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {object} line
 * @param {object} ctx
 * @param {object} [opts]
 */
export async function computeHourlyBucketsForLine(db, line, ctx, opts = {}) {
  const { partitionLineTanks, resolveLineMode } = await getCargoProgressHelpers();
  const startIso = line.startedAt || line.startAt;
  const endIso = line.endedAt || line.endAt || new Date().toISOString();
  if (!startIso) return [];

  const { atgTankIds } = await partitionLineTanks(db, line.tankIds || []);
  if (!atgTankIds.length) return [];

  const mode = resolveLineMode({
    commodityType: ctx.commodityType,
    atgTankIds,
    manualTankIds: [],
    atgQtyMode: line.atgQtyMode,
  });
  if (mode === 'manual' || line.atgQtyMode === 'manual') return [];

  const buckets = buildClockHourBuckets(startIso, endIso, ctx.timezone);
  const thresholds = {
    flatRateThresholdTph: ctx.flatRateThresholdTph ?? DEFAULT_FLAT_RATE_THRESHOLD_TPH,
    minQtyMovedT: ctx.minQtyMovedT ?? DEFAULT_MIN_QTY_MOVED_T,
  };
  const purpose = ctx.purpose || 'Loading';
  const toleranceMs = ctx.sampleToleranceMs ?? DEFAULT_TOLERANCE_MS;
  const measurementBasis = ctx.measurementBasis || resolveAtgMeasurementBasis(ctx.siMetric);

  const out = [];
  for (const bucket of buckets) {
    const result = await computeDirectionalDeltaForWindow(db, {
      tankIds: atgTankIds,
      startAt: bucket.hourStart,
      endAt: bucket.hourEnd,
      purpose,
      toleranceMs,
      measurementBasis,
    });

    const qtyMoved = result.ok && result.sumQtyMoved != null ? Number(result.sumQtyMoved) : 0;
    const displayQtyMoved =
      result.ok && result.sumDisplayQtyMoved != null ? Number(result.sumDisplayQtyMoved) : 0;
    const rateTph =
      bucket.effectiveHours > 0 ? qtyMoved / bucket.effectiveHours : qtyMoved > 0 ? qtyMoved : 0;
    const displayRateTph =
      bucket.effectiveHours > 0
        ? Math.abs(displayQtyMoved) / bucket.effectiveHours
        : Math.abs(displayQtyMoved) > 0
          ? Math.abs(displayQtyMoved)
          : 0;
    const movementStatus = classifyHourDisplayStatus(
      displayQtyMoved,
      result.directionMismatch,
      displayRateTph,
      thresholds,
      { incomplete: result.incomplete }
    );

    out.push({
      loadLineId: line.id != null ? String(line.id) : null,
      hourStart: bucket.hourStart,
      hourEnd: bucket.hourEnd,
      hourLabelLocal: bucket.hourLabelLocal,
      qtyMoved,
      rateTph,
      displayQtyMoved,
      displayRateTph,
      movementStatus,
      source: 'atg',
      isPartial: bucket.isPartial,
      directionMismatch: result.directionMismatch,
      tankDetail: result.tanks,
    });
  }

  return out;
}

/**
 * Allocate manual checkpoint cumulative readings into clock-hour buckets.
 * @param {Array<{ recordedAt: string, cumulativeQty: number }>} checkpoints sorted by time
 * @param {string} windowStart
 * @param {string} windowEnd
 * @param {string} timezone
 * @param {object} ctx
 */
export function computeHourlyBucketsFromManualCheckpoints(
  checkpoints,
  windowStart,
  windowEnd,
  timezone,
  ctx = {}
) {
  const sorted = [...(checkpoints || [])]
    .filter((cp) => cp.recordedAt && cp.cumulativeQty != null)
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

  const buckets = buildClockHourBuckets(windowStart, windowEnd, timezone);
  if (!buckets.length) return [];

  const thresholds = {
    flatRateThresholdTph: ctx.flatRateThresholdTph ?? DEFAULT_FLAT_RATE_THRESHOLD_TPH,
    minQtyMovedT: ctx.minQtyMovedT ?? DEFAULT_MIN_QTY_MOVED_T,
  };

  const segments = [];
  let prevQty = 0;
  let prevTime = windowStart;

  for (const cp of sorted) {
    const cpTime = new Date(cp.recordedAt).toISOString();
    if (new Date(cpTime).getTime() <= new Date(prevTime).getTime()) continue;
    const cumQty = Number(cp.cumulativeQty) || 0;
    const delta = Math.max(0, cumQty - prevQty);
    if (delta > 0) {
      segments.push({ startAt: prevTime, endAt: cpTime, qtyMoved: delta });
    }
    prevQty = cumQty;
    prevTime = cpTime;
  }

  const windowEndIso =
    windowEnd instanceof Date ? windowEnd.toISOString() : String(windowEnd);
  if (new Date(prevTime).getTime() < new Date(windowEndIso).getTime() && prevQty > 0) {
    // trailing flat segment — no additional qty
  }

  const out = buckets.map((bucket) => {
    let qtyMoved = 0;
    for (const seg of segments) {
      const segStart = new Date(seg.startAt).getTime();
      const segEnd = new Date(seg.endAt).getTime();
      const bStart = new Date(bucket.hourStart).getTime();
      const bEnd = new Date(bucket.hourEnd).getTime();
      const overlapStart = Math.max(segStart, bStart);
      const overlapEnd = Math.min(segEnd, bEnd);
      if (overlapEnd <= overlapStart) continue;
      const segDuration = segEnd - segStart;
      if (segDuration <= 0) continue;
      qtyMoved += (seg.qtyMoved * (overlapEnd - overlapStart)) / segDuration;
    }

    const rateTph =
      bucket.effectiveHours > 0 ? qtyMoved / bucket.effectiveHours : qtyMoved > 0 ? qtyMoved : 0;
    const displayQtyMoved = qtyMoved;
    const displayRateTph = rateTph;
    const movementStatus = classifyHourDisplayStatus(displayQtyMoved, false, displayRateTph, thresholds, {
      incomplete: sorted.length === 0,
    });

    return {
      hourStart: bucket.hourStart,
      hourEnd: bucket.hourEnd,
      hourLabelLocal: bucket.hourLabelLocal,
      qtyMoved,
      rateTph,
      displayQtyMoved,
      displayRateTph,
      movementStatus,
      source: 'manual',
      isPartial: bucket.isPartial,
      directionMismatch: false,
      tankDetail: null,
    };
  });

  return out;
}

/**
 * Normalize tank detail from bucket row (array or legacy wrapper).
 * @param {unknown} tankDetail
 * @returns {Array<object>}
 */
export function normalizeTankDetailArray(tankDetail) {
  if (Array.isArray(tankDetail)) return tankDetail;
  if (tankDetail && typeof tankDetail === 'object' && Array.isArray(tankDetail.tanks)) {
    return tankDetail.tanks;
  }
  return [];
}

/**
 * Merge per-tank qty rows when combining hourly buckets for the same clock hour.
 * @param {unknown} prevDetail
 * @param {unknown} nextDetail
 * @returns {Array<object>|null}
 */
export function mergeTankDetailArrays(prevDetail, nextDetail) {
  const prevTanks = normalizeTankDetailArray(prevDetail);
  const nextTanks = normalizeTankDetailArray(nextDetail);
  if (!prevTanks.length && !nextTanks.length) return null;
  if (!prevTanks.length) return nextTanks.map((t) => ({ ...t }));
  if (!nextTanks.length) return prevTanks.map((t) => ({ ...t }));

  const byKey = new Map();
  for (const t of [...prevTanks, ...nextTanks]) {
    const key = String(t.tankId ?? t.code ?? '');
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...t });
      continue;
    }
    prev.qtyMoved = (Number(prev.qtyMoved) || 0) + (Number(t.qtyMoved) || 0);
    prev.rawDeltaMass = (Number(prev.rawDeltaMass) || 0) + (Number(t.rawDeltaMass) || 0);
    prev.rawDeltaKl = (Number(prev.rawDeltaKl) || 0) + (Number(t.rawDeltaKl) || 0);
    prev.rawDeltaLiters = (Number(prev.rawDeltaLiters) || 0) + (Number(t.rawDeltaLiters) || 0);
    prev.displayQtyMoved = (Number(prev.displayQtyMoved) || 0) + (Number(t.displayQtyMoved) || 0);
    prev.directionMismatch = Boolean(prev.directionMismatch || t.directionMismatch);
  }
  return [...byKey.values()];
}

/**
 * Merge hourly buckets from multiple lines by hourStart (sum qty, recompute rate).
 * @param {Array<object>} bucketLists
 * @param {object} thresholds
 */
export function mergeHourlyBuckets(bucketLists, thresholds = {}) {
  const byHour = new Map();

  for (const list of bucketLists) {
    for (const b of list || []) {
      const key = b.hourStart;
      const prev = byHour.get(key);
      if (!prev) {
        byHour.set(key, { ...b });
        continue;
      }
      prev.qtyMoved = (Number(prev.qtyMoved) || 0) + (Number(b.qtyMoved) || 0);
      prev.displayQtyMoved = (Number(prev.displayQtyMoved) || 0) + (Number(b.displayQtyMoved) || 0);
      prev.directionMismatch = Boolean(prev.directionMismatch || b.directionMismatch);
      prev.tankDetail = mergeTankDetailArrays(prev.tankDetail, b.tankDetail);
      if (prev.source !== b.source && b.source) {
        prev.source = prev.source === b.source ? prev.source : 'hybrid';
      }
      if (b.movementStatus === 'incomplete') prev.movementStatus = 'incomplete';
      else if (b.movementStatus === 'active' && prev.movementStatus !== 'incomplete') {
        prev.movementStatus = 'active';
      }
    }
  }

  return [...byHour.values()]
    .sort((a, b) => String(a.hourStart).localeCompare(String(b.hourStart)))
    .map((b) => {
      const startMs = new Date(b.hourStart).getTime();
      const endMs = new Date(b.hourEnd).getTime();
      const effectiveHours = (endMs - startMs) / 3600000;
      const rateTph = effectiveHours > 0 ? (Number(b.qtyMoved) || 0) / effectiveHours : 0;
      const { displayQtyMoved, directionMismatch } = resolveBucketDisplayFields(b);
      const displayRateTph =
        effectiveHours > 0 ? Math.abs(displayQtyMoved) / effectiveHours : 0;
      return {
        ...b,
        displayQtyMoved,
        displayRateTph,
        directionMismatch,
        rateTph,
        movementStatus: classifyHourDisplayStatus(
          displayQtyMoved,
          directionMismatch,
          displayRateTph,
          thresholds,
          { incomplete: b.movementStatus === 'incomplete' }
        ),
      };
    });
}

/**
 * Build rate summary lines from hourly buckets.
 * @param {Array<object>} hourlyBuckets
 * @param {string} unit
 */
export function buildHourlyRateSummary(hourlyBuckets, unit = 'MT') {
  if (!hourlyBuckets?.length) {
    return { currentHourLine: null, lastActiveHourLine: null };
  }

  const current = hourlyBuckets[hourlyBuckets.length - 1];
  const currentRate = Number(current.rateTph) || 0;
  const currentLine = current.hourLabelLocal
    ? `Current hour (${current.hourLabelLocal}): ${currentRate.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}/h`
    : null;

  let lastActive = null;
  for (let i = hourlyBuckets.length - 1; i >= 0; i -= 1) {
    if (hourlyBuckets[i].movementStatus === 'active') {
      lastActive = hourlyBuckets[i];
      break;
    }
  }

  const lastActiveLine = lastActive
    ? `Last active: ${lastActive.hourLabelLocal} · ${(Number(lastActive.rateTph) || 0).toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}/h`
    : null;

  return { currentHourLine: currentLine, lastActiveHourLine: lastActiveLine };
}

/**
 * @param {number} movedQty
 * @param {number|null} siQty
 * @returns {{ completionPercent: number|null, siQtyVariance: object|null }}
 */
export function computeCompletionFromMovedQty(movedQty, siQty) {
  const moved = Number(movedQty);
  const si = Number(siQty);
  if (!Number.isFinite(si) || si <= 0) {
    return { completionPercent: null, siQtyVariance: null };
  }
  if (!Number.isFinite(moved) || moved < 0) {
    return { completionPercent: 0, siQtyVariance: null };
  }

  const completionPercent = Math.min(100, Math.round((moved / si) * 100));
  const diff = moved - si;
  const epsilon = 1e-6;
  let siQtyVariance = null;
  if (Math.abs(diff) > epsilon) {
    siQtyVariance = {
      kind: diff > 0 ? 'over' : 'under',
      delta: Math.abs(diff),
      movedQty: moved,
      siQty: si,
    };
  }

  return { completionPercent, siQtyVariance };
}

async function loadManualCheckpointsForLine(db, loadLineId) {
  try {
    const r = await db.query(
      `SELECT recorded_at, cumulative_qty
       FROM operation_cargo_manual_checkpoints
       WHERE load_line_id = $1
       ORDER BY recorded_at ASC, id ASC`,
      [loadLineId]
    );
    return (r.rows || []).map((row) => ({
      recordedAt: new Date(row.recorded_at).toISOString(),
      cumulativeQty: Number(row.cumulative_qty) || 0,
    }));
  } catch {
    return [];
  }
}

/**
 * Hourly buckets for a single cargo load line (not merged with other segments).
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {object} ctx from loadOperationProgressContext
 * @param {object} line
 * @param {object} [opts]
 * @returns {Promise<Array<object>>}
 */
export async function getHourlyBucketsForLineEntry(db, ctx, line, opts = {}) {
  const { partitionLineTanks, resolveLineMode } = await getCargoProgressHelpers();
  const startIso = line.startedAt || line.startAt;
  if (!startIso || !line.tankIds?.length) return [];

  const { atgTankIds, manualTankIds } = await partitionLineTanks(db, line.tankIds);
  const mode = resolveLineMode({
    commodityType: ctx.commodityType,
    atgTankIds,
    manualTankIds,
    atgQtyMode: line.atgQtyMode,
  });

  const endIso = line.endedAt || line.endAt || new Date().toISOString();
  const lineForCompute = {
    ...line,
    startedAt: startIso,
    endedAt: line.endedAt || line.endAt || null,
  };

  const bucketLists = [];
  const thresholds = {
    flatRateThresholdTph: ctx.flatRateThresholdTph ?? DEFAULT_FLAT_RATE_THRESHOLD_TPH,
    minQtyMovedT: ctx.minQtyMovedT ?? DEFAULT_MIN_QTY_MOVED_T,
  };

  if (mode === 'manual' || line.atgQtyMode === 'manual') {
    const checkpoints = line.id ? await loadManualCheckpointsForLine(db, line.id) : [];
    if (checkpoints.length) {
      bucketLists.push(
        computeHourlyBucketsFromManualCheckpoints(checkpoints, startIso, endIso, ctx.timezone, ctx)
      );
    } else if ((line.endedAt || line.endAt) && line.qty != null) {
      bucketLists.push(
        computeHourlyBucketsFromManualCheckpoints(
          [{ recordedAt: endIso, cumulativeQty: Number(line.qty) || 0 }],
          startIso,
          endIso,
          ctx.timezone,
          ctx
        )
      );
    }
    return mergeHourlyBuckets(bucketLists, thresholds);
  }

  if (line.endedAt && line.atgHourlyDetail && !opts.forceRecompute) {
    const stored = Array.isArray(line.atgHourlyDetail) ? line.atgHourlyDetail : [];
    if (stored.length) return stored;
  }

  if (line.id) {
    const persisted = await loadPersistedHourlyBuckets(db, line.id);
    if (persisted.length && line.endedAt && !opts.forceRecompute) {
      return persisted;
    }
  }

  const atgBuckets = await computeHourlyBucketsForLine(db, lineForCompute, ctx);
  if (atgBuckets.length) bucketLists.push(atgBuckets);

  if (mode === 'mixed' && line.manualQty != null && Number(line.manualQty) > 0) {
    bucketLists.push(
      computeHourlyBucketsFromManualCheckpoints(
        [{ recordedAt: endIso, cumulativeQty: Number(line.manualQty) }],
        startIso,
        endIso,
        ctx.timezone,
        ctx
      )
    );
  }

  return mergeHourlyBuckets(bucketLists, thresholds);
}

/**
 * Progress summary for one cargo segment (hourly buckets + moved qty + rate lines).
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {object} ctx
 * @param {object} line
 * @param {object} [opts]
 */
export async function getHourlyProgressForLine(db, ctx, line, opts = {}) {
  const hourlyBuckets = await getHourlyBucketsForLineEntry(db, ctx, line, opts);
  const movedQty = hourlyBuckets.reduce((s, b) => s + (Number(b.qtyMoved) || 0), 0);
  const unit = ctx.siMetric || 'MT';
  return {
    hourlyBuckets,
    movedQty,
    rateSummary: buildHourlyRateSummary(hourlyBuckets, unit),
  };
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {object} ctx from loadOperationProgressContext
 * @param {object} [opts]
 */
export async function getHourlyOperationalProgress(db, ctx, opts = {}) {
  if (!ctx?.lines?.length) {
    return {
      hourlyBuckets: [],
      movedQty: 0,
      completionPercent: null,
      siQtyVariance: null,
      rateSummary: { currentHourLine: null, lastActiveHourLine: null },
    };
  }

  const thresholds = {
    flatRateThresholdTph: ctx.flatRateThresholdTph ?? DEFAULT_FLAT_RATE_THRESHOLD_TPH,
    minQtyMovedT: ctx.minQtyMovedT ?? DEFAULT_MIN_QTY_MOVED_T,
  };

  const allBucketLists = [];

  for (const line of ctx.lines) {
    if (!line.startedAt || !line.tankIds?.length) continue;
    const lineBuckets = await getHourlyBucketsForLineEntry(db, ctx, line, opts);
    if (lineBuckets.length) allBucketLists.push(lineBuckets);
  }

  const hourlyBuckets = mergeHourlyBuckets(allBucketLists, thresholds);
  const movedQty = hourlyBuckets.reduce((s, b) => s + (Number(b.qtyMoved) || 0), 0);
  const { completionPercent, siQtyVariance } = computeCompletionFromMovedQty(movedQty, ctx.siQty);
  const unit = ctx.siMetric || 'MT';

  return {
    hourlyBuckets,
    movedQty,
    completionPercent,
    siQtyVariance,
    rateSummary: buildHourlyRateSummary(hourlyBuckets, unit),
  };
}

async function loadPersistedHourlyBuckets(db, loadLineId) {
  try {
    const r = await db.query(
      `SELECT hour_start, hour_end, qty_moved, rate_tph, movement_status, source, tank_detail
       FROM operation_hourly_cargo_progress
       WHERE load_line_id = $1
       ORDER BY hour_start ASC`,
      [loadLineId]
    );
    return (r.rows || []).map((row) => ({
      loadLineId: String(loadLineId),
      hourStart: new Date(row.hour_start).toISOString(),
      hourEnd: new Date(row.hour_end).toISOString(),
      hourLabelLocal: null,
      qtyMoved: Number(row.qty_moved) || 0,
      rateTph: row.rate_tph != null ? Number(row.rate_tph) : 0,
      movementStatus: row.movement_status,
      source: row.source,
      isPartial: false,
      tankDetail: row.tank_detail,
    }));
  } catch {
    return [];
  }
}

async function upsertHourlyProgressRow(db, row) {
  await db.query(
    `INSERT INTO operation_hourly_cargo_progress (
       operation_id, load_line_id, hour_start, hour_end,
       qty_moved, rate_tph, movement_status, source, tank_detail, computed_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
     ON CONFLICT (load_line_id, hour_start)
     DO UPDATE SET
       hour_end = EXCLUDED.hour_end,
       qty_moved = EXCLUDED.qty_moved,
       rate_tph = EXCLUDED.rate_tph,
       movement_status = EXCLUDED.movement_status,
       source = EXCLUDED.source,
       tank_detail = EXCLUDED.tank_detail,
       computed_at = NOW()`,
    [
      row.operationId,
      row.loadLineId,
      row.hourStart,
      row.hourEnd,
      row.qtyMoved,
      row.rateTph,
      row.movementStatus,
      row.source,
      row.tankDetail ? JSON.stringify(row.tankDetail) : null,
    ]
  );
}

/**
 * Persist closed hourly buckets for an operation (P2).
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {number} operationId
 * @param {object} [opts]
 */
export async function aggregateHourlyProgressForOperation(db, operationId, opts = {}) {
  const { loadOperationProgressContext } = await import('./operational-progress.js');
  const ctx = await loadOperationProgressContext(db, operationId);
  if (!ctx) return { ok: false, error: 'not_found' };

  const nowMs = Date.now();
  let upserted = 0;

  for (const line of ctx.lines) {
    if (!line.startedAt || !line.tankIds?.length) continue;

    const lineBuckets = await computeHourlyBucketsForLine(db, line, ctx);

    for (const match of lineBuckets) {
      const bucketEndMs = new Date(match.hourEnd).getTime();
      if (!line.endedAt && bucketEndMs > nowMs) continue;
      if (opts.onlyClosedHours && bucketEndMs > nowMs) continue;

      await upsertHourlyProgressRow(db, {
        operationId,
        loadLineId: line.id,
        hourStart: match.hourStart,
        hourEnd: match.hourEnd,
        qtyMoved: match.qtyMoved,
        rateTph: match.rateTph,
        movementStatus: match.movementStatus,
        source: match.source,
        tankDetail: match.tankDetail,
      });
      upserted += 1;
    }

    if (line.endedAt) {
      try {
        await db.query(
          `UPDATE operation_cargo_load_lines
           SET atg_hourly_detail = $1::jsonb, atg_hourly_computed_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(lineBuckets), line.id]
        );
      } catch {
        /* columns may not exist pre-migration */
      }
    }
  }

  return { ok: true, upserted };
}

/**
 * Snapshot hourly detail when a load line segment closes.
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {number} loadLineId
 * @param {number} operationId
 */
export async function snapshotHourlyDetailForLoadLine(db, loadLineId, operationId) {
  try {
    await aggregateHourlyProgressForOperation(db, operationId, { onlyClosedHours: true });
  } catch {
    /* non-fatal if migration not applied */
  }
}
