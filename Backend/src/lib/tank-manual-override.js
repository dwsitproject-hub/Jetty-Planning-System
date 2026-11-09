/**
 * Per-tank "Allow Manual Override": rules, persistence and queries.
 */

export const MIN_REASON_LENGTH = 5;
export const MAX_EXPIRY_DAYS = 90;
export const OVERRIDE_ENTITY_TYPE = 'TankManualOverride';

const DAY_MS = 24 * 60 * 60 * 1000;

/** SQL fragment: the override on alias `t` (master_tanks) is on and not expired. */
export const ACTIVE_OVERRIDE_SQL = `(t.manual_override_enabled = TRUE
  AND (t.manual_override_expires_at IS NULL OR t.manual_override_expires_at > NOW()))`;

/**
 * @param {{ manual_override_enabled?: boolean, manual_override_expires_at?: string|Date|null }} row
 * @param {number} [nowMs]
 */
export function isOverrideActive(row, nowMs = Date.now()) {
  if (!row?.manual_override_enabled) return false;
  if (row.manual_override_expires_at == null) return true;
  return new Date(row.manual_override_expires_at).getTime() > nowMs;
}

/**
 * Status for display: off, on, or expired (was on, auto-off date passed).
 * @returns {'off'|'on'|'expired'}
 */
export function overrideState(row, nowMs = Date.now()) {
  if (!row?.manual_override_enabled) return 'off';
  return isOverrideActive(row, nowMs) ? 'on' : 'expired';
}

/**
 * Validate the admin's request to turn the override on or off.
 * @param {{ enabled?: unknown, reason?: unknown, expiresAt?: unknown }} body
 * @param {number} [nowMs]
 * @returns {{ ok: true, value: { enabled: boolean, reason: string|null, expiresAt: string|null } } | { ok: false, error: string }}
 */
export function validateOverrideRequest(body, nowMs = Date.now()) {
  if (typeof body?.enabled !== 'boolean') return { ok: false, error: 'enabled must be true or false' };
  const reason = String(body.reason ?? '').trim();

  if (!body.enabled) {
    return { ok: true, value: { enabled: false, reason: reason || null, expiresAt: null } };
  }
  if (reason.length < MIN_REASON_LENGTH) return { ok: false, error: 'reason_required' };

  let expiresAt = null;
  if (body.expiresAt != null && body.expiresAt !== '') {
    const ms = new Date(String(body.expiresAt)).getTime();
    if (!Number.isFinite(ms)) return { ok: false, error: 'expiresAt is invalid' };
    if (ms <= nowMs) return { ok: false, error: 'expiresAt must be in the future' };
    if (ms > nowMs + MAX_EXPIRY_DAYS * DAY_MS) {
      return { ok: false, error: `expiresAt must be within ${MAX_EXPIRY_DAYS} days` };
    }
    expiresAt = new Date(ms).toISOString();
  }
  return { ok: true, value: { enabled: true, reason, expiresAt } };
}

/** Shape sent to the browser for one tank row. */
export function mapOverrideForClient(row, nowMs = Date.now()) {
  return {
    state: overrideState(row, nowMs),
    active: isOverrideActive(row, nowMs),
    reason: row.manual_override_reason ?? null,
    setAt: row.manual_override_set_at ? new Date(row.manual_override_set_at).toISOString() : null,
    setBy: row.manual_override_set_by_name ?? null,
    expiresAt: row.manual_override_expires_at ? new Date(row.manual_override_expires_at).toISOString() : null,
  };
}

/**
 * Tank ids (from the given list) whose override is currently active.
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {Array<number|string>} tankIds
 * @returns {Promise<Set<number>>}
 */
export async function loadActiveOverrideTankIds(db, tankIds) {
  const ids = (tankIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length) return new Set();
  const r = await db.query(
    `SELECT t.id FROM master_tanks t
     WHERE t.id = ANY($1::bigint[]) AND t.deleted_at IS NULL AND ${ACTIVE_OVERRIDE_SQL}`,
    [ids]
  );
  return new Set(r.rows.map((row) => Number(row.id)));
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ tankId: number, enabled: boolean, reason: string|null, expiresAt: string|null, userId: number|null }} input
 * @returns {Promise<{ before: object, after: object } | null>} null when the tank does not exist
 */
export async function setTankManualOverride(db, { tankId, enabled, reason, expiresAt, userId }) {
  const select = `SELECT t.id, t.port_id, t.code, t.manual_override_enabled, t.manual_override_reason,
                         t.manual_override_set_at, t.manual_override_expires_at, u.username AS manual_override_set_by_name
                  FROM master_tanks t
                  LEFT JOIN users u ON u.id = t.manual_override_set_by
                  WHERE t.id = $1 AND t.deleted_at IS NULL`;
  const beforeRes = await db.query(select, [tankId]);
  if (!beforeRes.rows.length) return null;

  await db.query(
    `UPDATE master_tanks
     SET manual_override_enabled = $2,
         manual_override_reason = CASE WHEN $2 THEN $3 ELSE manual_override_reason END,
         manual_override_set_by = $4,
         manual_override_set_at = NOW(),
         manual_override_expires_at = $5::timestamptz,
         updated_at = NOW()
     WHERE id = $1`,
    [tankId, enabled, reason, userId, expiresAt]
  );
  const afterRes = await db.query(select, [tankId]);
  return { before: beforeRes.rows[0], after: afterRes.rows[0] };
}

/**
 * Tanks with an active override, for System Health.
 * @param {import('pg').Pool} db
 */
export async function loadActiveOverrides(db) {
  const r = await db.query(
    `SELECT t.id, t.code, t.name, t.port_id, p.name AS port_name,
            t.manual_override_reason, t.manual_override_set_at, t.manual_override_expires_at,
            u.username AS set_by
     FROM master_tanks t
     JOIN ports p ON p.id = t.port_id AND p.deleted_at IS NULL
     LEFT JOIN users u ON u.id = t.manual_override_set_by
     WHERE t.deleted_at IS NULL AND ${ACTIVE_OVERRIDE_SQL}
     ORDER BY t.manual_override_expires_at ASC NULLS LAST, t.code ASC`
  );
  return r.rows.map((row) => ({
    tankId: Number(row.id),
    code: row.code,
    name: row.name ?? null,
    portId: Number(row.port_id),
    portName: row.port_name,
    reason: row.manual_override_reason ?? null,
    setBy: row.set_by ?? null,
    setAt: row.manual_override_set_at ? new Date(row.manual_override_set_at).toISOString() : null,
    expiresAt: row.manual_override_expires_at ? new Date(row.manual_override_expires_at).toISOString() : null,
  }));
}
