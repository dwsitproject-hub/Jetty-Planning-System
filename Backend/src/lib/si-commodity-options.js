/**
 * SI commodity options for cargo load lines (aggregate breakdown by commodity_id).
 */

/**
 * @param {import('pg').Pool | import('pg').PoolClient} client
 * @param {number} shippingInstructionId
 */
export async function getSiCommodityOptions(client, shippingInstructionId) {
  const siId = parseInt(String(shippingInstructionId), 10);
  if (!Number.isFinite(siId) || siId <= 0) return [];

  const r = await client.query(
    `SELECT b.commodity_id,
            sc.name,
            sc.short_name,
            SUM(b.qty::numeric) AS planned_qty,
            array_agg(DISTINCT m.code) FILTER (WHERE m.code IS NOT NULL) AS metric_codes
     FROM shipping_instruction_breakdown b
     JOIN si_commodities sc ON sc.id = b.commodity_id AND sc.deleted_at IS NULL
     LEFT JOIN metric m ON m.id = b.metric_id AND m.deleted_at IS NULL
     WHERE b.shipping_instruction_id = $1 AND b.deleted_at IS NULL
     GROUP BY b.commodity_id, sc.name, sc.short_name
     ORDER BY MIN(b.line_order) ASC NULLS LAST, MIN(b.id) ASC`,
    [siId]
  );

  return r.rows.map((row) => {
    const codes = Array.isArray(row.metric_codes) ? row.metric_codes.filter(Boolean) : [];
    const uniqueCodes = [...new Set(codes.map((c) => String(c).toUpperCase()))];
    const metricCode = uniqueCodes.length === 1 ? uniqueCodes[0] : uniqueCodes[0] || 'MT';
    return {
      commodityId: Number(row.commodity_id),
      name: row.name ?? '',
      shortName: row.short_name ?? row.name ?? String(row.commodity_id),
      plannedQty: row.planned_qty != null ? Number(row.planned_qty) : null,
      metricCode,
      metricMixed: uniqueCodes.length > 1,
    };
  });
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} client
 * @param {number} operationId
 */
export async function getSiCommodityOptionsForOperation(client, operationId) {
  const opId = parseInt(String(operationId), 10);
  if (!Number.isFinite(opId) || opId <= 0) return [];
  const r = await client.query(
    `SELECT shipping_instruction_id FROM operations WHERE id = $1 AND deleted_at IS NULL`,
    [opId]
  );
  const siId = r.rows[0]?.shipping_instruction_id;
  if (siId == null) return [];
  return getSiCommodityOptions(client, siId);
}

/**
 * @param {string|number|null|undefined} rawCommodityId
 * @param {Array<{ commodityId: number }>} siCommodityOptions
 * @param {{ lineIndex?: number }} ctx
 */
export function normalizeLoadLineCommodityId(rawCommodityId, siCommodityOptions, ctx = {}) {
  const lineIndex = ctx.lineIndex ?? 0;
  const options = Array.isArray(siCommodityOptions) ? siCommodityOptions : [];
  const raw =
    rawCommodityId !== undefined && rawCommodityId !== null && String(rawCommodityId).trim() !== ''
      ? String(rawCommodityId).trim()
      : null;

  if (options.length === 0) {
    const n = raw != null ? parseInt(raw, 10) : null;
    return {
      commodityId: Number.isFinite(n) && n > 0 ? n : null,
    };
  }

  if (options.length === 1) {
    return { commodityId: Number(options[0].commodityId) };
  }

  if (!raw) {
    return {
      error: {
        ok: false,
        status: 400,
        error: `cargoLoadLines[${lineIndex}].commodityId is required for multi-commodity shipping instructions`,
      },
    };
  }

  const match = options.find((o) => String(o.commodityId) === raw);
  if (!match) {
    return {
      error: {
        ok: false,
        status: 400,
        error: `cargoLoadLines[${lineIndex}].commodityId is not valid for this operation`,
      },
    };
  }

  return { commodityId: Number(match.commodityId) };
}

/**
 * @param {object} line
 * @param {Map<number, object>} optionsById
 */
export function enrichCargoLoadLineCommodityDisplay(line, optionsById) {
  if (!line || !optionsById || !(optionsById instanceof Map)) return line;
  const cid =
    line.commodityId != null && line.commodityId !== ''
      ? parseInt(String(line.commodityId), 10)
      : null;
  if (!Number.isFinite(cid) || cid <= 0) return line;
  const opt = optionsById.get(cid);
  if (!opt) return line;
  return {
    ...line,
    commodityName: opt.name,
    commodityShortDisplay: opt.shortName,
    plannedQty: opt.plannedQty,
    metricCode: opt.metricCode,
  };
}
