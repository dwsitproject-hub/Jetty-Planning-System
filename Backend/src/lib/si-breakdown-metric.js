/**
 * Validate SI breakdown lines against per-commodity default_metric_id (strict when configured).
 */

/**
 * @param {import('pg').Pool | import('pg').PoolClient} client
 * @param {Array<{ commodity_id?: number, commodityId?: number, metric_id?: number, metricId?: number }>} breakdown
 * @returns {Promise<string|null>}
 */
export async function validateBreakdownMetricRules(client, breakdown) {
  if (!Array.isArray(breakdown) || breakdown.length === 0) return null;

  const commodityIds = [
    ...new Set(
      breakdown
        .map((row) => parseInt(row.commodity_id ?? row.commodityId, 10))
        .filter((id) => !Number.isNaN(id) && id > 0)
    ),
  ];
  if (commodityIds.length === 0) return null;

  const r = await client.query(
    `SELECT c.id, c.name, c.default_metric_id, dm.code AS default_metric_code
     FROM si_commodities c
     LEFT JOIN metric dm ON dm.id = c.default_metric_id AND dm.deleted_at IS NULL
     WHERE c.id = ANY($1::bigint[]) AND c.deleted_at IS NULL`,
    [commodityIds]
  );
  const byId = new Map(r.rows.map((row) => [Number(row.id), row]));

  for (let i = 0; i < breakdown.length; i += 1) {
    const row = breakdown[i] || {};
    const cid = parseInt(row.commodity_id ?? row.commodityId, 10);
    const mid = parseInt(row.metric_id ?? row.metricId, 10);
    const commodity = byId.get(cid);
    if (!commodity?.default_metric_id) continue;
    if (mid !== Number(commodity.default_metric_id)) {
      const label = commodity.name || `commodity ${cid}`;
      const unit = commodity.default_metric_code || 'configured unit';
      return `Breakdown row ${i + 1}: ${label} must use ${unit} (configured default unit).`;
    }
  }
  return null;
}

/**
 * @param {Array<{ cargoType: string, unit: string }>} cargo
 * @param {Map<string, { id: number, default_metric_id?: number|null, default_metric_code?: string|null }>} commodityByShortName
 * @param {(raw: string) => string} normalizeCargoShortName
 * @returns {Array<{ field: string, issue: string, expected_unit?: string }>|null}
 */
export function validateIntegrationCargoMetricRules(cargo, commodityByShortName, normalizeCargoShortName) {
  const issues = [];
  for (let i = 0; i < cargo.length; i += 1) {
    const line = cargo[i];
    const commodity = commodityByShortName.get(normalizeCargoShortName(line.cargoType));
    if (!commodity?.default_metric_id) continue;
    const expected = String(commodity.default_metric_code || '').toUpperCase();
    const submitted = String(line.unit || '').toUpperCase();
    if (submitted !== expected) {
      issues.push({
        field: `cargo[${i}].unit`,
        issue: `${line.cargoType} must use ${expected} (configured default unit).`,
        expected_unit: expected,
      });
    }
  }
  return issues.length > 0 ? issues : null;
}
