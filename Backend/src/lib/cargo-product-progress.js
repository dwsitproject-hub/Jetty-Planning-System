/**
 * Split a voyage's cargo progress into one row per product.
 * Returns nothing for a single-product call so existing screens stay as they are.
 */

function roundQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 1000) / 1000;
}

function labelOf(shortName, name) {
  const short = String(shortName ?? '').trim();
  if (short) return short;
  const full = String(name ?? '').trim();
  return full || null;
}

function avgRateTph(movedQty, firstAt, lastAt) {
  const qty = Number(movedQty) || 0;
  if (qty <= 0) return null;
  const startMs = firstAt ? new Date(firstAt).getTime() : NaN;
  const endMs = lastAt ? new Date(lastAt).getTime() : NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  const rate = qty / ((endMs - startMs) / 3600000);
  return Math.round(rate * 100) / 100;
}

function productAvgRate(row, nowMs) {
  let first = null;
  let lastClosed = null;
  let open = false;
  for (const seg of row.segments || []) {
    if (seg.startedAt && (!first || seg.startedAt < first)) first = seg.startedAt;
    if (seg.isOpen) {
      open = true;
      continue;
    }
    const end = seg.endedAt || seg.startedAt;
    if (end && (!lastClosed || end > lastClosed)) lastClosed = end;
  }
  const last = open ? new Date(nowMs).toISOString() : lastClosed;
  return avgRateTph(row.movedQty, first, last);
}

/**
 * @param {{
 *   siProducts?: Array<{ commodityId?: number, shortName?: string|null, name?: string|null, plannedQty?: number|null }>,
 *   lineMoved?: Array<{ commodityId?: number|null, shortName?: string|null, name?: string|null, movedQty?: number, isOpen?: boolean }>,
 *   canonicalMovedQty?: number|null,
 *   siMetric?: string,
 *   nowMs?: number,
 * }} input
 */
export function buildProductCargoProgress({
  siProducts = [],
  lineMoved = [],
  canonicalMovedQty = null,
  siMetric = 'MT',
  nowMs = Date.now(),
} = {}) {
  /** @type {Map<number, object>} */
  const byId = new Map();
  /** @type {object[]} */
  const order = [];

  const ensure = (commodityId, shortName, name) => {
    const id = Number(commodityId);
    if (!Number.isFinite(id) || id <= 0) return null;
    if (!byId.has(id)) {
      const row = {
        commodityId: id,
        shortName: labelOf(shortName, name),
        name: String(name ?? '').trim() || labelOf(shortName, name),
        plannedQty: null,
        movedQty: 0,
        isLive: false,
        siMetric: siMetric || 'MT',
        segments: [],
      };
      byId.set(id, row);
      order.push(row);
    }
    return byId.get(id);
  };

  for (const product of siProducts || []) {
    const row = ensure(product?.commodityId, product?.shortName, product?.name);
    if (!row) continue;
    const planned = Number(product?.plannedQty);
    if (Number.isFinite(planned)) row.plannedQty = planned;
  }

  let closedSum = 0;
  /** @type {Array<{ row: object, qty: number, isOpen: boolean }>} */
  const tagged = [];

  for (const line of lineMoved || []) {
    const qty = Number(line?.movedQty) || 0;
    const isOpen = Boolean(line?.isOpen);
    if (!isOpen) closedSum += qty;
    const row = ensure(line?.commodityId, line?.shortName, line?.name);
    if (!row) continue;
    tagged.push({ row, qty, isOpen });
    row.segments.push({
      startedAt: line.startedAt || null,
      endedAt: line.endedAt || null,
      isOpen,
    });
    if (!isOpen) row.movedQty += qty;
    if (isOpen) row.isLive = true;
  }

  const openTagged = tagged.filter((entry) => entry.isOpen);
  const canonical = Number(canonicalMovedQty);
  if (openTagged.length === 1 && Number.isFinite(canonical)) {
    const live = canonical - closedSum;
    if (live >= 0) openTagged[0].row.movedQty += live;
    else openTagged[0].row.movedQty += openTagged[0].qty;
  } else {
    for (const entry of openTagged) entry.row.movedQty += entry.qty;
  }

  const anyMovement = order.some((row) => row.movedQty > 0 || row.isLive);
  const visible = order.filter(
    (row) => (row.plannedQty != null && row.plannedQty > 0) || row.movedQty > 0 || row.isLive
  );
  if (!anyMovement || visible.length < 2) return [];

  return visible.map((row) => ({
    commodityId: row.commodityId,
    shortName: row.shortName,
    name: row.name,
    plannedQty: row.plannedQty,
    movedQty: roundQty(row.movedQty),
    isLive: row.isLive,
    avgRateTph: productAvgRate(row, nowMs),
    siMetric: row.siMetric,
  }));
}
