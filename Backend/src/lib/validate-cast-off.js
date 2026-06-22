/** Allow small clock skew when comparing cast-off to server now. */
export const CAST_OFF_FUTURE_TOLERANCE_MS = 15 * 60 * 1000;

/**
 * Resolve TB from a joined operation row (operation + optional plan timeline columns).
 * @param {Record<string, unknown> | null | undefined} row
 * @returns {Date | null}
 */
export function resolveTbInstantFromOperationRow(row) {
  if (!row) return null;
  const pick = (v) => {
    if (v == null || v === '') return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const hasPlan = row.shipment_plan_id != null && row.shipment_plan_id !== '';
  if (hasPlan) {
    return (
      pick(row.plan_tb) ??
      pick(row.plan_docking_start_time) ??
      pick(row.tb) ??
      pick(row.docking_start_time)
    );
  }
  return pick(row.tb) ?? pick(row.docking_start_time);
}

/**
 * @param {Date} castOffAt
 * @param {{ tbAt?: Date | null, now?: Date }} [opts]
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateCastOffAt(castOffAt, { tbAt = null, now = new Date() } = {}) {
  if (!(castOffAt instanceof Date) || Number.isNaN(castOffAt.getTime())) {
    return { ok: false, error: 'Invalid cast_off_at' };
  }
  const nowMs = now.getTime();
  if (castOffAt.getTime() > nowMs + CAST_OFF_FUTURE_TOLERANCE_MS) {
    return { ok: false, error: 'CAST Off cannot be in the future.' };
  }
  if (tbAt instanceof Date && !Number.isNaN(tbAt.getTime())) {
    if (castOffAt.getTime() < tbAt.getTime()) {
      return { ok: false, error: 'CAST Off must be on or after actual time of berthing (TB).' };
    }
  }
  return { ok: true };
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number} planId
 * @returns {Promise<Date | null>}
 */
export async function loadPlanTbInstant(client, planId) {
  const r = await client.query(
    `SELECT tb, docking_start_time FROM shipment_plans WHERE id = $1 AND deleted_at IS NULL`,
    [planId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const pick = (v) => {
    if (v == null) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  return pick(row.tb) ?? pick(row.docking_start_time);
}
