/** Shared Dashboard V2 query helpers (date range + Purpose/Commodity filters). */

const VALID_PURPOSES = new Set(['Loading', 'Unloading']);

export function parseYmd(s) {
  if (!s || typeof s !== 'string') return null;
  const t = new Date(s.trim());
  return Number.isNaN(t.getTime()) ? null : t;
}

/**
 * Parse optional dashboard filter query params.
 * @returns {{ purposeCodes: string[]|null, commodityIds: number[]|null }}
 */
export function parseDashboardFilters(req) {
  const purposeRaw = req.query.purpose;
  const purposeParts = [];
  if (Array.isArray(purposeRaw)) {
    for (const p of purposeRaw) {
      if (typeof p === 'string') purposeParts.push(...p.split(','));
    }
  } else if (typeof purposeRaw === 'string' && purposeRaw.trim()) {
    purposeParts.push(...purposeRaw.split(','));
  }
  const purposeCodes = [...new Set(
    purposeParts.map((p) => p.trim()).filter((p) => VALID_PURPOSES.has(p))
  )];
  const purposeFilter = purposeCodes.length > 0 ? purposeCodes : null;

  const commodityRaw = req.query.commodity_id;
  const commodityParts = [];
  if (Array.isArray(commodityRaw)) {
    for (const c of commodityRaw) {
      if (typeof c === 'string') commodityParts.push(...c.split(','));
    }
  } else if (typeof commodityRaw === 'string' && commodityRaw.trim()) {
    commodityParts.push(...commodityRaw.split(','));
  }
  const commodityIds = [...new Set(
    commodityParts
      .map((c) => parseInt(String(c).trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0)
  )];
  const commodityFilter = commodityIds.length > 0 ? commodityIds : null;

  return { purposeCodes: purposeFilter, commodityIds: commodityFilter };
}

/**
 * UTC calendar-day window: [start_date 00:00 UTC, end_date + 1 day).
 * @returns {{ rangeStartIso: string, rangeEndExclusiveIso: string } | null}
 */
export function buildDateRangeWindow(startIso, endIso) {
  const start = parseYmd(startIso);
  const end = parseYmd(endIso);
  if (!start || !end || start > end) return null;
  const ws = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const we = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  we.setUTCDate(we.getUTCDate() + 1);
  return {
    rangeStartIso: ws.toISOString(),
    rangeEndExclusiveIso: we.toISOString(),
  };
}

/**
 * Split [start, end] inclusive into chunks of up to 7 days (UTC date arithmetic).
 */
export function buildWeekChunks(startIso, endIso) {
  const start = parseYmd(startIso);
  const end = parseYmd(endIso);
  if (!start || !end || start > end) return [];
  const chunks = [];
  const cur = new Date(start);
  const endDay = new Date(end);
  while (cur <= endDay) {
    const chunkStart = new Date(cur);
    const chunkEnd = new Date(cur);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 6);
    if (chunkEnd > endDay) chunkEnd.setTime(endDay.getTime());
    const ws = new Date(Date.UTC(chunkStart.getUTCFullYear(), chunkStart.getUTCMonth(), chunkStart.getUTCDate()));
    const we = new Date(Date.UTC(chunkEnd.getUTCFullYear(), chunkEnd.getUTCMonth(), chunkEnd.getUTCDate()));
    we.setUTCDate(we.getUTCDate() + 1);
    const snapshot = new Date(we.getTime() - 1);
    chunks.push({
      startDate: chunkStart.toISOString().slice(0, 10),
      endDate: chunkEnd.toISOString().slice(0, 10),
      rangeStartIso: ws.toISOString(),
      rangeEndExclusiveIso: we.toISOString(),
      snapshotIso: snapshot.toISOString(),
    });
    cur.setTime(chunkEnd.getTime());
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return chunks;
}

/**
 * Append purpose/commodity filters for shipment_plans queries.
 * @returns {{ filterSql: string, nextIndex: number }}
 */
export function appendPlanFilters(filterSql, params, startIndex, filters, planAlias = 'sp') {
  let i = startIndex;
  let sql = filterSql;
  if (filters.purposeCodes) {
    sql += ` AND EXISTS (
      SELECT 1 FROM si_purposes sppf
      WHERE sppf.id = ${planAlias}.purpose_id AND sppf.deleted_at IS NULL
        AND sppf.code = ANY($${i++}::text[])
    )`;
    params.push(filters.purposeCodes);
  }
  if (filters.commodityIds) {
    sql += ` AND EXISTS (
      SELECT 1 FROM shipping_instructions sif
      JOIN shipping_instruction_breakdown bf ON bf.shipping_instruction_id = sif.id AND bf.deleted_at IS NULL
      WHERE sif.shipment_plan_id = ${planAlias}.id
        AND sif.deleted_at IS NULL
        AND bf.commodity_id = ANY($${i++}::int[])
    )`;
    params.push(filters.commodityIds);
  }
  return { filterSql: sql, nextIndex: i };
}

/**
 * Append purpose/commodity filters for operation queries (via shipment_plan_id on SI).
 * @returns {{ filterSql: string, nextIndex: number }}
 */
export function appendOpPlanFilters(filterSql, params, startIndex, filters) {
  let i = startIndex;
  let sql = filterSql;
  if (filters.purposeCodes) {
    sql += ` AND EXISTS (
      SELECT 1 FROM shipment_plans spf
      JOIN si_purposes sppf ON sppf.id = spf.purpose_id AND sppf.deleted_at IS NULL
      WHERE spf.id = si.shipment_plan_id
        AND spf.deleted_at IS NULL
        AND sppf.code = ANY($${i++}::text[])
    )`;
    params.push(filters.purposeCodes);
  }
  if (filters.commodityIds) {
    sql += ` AND EXISTS (
      SELECT 1 FROM shipping_instructions sif
      JOIN shipping_instruction_breakdown bf ON bf.shipping_instruction_id = sif.id AND bf.deleted_at IS NULL
      WHERE sif.shipment_plan_id = si.shipment_plan_id
        AND sif.deleted_at IS NULL
        AND bf.commodity_id = ANY($${i++}::int[])
    )`;
    params.push(filters.commodityIds);
  }
  return { filterSql: sql, nextIndex: i };
}
