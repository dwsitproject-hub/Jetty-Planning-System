/**
 * Pure helpers: acknowledgement annotation and System Health status for ATG cargo gaps.
 */
import { rollupLineGaps } from './atg-cargo-gap-detect.js';

/** An at-berth gap that ended within this window makes the check unhealthy. */
export const DEFAULT_RECENT_GAP_MS = 6 * 60 * 60 * 1000;

/**
 * @param {object} op scanned operation with gaps[]
 * @param {Map<string, { reason: string, acknowledgedAt: string, acknowledgedBy: string|null }>} ackByGapKey
 */
export function annotateAcknowledgedGaps(op, ackByGapKey) {
  const gaps = (op.gaps || []).map((g) => ({
    ...g,
    acknowledgement: ackByGapKey?.get(String(g.gapKey)) ?? null,
  }));
  const open = gaps.filter((g) => !g.acknowledgement);
  return {
    ...op,
    gaps,
    openGapCount: open.length,
    acknowledgedGapCount: gaps.length - open.length,
    openUnionGaps: rollupLineGaps([open]),
  };
}

/**
 * Only open (unacknowledged) gaps count.
 * @param {Array<{ atBerth?: boolean, openUnionGaps?: unknown[] }>} operations
 * @param {number} [recentWindowMs]
 * @param {number} [nowMs]
 */
export function deriveGapCheckStatus(operations, recentWindowMs = DEFAULT_RECENT_GAP_MS, nowMs = Date.now()) {
  const window = Number.isFinite(recentWindowMs) && recentWindowMs > 0 ? recentWindowMs : DEFAULT_RECENT_GAP_MS;
  let liveWithRecentGap = 0;
  let liveWithOlderGap = 0;
  let completedWithGaps = 0;

  for (const op of operations || []) {
    const open = op.openUnionGaps ?? op.unionGaps ?? [];
    if (!open.length) continue;
    if (!op.atBerth) {
      completedWithGaps += 1;
      continue;
    }
    const recent = open.some((g) => {
      const endMs = new Date(g.endAt).getTime();
      return !Number.isFinite(endMs) || nowMs - endMs <= window;
    });
    if (recent) liveWithRecentGap += 1;
    else liveWithOlderGap += 1;
  }

  let status = 'healthy';
  if (liveWithRecentGap > 0) status = 'unhealthy';
  else if (liveWithOlderGap > 0 || completedWithGaps > 0) status = 'degraded';
  return { status, liveWithRecentGap, liveWithOlderGap, completedWithGaps };
}
