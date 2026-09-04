/**
 * Planned (time-based Hose-On → ETC) vs actual (volume/ATG) cargo progress comparison.
 */

function parseMs(val) {
  if (val == null) return null;
  const ms = typeof val === 'number' ? val : new Date(val).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Resolve schedule start: Hose-On (opening_hatch) with TB fallback.
 * @param {{ openingHatchStartAt?: string|null, tbAt?: string|null, dockingStartTime?: string|null }} opts
 */
export function resolveScheduleStartMs(opts = {}) {
  return (
    parseMs(opts.openingHatchStartAt) ??
    parseMs(opts.tbAt) ??
    parseMs(opts.dockingStartTime) ??
    null
  );
}

/**
 * @param {{ scheduleStartMs?: number|null, etcMs?: number|null, nowMs?: number }} opts
 * @returns {number|null}
 */
export function computePlannedProgressPercent({ scheduleStartMs, etcMs, nowMs = Date.now() }) {
  const startMs = parseMs(scheduleStartMs);
  const endMs = parseMs(etcMs);
  const now = parseMs(nowMs);
  if (startMs == null || endMs == null || now == null) return null;
  if (endMs <= startMs) return null;

  const totalMs = endMs - startMs;
  const elapsedMs = Math.max(0, Math.min(now - startMs, totalMs));
  return Math.min(100, Math.round((elapsedMs / totalMs) * 100));
}

/**
 * @param {{ movedQty?: number|null, siQty?: number|null }} opts
 * @returns {number|null}
 */
export function computeActualProgressPercent({ movedQty, siQty }) {
  const moved = Number(movedQty);
  const total = Number(siQty);
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(moved) || moved < 0) return 0;
  return Math.min(100, Math.round((moved / total) * 100));
}

/**
 * @param {object} opts
 * @param {number|string|null} [opts.scheduleStartMs]
 * @param {number|string|null} [opts.etcMs]
 * @param {number|string|null} [opts.openingHatchStartAt]
 * @param {number|string|null} [opts.tbAt]
 * @param {number|string|null} [opts.dockingStartTime]
 * @param {number|null} [opts.movedQty]
 * @param {number|null} [opts.siQty]
 * @param {number} [opts.nowMs]
 * @returns {{
 *   evaluable: boolean,
 *   plannedPercent: number|null,
 *   actualPercent: number|null,
 *   isBehindSchedule: boolean,
 *   scheduleGapPercent: number|null,
 *   scheduleStartAt: string|null,
 *   etcAt: string|null,
 * }}
 */
export function evaluateCargoScheduleComparison(opts = {}) {
  const scheduleStartMs =
    parseMs(opts.scheduleStartMs) ??
    resolveScheduleStartMs({
      openingHatchStartAt: opts.openingHatchStartAt,
      tbAt: opts.tbAt,
      dockingStartTime: opts.dockingStartTime,
    });
  const etcMs = parseMs(opts.etcMs);
  const nowMs = parseMs(opts.nowMs ?? Date.now()) ?? Date.now();

  const plannedPercent = computePlannedProgressPercent({ scheduleStartMs, etcMs, nowMs });
  const actualPercent = computeActualProgressPercent({
    movedQty: opts.movedQty,
    siQty: opts.siQty,
  });

  const evaluable =
    scheduleStartMs != null &&
    etcMs != null &&
    etcMs > scheduleStartMs &&
    plannedPercent != null &&
    actualPercent != null;

  const scheduleGapPercent =
    evaluable && plannedPercent != null && actualPercent != null
      ? Math.max(0, plannedPercent - actualPercent)
      : null;

  const isBehindSchedule =
    evaluable && actualPercent != null && plannedPercent != null && actualPercent < plannedPercent;

  return {
    evaluable,
    plannedPercent,
    actualPercent,
    isBehindSchedule,
    scheduleGapPercent,
    scheduleStartAt: scheduleStartMs != null ? new Date(scheduleStartMs).toISOString() : null,
    etcAt: etcMs != null ? new Date(etcMs).toISOString() : null,
  };
}

/**
 * Merge schedule comparison into an existing cargo progress summary object.
 * @param {object|null} summary
 * @param {object} timeline
 * @param {number} [nowMs]
 */
export function attachScheduleComparisonToSummary(summary, timeline, nowMs = Date.now()) {
  if (!summary) return summary;

  const comparison = evaluateCargoScheduleComparison({
    openingHatchStartAt: timeline.openingHatchStartAt,
    tbAt: timeline.tbAt,
    dockingStartTime: timeline.dockingStartTime,
    etcMs: timeline.etcMs,
    movedQty: summary.movedQty,
    siQty: summary.siQty,
    nowMs,
  });

  return {
    ...summary,
    ...comparison,
  };
}
