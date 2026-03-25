/**
 * SLA duration calculation — Phase 3.
 * Formula: SLA = Q1 + Q2 + C + sum(V_n / (Rate_n * Buffer_n)) + ((n-1) * S)
 */
import { pool } from '../db.js';

const SLA_CONFIG_ID = 1;

export async function computeSlaHours(operationId) {
  const [configRes, materialsRes] = await Promise.all([
    pool.query(
      `SELECT q1_hours, q2_hours, c_hours, s_hours, buffer_default FROM sla_config WHERE id = $1 AND deleted_at IS NULL`,
      [SLA_CONFIG_ID]
    ),
    pool.query(
      `SELECT material_key, volume FROM operation_materials WHERE operation_id = $1 AND deleted_at IS NULL`,
      [operationId]
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
    `SELECT material_key, rate_per_hour, buffer FROM standard_rates WHERE material_key = ANY($1) AND deleted_at IS NULL`,
    [materialKeys]
  );
  const ratesByKey = Object.fromEntries(
    ratesRes.rows.map((r) => [r.material_key, { rate: Number(r.rate_per_hour), buffer: Number(r.buffer) }])
  );

  let sumPart = 0;
  for (const m of materials) {
    const vol = Number(m.volume);
    const r = ratesByKey[m.material_key];
    const rate = r ? r.rate : 0;
    const buffer = r ? r.buffer : bufferDefault;
    if (rate <= 0) continue;
    sumPart += vol / (rate * buffer);
  }
  const n = materialKeys.length;
  const penalty = (n - 1) * S;
  return Q1 + Q2 + C + sumPart + penalty;
}
