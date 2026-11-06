/**
 * Pure helpers: before/after comparison of hourly cargo progress for an ATG resync simulation.
 */

const QTY_EPSILON = 0.0005;

function rowKey(row) {
  return `${row.loadLineId}|${new Date(row.hourStart).toISOString()}`;
}

function qtyOf(row) {
  return row ? Number(row.qtyMoved) || 0 : 0;
}

/**
 * One entry per (load line, hour) present before or after, with the change flagged.
 * @param {Array<{ loadLineId: number, hourStart: string, hourEnd: string, qtyMoved: number, movementStatus: string }>} before
 * @param {Array<{ loadLineId: number, hourStart: string, hourEnd: string, qtyMoved: number, movementStatus: string }>} after
 */
export function diffHourlyRows(before, after) {
  const beforeByKey = new Map((before || []).map((r) => [rowKey(r), r]));
  const afterByKey = new Map((after || []).map((r) => [rowKey(r), r]));
  const keys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);

  const out = [];
  for (const key of keys) {
    const b = beforeByKey.get(key);
    const a = afterByKey.get(key);
    const ref = a || b;
    const qtyBefore = qtyOf(b);
    const qtyAfter = qtyOf(a);
    const statusBefore = b?.movementStatus ?? null;
    const statusAfter = a?.movementStatus ?? null;
    out.push({
      loadLineId: Number(ref.loadLineId),
      hourStart: new Date(ref.hourStart).toISOString(),
      hourEnd: new Date(ref.hourEnd).toISOString(),
      qtyBefore,
      qtyAfter,
      qtyDelta: qtyAfter - qtyBefore,
      statusBefore,
      statusAfter,
      changed: Math.abs(qtyAfter - qtyBefore) > QTY_EPSILON || statusBefore !== statusAfter,
    });
  }
  return out.sort((x, y) => x.hourStart.localeCompare(y.hourStart) || x.loadLineId - y.loadLineId);
}

/**
 * Quantity change per commodity plus a grand total.
 * @param {ReturnType<typeof diffHourlyRows>} hourly
 * @param {Map<number, string>} commodityByLine load line id -> commodity label
 */
export function summarizeQuantityByCommodity(hourly, commodityByLine) {
  const byCommodity = new Map();
  for (const row of hourly) {
    const commodity = commodityByLine.get(row.loadLineId) || '—';
    let s = byCommodity.get(commodity);
    if (!s) {
      s = { commodity, qtyBefore: 0, qtyAfter: 0, qtyDelta: 0, hoursChanged: 0, hoursTotal: 0 };
      byCommodity.set(commodity, s);
    }
    s.qtyBefore += row.qtyBefore;
    s.qtyAfter += row.qtyAfter;
    s.qtyDelta += row.qtyDelta;
    s.hoursTotal += 1;
    if (row.changed) s.hoursChanged += 1;
  }
  const list = [...byCommodity.values()];
  const total = list.reduce(
    (t, s) => ({
      qtyBefore: t.qtyBefore + s.qtyBefore,
      qtyAfter: t.qtyAfter + s.qtyAfter,
      qtyDelta: t.qtyDelta + s.qtyDelta,
      hoursChanged: t.hoursChanged + s.hoursChanged,
      hoursTotal: t.hoursTotal + s.hoursTotal,
    }),
    { qtyBefore: 0, qtyAfter: 0, qtyDelta: 0, hoursChanged: 0, hoursTotal: 0 }
  );
  return { byCommodity: list, total };
}

/**
 * @param {string[]} targetGapKeys
 * @param {Array<{ gapKey: string }>} gapsAfter
 */
export function splitGapOutcome(targetGapKeys, gapsAfter) {
  const remaining = new Set((gapsAfter || []).map((g) => g.gapKey));
  return {
    closedGapKeys: (targetGapKeys || []).filter((k) => !remaining.has(k)),
    stillMissingKeys: (targetGapKeys || []).filter((k) => remaining.has(k)),
  };
}

/**
 * Daily progress rows that differ, with the net quantity change.
 * @param {Array<{ loadLineId: number|null, progressDate: string, qtyMoved: number }>} before
 * @param {Array<{ loadLineId: number|null, progressDate: string, qtyMoved: number }>} after
 */
export function diffDailyRows(before, after) {
  const key = (r) => `${r.loadLineId}|${r.progressDate}`;
  const beforeByKey = new Map((before || []).map((r) => [key(r), r]));
  const afterByKey = new Map((after || []).map((r) => [key(r), r]));
  let changed = 0;
  let totalDelta = 0;
  for (const k of new Set([...beforeByKey.keys(), ...afterByKey.keys()])) {
    const delta = qtyOf(afterByKey.get(k)) - qtyOf(beforeByKey.get(k));
    if (Math.abs(delta) > QTY_EPSILON) {
      changed += 1;
      totalDelta += delta;
    }
  }
  return { changed, totalDelta };
}
