import { pool } from '../db.js';

let cache = null;

/**
 * Cached column set for `standard_rates` so the API works before/after migration 036
 * (rate_per_hour vs rate_value + rate_metric).
 */
export async function getStandardRatesSchema() {
  if (cache) return cache;
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'standard_rates'`,
  );
  if (rows.length === 0) {
    cache = {
      tableMissing: true,
      hasCommodityId: false,
      hasRateValue: false,
      hasRatePerHour: false,
      hasRateMetric: false,
    };
    return cache;
  }
  const c = new Set(rows.map((r) => r.column_name));
  cache = {
    tableMissing: false,
    hasCommodityId: c.has('commodity_id'),
    hasRateValue: c.has('rate_value'),
    hasRatePerHour: c.has('rate_per_hour'),
    hasRateMetric: c.has('rate_metric'),
  };
  return cache;
}

/** For tests or after migrations in the same process. */
export function resetStandardRatesSchemaCache() {
  cache = null;
}

/** JOIN condition linking si_commodities to standard_rates (one row per commodity when set). */
export function standardRatesCommodityJoinSql(schema) {
  if (schema.hasCommodityId) {
    return 'sr.commodity_id = c.id';
  }
  return 'LOWER(TRIM(sr.material_key)) = LOWER(TRIM(c.name))';
}

/** SELECT fragments — aliased as rate_value / rate_metric for mappers. */
export function standardRatesSelectAliases(schema) {
  if (schema.tableMissing) {
    return { rateValue: 'NULL::numeric', rateMetric: `'MTPH'::text` };
  }
  const rateValue = schema.hasRateValue
    ? 'sr.rate_value'
    : schema.hasRatePerHour
      ? 'sr.rate_per_hour'
      : 'NULL::numeric';
  const rateMetric = schema.hasRateMetric ? 'sr.rate_metric' : `'MTPH'::text`;
  return { rateValue, rateMetric };
}

export async function insertStandardRateForCommodity(client, schema, { commodityId, materialKey, rateNum, metric }) {
  if (schema.tableMissing) {
    throw new Error('standard_rates table not found');
  }
  if (schema.hasRateValue && schema.hasRateMetric) {
    await client.query(
      `INSERT INTO standard_rates (commodity_id, material_key, rate_value, rate_metric)
       VALUES ($1, $2, $3, $4)`,
      [commodityId, materialKey, rateNum, metric],
    );
    return;
  }
  if (schema.hasCommodityId && schema.hasRatePerHour) {
    await client.query(
      `INSERT INTO standard_rates (commodity_id, material_key, rate_per_hour)
       VALUES ($1, $2, $3)`,
      [commodityId, materialKey, rateNum],
    );
    return;
  }
  if (!schema.hasCommodityId && schema.hasRatePerHour) {
    await client.query(
      `INSERT INTO standard_rates (material_key, rate_per_hour)
       VALUES ($1, $2)`,
      [materialKey, rateNum],
    );
    return;
  }
  throw new Error('standard_rates schema does not support commodity rates');
}

export async function updateStandardRateRow(client, schema, { rateId, rateN, metric, materialKey }) {
  if (schema.hasRateValue && schema.hasRateMetric) {
    await client.query(
      `UPDATE standard_rates
       SET rate_value = $1, rate_metric = $2, material_key = $3, updated_at = NOW()
       WHERE id = $4 AND deleted_at IS NULL`,
      [rateN, metric, materialKey, rateId],
    );
    return;
  }
  if (schema.hasRatePerHour) {
    await client.query(
      `UPDATE standard_rates
       SET rate_per_hour = $1, material_key = $2, updated_at = NOW()
       WHERE id = $3 AND deleted_at IS NULL`,
      [rateN, materialKey, rateId],
    );
    return;
  }
  throw new Error('standard_rates schema does not support rate updates');
}

export async function syncStandardRateMaterialKey(client, schema, { commodityId, newKey, previousName }) {
  if (schema.hasCommodityId) {
    await client.query(
      `UPDATE standard_rates
       SET material_key = $1, updated_at = NOW()
       WHERE commodity_id = $2 AND deleted_at IS NULL`,
      [newKey, commodityId],
    );
    return;
  }
  await client.query(
    `UPDATE standard_rates
     SET material_key = $1, updated_at = NOW()
     WHERE deleted_at IS NULL AND LOWER(TRIM(material_key)) = LOWER(TRIM($2))`,
    [newKey, previousName],
  );
}

export async function softDeleteStandardRatesForCommodity(client, schema, { commodityId, nameKey }) {
  if (schema.hasCommodityId) {
    await client.query(
      `UPDATE standard_rates SET deleted_at = NOW(), updated_at = NOW()
       WHERE commodity_id = $1 AND deleted_at IS NULL`,
      [commodityId],
    );
    return;
  }
  await client.query(
    `UPDATE standard_rates SET deleted_at = NOW(), updated_at = NOW()
     WHERE deleted_at IS NULL AND LOWER(TRIM(material_key)) = LOWER(TRIM($1))`,
    [nameKey],
  );
}

export async function findActiveStandardRateIdForCommodity(client, schema, commodityId) {
  if (schema.hasCommodityId) {
    const r = await client.query(
      `SELECT id FROM standard_rates WHERE commodity_id = $1 AND deleted_at IS NULL`,
      [commodityId],
    );
    return r.rows[0]?.id ?? null;
  }
  const r = await client.query(
    `SELECT sr.id
     FROM standard_rates sr
     JOIN si_commodities c ON c.id = $1 AND c.deleted_at IS NULL
       AND LOWER(TRIM(sr.material_key)) = LOWER(TRIM(c.name))
     WHERE sr.deleted_at IS NULL
     LIMIT 1`,
    [commodityId],
  );
  return r.rows[0]?.id ?? null;
}
