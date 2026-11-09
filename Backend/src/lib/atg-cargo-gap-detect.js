/**
 * Pure helpers: ATG sample coverage gaps during cargo load-line windows.
 */

export const DEFAULT_MIN_GAP_MS = 30 * 60 * 1000;
export const DEFAULT_LOOKBACK_DAYS = 30;
export const MAX_LIST_OPERATIONS = 50;

/**
 * @param {Array<{ startAt: string, endAt: string }>} intervals
 * @returns {Array<{ startAt: string, endAt: string }>}
 */
export function mergeAdjacentIntervals(intervals) {
  const sorted = [...(intervals || [])]
    .filter((i) => i?.startAt && i?.endAt)
    .map((i) => ({
      startAt: new Date(i.startAt).toISOString(),
      endAt: new Date(i.endAt).toISOString(),
    }))
    .filter((i) => new Date(i.endAt).getTime() > new Date(i.startAt).getTime())
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

  if (!sorted.length) return [];

  const out = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1];
    const cur = sorted[i];
    const prevEnd = new Date(prev.endAt).getTime();
    const curStart = new Date(cur.startAt).getTime();
    if (curStart <= prevEnd) {
      prev.endAt =
        new Date(cur.endAt).getTime() > prevEnd ? cur.endAt : prev.endAt;
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/**
 * @param {string} loadLineId
 * @param {string} startAt
 * @param {string} endAt
 */
export function buildGapKey(loadLineId, startAt, endAt) {
  return `${loadLineId}|${new Date(startAt).toISOString()}|${new Date(endAt).toISOString()}`;
}

/**
 * @param {number} startMs
 * @param {number} endMs
 */
export function gapDurationMinutes(startMs, endMs) {
  return Math.max(0, Math.round((endMs - startMs) / 60000));
}

/**
 * Gaps from sorted sample timestamps inside [windowStart, windowEnd].
 * @param {string[]} sampledAtIsoList sorted ascending
 * @param {string|Date} windowStart
 * @param {string|Date} windowEnd
 * @param {number} minGapMs
 */
export function gapsFromSampleTimeline(sampledAtIsoList, windowStart, windowEnd, minGapMs) {
  const wStart = new Date(windowStart).getTime();
  const wEnd = new Date(windowEnd).getTime();
  if (!Number.isFinite(wStart) || !Number.isFinite(wEnd) || wEnd <= wStart) return [];

  const threshold = Number.isFinite(minGapMs) && minGapMs > 0 ? minGapMs : DEFAULT_MIN_GAP_MS;
  const times = (sampledAtIsoList || [])
    .map((t) => new Date(t).getTime())
    .filter((t) => Number.isFinite(t) && t >= wStart && t <= wEnd)
    .sort((a, b) => a - b);

  const gaps = [];
  let cursor = wStart;

  if (times.length === 0) {
    if (wEnd - wStart >= threshold) {
      gaps.push({
        startAt: new Date(wStart).toISOString(),
        endAt: new Date(wEnd).toISOString(),
        durationMinutes: gapDurationMinutes(wStart, wEnd),
      });
    }
    return gaps;
  }

  for (const t of times) {
    if (t - cursor >= threshold) {
      gaps.push({
        startAt: new Date(cursor).toISOString(),
        endAt: new Date(t).toISOString(),
        durationMinutes: gapDurationMinutes(cursor, t),
      });
    }
    cursor = Math.max(cursor, t);
  }

  if (wEnd - cursor >= threshold) {
    gaps.push({
      startAt: new Date(cursor).toISOString(),
      endAt: new Date(wEnd).toISOString(),
      durationMinutes: gapDurationMinutes(cursor, wEnd),
    });
  }

  return gaps;
}

/**
 * @param {Array<{ hourStart: string, hourEnd: string, movementStatus?: string }>} buckets
 */
export function gapsFromIncompleteHourlyBuckets(buckets) {
  const incomplete = (buckets || []).filter(
    (b) => String(b?.movementStatus || b?.movement_status || '').toLowerCase() === 'incomplete'
  );
  if (!incomplete.length) return [];

  const sorted = [...incomplete].sort(
    (a, b) => new Date(a.hourStart).getTime() - new Date(b.hourStart).getTime()
  );

  const raw = [];
  let runStart = sorted[0].hourStart;
  let runEnd = sorted[0].hourEnd;

  for (let i = 1; i < sorted.length; i++) {
    const b = sorted[i];
    const prevEndMs = new Date(runEnd).getTime();
    const startMs = new Date(b.hourStart).getTime();
    if (startMs <= prevEndMs) {
      runEnd = new Date(b.hourEnd).getTime() > prevEndMs ? b.hourEnd : runEnd;
    } else {
      raw.push({ startAt: runStart, endAt: runEnd });
      runStart = b.hourStart;
      runEnd = b.hourEnd;
    }
  }
  raw.push({ startAt: runStart, endAt: runEnd });

  return raw.map((g) => ({
    startAt: new Date(g.startAt).toISOString(),
    endAt: new Date(g.endAt).toISOString(),
    durationMinutes: gapDurationMinutes(new Date(g.startAt).getTime(), new Date(g.endAt).getTime()),
  }));
}

/**
 * Union gaps across tanks (any missing coverage on any tank).
 * @param {Array<Array<{ startAt: string, endAt: string, durationMinutes?: number }>>} perTankGaps
 */
export function rollupLineGaps(perTankGaps) {
  const merged = mergeAdjacentIntervals((perTankGaps || []).flat());
  return merged.map((g) => ({
    ...g,
    durationMinutes: gapDurationMinutes(new Date(g.startAt).getTime(), new Date(g.endAt).getTime()),
  }));
}

/**
 * @param {Array<{ loadLineId: number|string, gaps: Array<{ startAt: string, endAt: string, durationMinutes?: number }>, commodity?: string, tankCodes?: string[] }>} lines
 */
export function rollupOperationGaps(lines) {
  const allIntervals = [];
  const enriched = [];

  for (const line of lines || []) {
    for (const g of line.gaps || []) {
      allIntervals.push(g);
      enriched.push({
        ...g,
        loadLineId: line.loadLineId,
        commodity: line.commodity ?? null,
        tankCodes: line.tankCodes ?? [],
        gapKey: buildGapKey(line.loadLineId, g.startAt, g.endAt),
      });
    }
  }

  const union = rollupLineGaps([allIntervals]);
  let longestGapMinutes = 0;
  let totalGapMinutes = 0;
  for (const g of union) {
    const d = g.durationMinutes ?? 0;
    totalGapMinutes += d;
    if (d > longestGapMinutes) longestGapMinutes = d;
  }

  const segmentCountWithGaps = (lines || []).filter((l) => (l.gaps || []).length > 0).length;

  return {
    gaps: enriched,
    unionGaps: union,
    longestGapMinutes,
    totalGapMinutes,
    segmentCountWithGaps,
  };
}
