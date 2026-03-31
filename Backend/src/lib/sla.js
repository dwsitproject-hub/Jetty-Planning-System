/**
 * SLA duration calculation — Phase 3.
 * Formula: SLA = Q1 + Q2 + C + sum(V / (effective_rate * buffer)) + ((n-1) * S)
 * Per-commodity rate + metric from standard_rates; buffer from global sla_config only.
 */
import { pool } from '../db.js';

const SLA_CONFIG_ID = 1;

const RATE_METRICS = new Set(['KLPH', 'MTPH', 'MTPD']);

/** Convert stored rate to "per hour" basis for the transfer term (volume must match metric). */
function effectiveRatePerHour(rateValue, rateMetric) {
  const r = Number(rateValue);
  if (!Number.isFinite(r) || r <= 0) return 0;
  const m = String(rateMetric || 'MTPH').toUpperCase();
  if (!RATE_METRICS.has(m)) return r;
  if (m === 'MTPD') return r / 24;
  return r;
}

export async function computeSlaHours(operationId) {
  const [configRes, materialsRes] = await Promise.all([
    pool.query(
      `SELECT q1_hours, q2_hours, c_hours, s_hours, buffer_default FROM sla_config WHERE id = $1 AND deleted_at IS NULL`,
      [SLA_CONFIG_ID],
    ),
    pool.query(
      `SELECT material_key, volume FROM operation_materials WHERE operation_id = $1 AND deleted_at IS NULL`,
      [operationId],
    ),
  ]);
  const config = configRes.rows[0];
  if (!config) throw new Error('SLA config not found');
  const Q1 = Number(config.q1_hours);
  const Q2 = Number(config.q2_hours);
  const C = Number(config.c_hours);
  const S = Number(config.s_hours);
  const bufferDefault = Number(config.buffer_default);

  const materials = materialsRes.rows;
  if (materials.length === 0) {
    return Q1 + Q2 + C;
  }

  const materialKeys = [...new Set(materials.map((m) => m.material_key))];
  const ratesRes = await pool.query(
    `SELECT sr.rate_value, sr.rate_metric,
            LOWER(TRIM(sr.material_key)) AS mk,
            LOWER(TRIM(COALESCE(sc.name, sr.material_key))) AS lk
     FROM standard_rates sr
     LEFT JOIN si_commodities sc ON sc.id = sr.commodity_id AND sc.deleted_at IS NULL
     WHERE sr.deleted_at IS NULL`,
  );
  const ratesByKeyLower = {};
  for (const r of ratesRes.rows) {
    const entry = {
      rateValue: Number(r.rate_value),
      rateMetric: r.rate_metric || 'MTPH',
    };
    ratesByKeyLower[r.mk] = entry;
    ratesByKeyLower[r.lk] = entry;
  }

  let sumPart = 0;
  for (const m of materials) {
    const vol = Number(m.volume);
    const lk = String(m.material_key || '').toLowerCase().trim();
    const rec = lk ? ratesByKeyLower[lk] : null;
    if (!rec) continue;
    const hourly = effectiveRatePerHour(rec.rateValue, rec.rateMetric);
    if (hourly <= 0) continue;
    sumPart += vol / (hourly * bufferDefault);
  }
  const n = materialKeys.length;
  const penalty = (n - 1) * S;
  return Q1 + Q2 + C + sumPart + penalty;
}
