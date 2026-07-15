/**
 * Format SI breakdown lines for overview table columns (Commodity, Total Qty).
 */

export const EMPTY_CARGO_DISPLAY = '—';

export function formatQtyNumber(qty) {
  const n = Number(qty);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('id-ID', { maximumFractionDigits: 3 });
}

/**
 * @param {Array<{ commodityId?: number, commodity_id?: number, commodityName?: string, commodity_name?: string, commodityShortName?: string, commodity_short_name?: string, metricId?: number, metric_id?: number, metricCode?: string, metric_code?: string, qty?: number }>} breakdownRows
 */
export function formatSiCargoDisplay(breakdownRows) {
  if (!Array.isArray(breakdownRows) || breakdownRows.length === 0) {
    return {
      commodityDisplay: EMPTY_CARGO_DISPLAY,
      commodityShortDisplay: EMPTY_CARGO_DISPLAY,
      totalQtyDisplay: EMPTY_CARGO_DISPLAY,
    };
  }

  const byCommodity = new Map();
  const commodityOrder = [];

  for (const row of breakdownRows) {
    const cid = row.commodityId ?? row.commodity_id;
    const key = cid != null ? String(cid) : `name:${(row.commodityName ?? row.commodity_name ?? '').trim()}`;
    const name = (row.commodityName ?? row.commodity_name ?? '').trim();
    const shortName = (row.commodityShortName ?? row.commodity_short_name ?? '').trim();
    if (!byCommodity.has(key)) {
      byCommodity.set(key, { name, shortName, lines: [] });
      commodityOrder.push(key);
    }
    byCommodity.get(key).lines.push(row);
  }

  const commodityNames = [];
  const commodityShortNames = [];
  for (const key of commodityOrder) {
    const { name, shortName } = byCommodity.get(key);
    if (name && !commodityNames.includes(name)) commodityNames.push(name);
    const shortOrFull = shortName || name;
    if (shortOrFull && !commodityShortNames.includes(shortOrFull)) commodityShortNames.push(shortOrFull);
  }
  const commodityDisplay = commodityNames.length ? commodityNames.join(' · ') : EMPTY_CARGO_DISPLAY;
  const commodityShortDisplay = commodityShortNames.length
    ? commodityShortNames.join(' · ')
    : EMPTY_CARGO_DISPLAY;

  const qtyParts = [];
  for (const key of commodityOrder) {
    const { name, lines } = byCommodity.get(key);
    const byMetric = new Map();
    const metricOrder = [];
    for (const line of lines) {
      const mid = line.metricId ?? line.metric_id ?? 'unknown';
      const code = (line.metricCode ?? line.metric_code ?? '').trim() || '?';
      const mk = String(mid);
      if (!byMetric.has(mk)) {
        byMetric.set(mk, { code, sum: 0 });
        metricOrder.push(mk);
      }
      byMetric.get(mk).sum += Number(line.qty) || 0;
    }
    for (const mk of metricOrder) {
      const { code, sum } = byMetric.get(mk);
      const formatted = `${formatQtyNumber(sum)} ${code}`;
      qtyParts.push(name ? `${name} ${formatted}` : formatted);
    }
  }

  const totalQtyDisplay = qtyParts.length ? qtyParts.join('\n') : EMPTY_CARGO_DISPLAY;
  return { commodityDisplay, commodityShortDisplay, totalQtyDisplay };
}

export function buildCargoBreakdownSummary(shippingInstructionId, referenceNumber, breakdownRows) {
  const { commodityDisplay, commodityShortDisplay, totalQtyDisplay } = formatSiCargoDisplay(breakdownRows);
  return {
    shippingInstructionId: shippingInstructionId != null ? Number(shippingInstructionId) : null,
    referenceNumber:
      (referenceNumber || '').trim() ||
      (shippingInstructionId != null ? `SI-${shippingInstructionId}` : null),
    commodityDisplay,
    commodityShortDisplay,
    totalQtyDisplay,
  };
}

/**
 * @param {import('pg').Pool} pool
 * @param {number[]} siIds
 * @returns {Promise<Map<number, object[]>>}
 */
export async function loadBreakdownBySiIds(pool, siIds) {
  const ids = [...new Set(siIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  const map = new Map();
  if (ids.length === 0) return map;

  const r = await pool.query(
    `SELECT b.shipping_instruction_id,
            b.commodity_id,
            sc.name AS commodity_name,
            sc.short_name AS commodity_short_name,
            b.metric_id,
            m.code AS metric_code,
            b.qty,
            b.line_order
     FROM public.shipping_instruction_breakdown b
     JOIN public.si_commodities sc ON sc.id = b.commodity_id AND sc.deleted_at IS NULL
     JOIN public.metric m ON m.id = b.metric_id AND m.deleted_at IS NULL
     WHERE b.deleted_at IS NULL
       AND b.shipping_instruction_id = ANY($1::bigint[])
     ORDER BY b.shipping_instruction_id ASC, b.line_order ASC, b.id ASC`,
    [ids]
  );

  for (const row of r.rows) {
    const siId = Number(row.shipping_instruction_id);
    if (!map.has(siId)) map.set(siId, []);
    map.get(siId).push({
      commodityId: row.commodity_id,
      commodityName: row.commodity_name,
      commodityShortName: row.commodity_short_name,
      metricId: row.metric_id,
      metricCode: row.metric_code,
      qty: row.qty != null ? Number(row.qty) : 0,
      lineOrder: row.line_order,
    });
  }
  return map;
}

/**
 * @param {object} row - SQL row with shipping_instruction_id, reference_number
 * @param {Map<number, object[]>} breakdownMap
 */
export function attachCargoDisplayToRow(row, breakdownMap) {
  const siId =
    row.shipping_instruction_id != null ? Number(row.shipping_instruction_id) : null;
  const breakdown = siId != null ? breakdownMap.get(siId) || [] : [];
  const { commodityDisplay, commodityShortDisplay, totalQtyDisplay } = formatSiCargoDisplay(breakdown);
  const ref = row.reference_number || (siId != null ? `SI-${siId}` : null);
  const commodityIds = [
    ...new Set(
      breakdown
        .map((b) => b.commodityId)
        .filter((id) => id != null && Number.isFinite(Number(id)) && Number(id) > 0)
        .map(Number)
    ),
  ];
  return {
    ...row,
    commodity_display: commodityDisplay,
    commodity_short_display: commodityShortDisplay,
    total_qty_display: totalQtyDisplay,
    commodity_ids: commodityIds,
    cargo_breakdown_summary:
      siId != null ? [buildCargoBreakdownSummary(siId, ref, breakdown)] : [],
  };
}

/**
 * @param {import('pg').Pool} pool
 * @param {object[]} rows
 */
export async function enrichRowsWithCargoDisplay(pool, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const siIds = rows
    .map((r) => r.shipping_instruction_id)
    .filter((id) => id != null);
  const breakdownMap = await loadBreakdownBySiIds(pool, siIds);
  return rows.map((r) => attachCargoDisplayToRow(r, breakdownMap));
}
