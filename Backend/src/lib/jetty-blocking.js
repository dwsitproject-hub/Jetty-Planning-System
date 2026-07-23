/**
 * Jetty availability for master status changes and allocation validation.
 * Aligns with allocation overview: shifting_out operations do not block.
 */

/** Statuses that cannot be set while non-sailed operations still use the jetty. */
export const JETTY_UNAVAILABLE_MASTER_STATUSES = new Set(['Out of Service']);

export function isJettyUnavailableMasterStatus(status) {
  return JETTY_UNAVAILABLE_MASTER_STATUSES.has(String(status || ''));
}

/**
 * Operations that block marking a jetty unavailable (strict Option A: any non-SAILED, not shifting out).
 * Counts both operations berthed at `jettyId` as their primary jetty and operations spanning into
 * it as an additional (multi-jetty) berth.
 */
export async function countBlockingOperationsOnJetty(db, jettyId) {
  if (jettyId == null || Number.isNaN(Number(jettyId))) return 0;
  const r = await db.query(
    `SELECT COUNT(*)::int AS c
     FROM operations o
     WHERE o.deleted_at IS NULL
       AND (o.jetty_id = $1 OR $1 = ANY(o.additional_jetties))
       AND COALESCE(o.status, '') <> 'SAILED'
       AND COALESCE(o.shifting_out, false) = false`,
    [jettyId]
  );
  return r.rows[0]?.c ?? 0;
}

export const JETTY_OUT_OF_SERVICE = 'Out of Service';
