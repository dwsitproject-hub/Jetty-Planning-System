/**
 * Distinct SI commodities with summed planned qty (one option per si_commodities.id).
 */

import { loadBreakdownBySiIds } from './siBreakdownDisplay.js';

/**
 * @param {Array<object>} breakdownRows
 * @returns {Array<{
 *   commodityId: number,
 *   name: string,
 *   shortName: string,
 *   plannedQty: number,
 *   metricCode: string,
 *   metricMixed: boolean,
 * }>}
 */
export function aggregateBreakdownByCommodity(breakdownRows) {
  if (!Array.isArray(breakdownRows) || breakdownRows.length === 0) return [];

  const byCommodity = new Map();
  const order = [];

  for (const row of breakdownRows) {
    const commodityId = Number(row.commodityId ?? row.commodity_id);
    if (!Number.isFinite(commodityId) || commodityId <= 0) continue;

    const key = commodityId;
    if (!byCommodity.has(key)) {
      byCommodity.set(key, {
        commodityId,
        name: (row.commodityName ?? row.commodity_name ?? '').trim(),
        shortName: (row.commodityShortName ?? row.commodity_short_name ?? '').trim(),
        plannedQty: 0,
        metricCodes: new Set(),
        lineOrder: row.lineOrder ?? row.line_order ?? 0,
      });
      order.push(key);
    }
    const entry = byCommodity.get(key);
    entry.plannedQty += Number(row.qty) || 0;
    const mc = (row.metricCode ?? row.metric_code ?? '').trim();
    if (mc) entry.metricCodes.add(mc);
    const lo = row.lineOrder ?? row.line_order ?? 0;
    if (lo < entry.lineOrder) entry.lineOrder = lo;
  }

  order.sort((a, b) => {
    const la = byCommodity.get(a).lineOrder;
    const lb = byCommodity.get(b).lineOrder;
    return la - lb || a - b;
  });

  return order.map((key) => {
    const e = byCommodity.get(key);
    const metricCodes = [...e.metricCodes];
    const metricCode = metricCodes[0] || 'MT';
    return {
      commodityId: e.commodityId,
      name: e.name || e.shortName || `Commodity ${e.commodityId}`,
      shortName: e.shortName || e.name || `Commodity ${e.commodityId}`,
      plannedQty: e.plannedQty,
      metricCode,
      metricMixed: metricCodes.length > 1,
    };
  });
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {number} shippingInstructionId
 */
export async function getSiCommodityOptions(db, shippingInstructionId) {
  const siId = Number(shippingInstructionId);
  if (!Number.isFinite(siId) || siId <= 0) return [];
  const map = await loadBreakdownBySiIds(db, [siId]);
  return aggregateBreakdownByCommodity(map.get(siId) || []);
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {number} operationId
 */
export async function resolveShippingInstructionIdForOperation(db, operationId) {
  const r = await db.query(
    `SELECT o.shipping_instruction_id
     FROM operations o
     WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [operationId]
  );
  const siId = r.rows[0]?.shipping_instruction_id;
  return siId != null ? Number(siId) : null;
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {number} operationId
 */
export async function getSiCommodityOptionsForOperation(db, operationId) {
  const siId = await resolveShippingInstructionIdForOperation(db, operationId);
  if (siId == null) return [];
  return getSiCommodityOptions(db, siId);
}

/**
 * @param {number|string|null|undefined} rawId
 * @param {ReturnType<typeof aggregateBreakdownByCommodity>} options
 * @param {{ lineIndex?: number }} [ctx]
 * @returns {{ commodityId: number } | { error: { ok: false, status: number, error: string } }}
 */
export function normalizeLoadLineCommodityId(rawId, options, { lineIndex = 0 } = {}) {
  const idx = Number.isFinite(Number(lineIndex)) ? Number(lineIndex) : 0;
  const prefix = `cargoLoadLines[${idx}]`;

  if (!Array.isArray(options) || options.length === 0) {
    return {
      error: {
        ok: false,
        status: 400,
        error: `${prefix}: shipping instruction has no commodity breakdown`,
      },
    };
  }

  const allowed = new Set(options.map((o) => Number(o.commodityId)));

  if (options.length === 1) {
    const only = Number(options[0].commodityId);
    if (rawId !== undefined && rawId !== null && String(rawId).trim() !== '') {
      const n = Number(rawId);
      if (!Number.isFinite(n) || n <= 0) {
        return {
          error: { ok: false, status: 400, error: `${prefix}.commodityId is invalid` },
        };
      }
      if (!allowed.has(n)) {
        return {
          error: {
            ok: false,
            status: 400,
            error: `${prefix}.commodityId is not on this shipping instruction`,
          },
        };
      }
      return { commodityId: n };
    }
    return { commodityId: only };
  }

  if (rawId === undefined || rawId === null || String(rawId).trim() === '') {
    return {
      error: {
        ok: false,
        status: 400,
        error: `${prefix}.commodityId is required when SI has multiple products`,
      },
    };
  }

  const n = Number(rawId);
  if (!Number.isFinite(n) || n <= 0) {
    return {
      error: { ok: false, status: 400, error: `${prefix}.commodityId is invalid` },
    };
  }
  if (!allowed.has(n)) {
    return {
      error: {
        ok: false,
        status: 400,
        error: `${prefix}.commodityId is not on this shipping instruction`,
      },
    };
  }
  return { commodityId: n };
}

/**
 * @param {Map<number, object>} optionsById
 * @param {object} line mapCargoLoadLineRow output
 */
export function enrichCargoLoadLineCommodityDisplay(line, optionsById) {
  if (!line) return line;
  const cid = line.commodityId != null ? Number(line.commodityId) : null;
  const opt = cid != null && optionsById?.get ? optionsById.get(cid) : null;
  return {
    ...line,
    commodityShortDisplay: opt?.shortName ?? null,
    commodityName: opt?.name ?? null,
    plannedQty: opt?.plannedQty ?? null,
    plannedMetricCode: opt?.metricCode ?? null,
  };
}
