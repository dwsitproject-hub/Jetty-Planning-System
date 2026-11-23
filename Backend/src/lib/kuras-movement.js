/**
 * Movement type (Normal / Kuras) for cargo segments.
 * A closed segment is auto-tagged Kuras when the port's rule matches: quantity remaining
 * before the segment starts is under X% of the SI plan, and/or its rate is under Y MT/h.
 * Manual tags are never changed here; the reason payload is rendered per locale on the client.
 */

export const MOVEMENT_TYPES = ['normal', 'kuras'];

const round = (n, dp) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/**
 * Payload value → undefined (keep stored tag), 'auto', or a manual movement type.
 * @returns {{ ok: true, value: undefined|'auto'|'normal'|'kuras' } | { ok: false, error: string }}
 */
export function parseMovementTypeInput(raw, lineIndex) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: undefined };
  const v = String(raw).trim().toLowerCase();
  if (v === 'auto' || MOVEMENT_TYPES.includes(v)) return { ok: true, value: v };
  return { ok: false, error: `cargoLoadLines[${lineIndex}].movementType must be auto, normal or kuras` };
}

/** Commodity-specific rule first, then the port default. */
export function pickKurasRule(rules, commodityId) {
  const list = Array.isArray(rules) ? rules : [];
  if (commodityId != null) {
    const specific = list.find((r) => !r.isDefault && (r.commodityIds || []).map(String).includes(String(commodityId)));
    if (specific) return specific;
  }
  return list.find((r) => r.isDefault) || null;
}

function ruleSummary(rule) {
  return {
    remainingLimit: Number(rule.remainingPctBelow),
    rateLimit: Number(rule.rateMtPerHourBelow),
    match: rule.matchMode === 'or' ? 'or' : 'and',
    ruleLabel: rule.isDefault ? null : (rule.commodityLabels || []).join(', ') || null,
  };
}

/**
 * @param {{ remainingPct: number|null, rateMtPerHour: number|null, isOpen: boolean, rule: object|null }} input
 * @returns {{ movementType: 'normal'|'kuras'|null, reason: object }}
 */
export function evaluateKurasSegment({ remainingPct, rateMtPerHour, isOpen, rule }) {
  if (isOpen) return { movementType: null, reason: { code: 'open' } };
  if (!rule || !rule.isActive) return { movementType: 'normal', reason: { code: 'noRule' } };
  const limits = ruleSummary(rule);
  if (remainingPct == null) return { movementType: 'normal', reason: { code: 'noPlan', ...limits } };
  if (rateMtPerHour == null) return { movementType: 'normal', reason: { code: 'noMtRate', ...limits } };
  const remainingHit = remainingPct < limits.remainingLimit;
  const rateHit = rateMtPerHour < limits.rateLimit;
  const kuras = limits.match === 'or' ? remainingHit || rateHit : remainingHit && rateHit;
  return {
    movementType: kuras ? 'kuras' : 'normal',
    reason: {
      code: kuras ? 'kuras' : 'normal',
      remainingPct: round(remainingPct, 1),
      rateMtPerHour: round(rateMtPerHour, 1),
      remainingHit,
      rateHit,
      ...limits,
    },
  };
}

/**
 * Auto-tag every segment of a voyage. Remaining is measured per product before each segment
 * starts (segments of the same product in start order); whole-SI plan when the line has no product.
 * @param {{
 *   lines: Array<{ id: number, qty: number|null, startedAt: string, endedAt: string|null, commodityId: number|null }>,
 *   siQty: number|null,
 *   siProducts: Array<{ commodityId: number, plannedQty: number|null }>,
 *   rules: Array<object>,
 *   mtFactorFor: (commodityId: number|null) => number|null,
 * }} input
 * @returns {Map<number, { movementType: string|null, reason: object, plannedQty: number|null,
 *   movedBefore: number, mtFactor: number|null }>} plan, qty moved before the segment and MT factor
 *   are passed on so the kuras start point inside the segment can be found per hour.
 */
export function classifyKurasSegments({ lines, siQty, siProducts, rules, mtFactorFor }) {
  const plannedBy = new Map((siProducts || []).map((p) => [String(p.commodityId), p.plannedQty]));
  const sorted = [...(lines || [])].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime() || a.id - b.id
  );
  const movedBy = new Map();
  const out = new Map();
  for (const line of sorted) {
    const key = line.commodityId != null ? String(line.commodityId) : '*';
    const planned = line.commodityId != null ? plannedBy.get(key) ?? siQty : siQty;
    const movedBefore = movedBy.get(key) || 0;
    const qty = Number(line.qty) || 0;
    movedBy.set(key, movedBefore + qty);

    const remainingPct =
      planned != null && Number(planned) > 0 ? Math.max(0, ((Number(planned) - movedBefore) / Number(planned)) * 100) : null;

    let rateMtPerHour = null;
    const startMs = new Date(line.startedAt).getTime();
    const endMs = line.endedAt ? new Date(line.endedAt).getTime() : NaN;
    const factor = mtFactorFor(line.commodityId);
    if (factor != null && qty > 0 && Number.isFinite(endMs) && endMs > startMs) {
      rateMtPerHour = (qty * factor) / ((endMs - startMs) / 3600000);
    }

    out.set(line.id, {
      ...evaluateKurasSegment({
        remainingPct,
        rateMtPerHour,
        isOpen: !line.endedAt,
        rule: pickKurasRule(rules, line.commodityId),
      }),
      plannedQty: planned != null ? Number(planned) : null,
      movedBefore,
      mtFactor: factor,
    });
  }
  return out;
}
