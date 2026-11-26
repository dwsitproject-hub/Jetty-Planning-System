/**
 * Per-poll history for Tankvision sources (tank_gauging_poll_runs).
 * Logging must never break a poll, so write failures are swallowed.
 */

export const POLL_RUN_RETENTION_DAYS = 30;

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {{
 *   portId?: number|string|null,
 *   sourceId: number|string|null,
 *   sourceBaseUrl: string,
 *   startedAt: Date,
 *   ok: boolean,
 *   httpStatus?: number|null,
 *   fetched?: number,
 *   upserted?: number,
 *   unmapped?: number,
 *   error?: string|null,
 * }} run
 */
export async function recordPollRun(db, run) {
  if (run.sourceId == null) return;
  try {
    await db.query(
      `INSERT INTO tank_gauging_poll_runs (
         port_id, source_id, source_base_url, started_at, ok,
         http_status, fetched, upserted, unmapped, error
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        run.portId ?? null,
        run.sourceId,
        run.sourceBaseUrl,
        run.startedAt,
        Boolean(run.ok),
        run.httpStatus ?? null,
        Number(run.fetched) || 0,
        Number(run.upserted) || 0,
        Number(run.unmapped) || 0,
        run.ok ? null : String(run.error || 'poll failed').slice(0, 2000),
      ]
    );
  } catch (e) {
    console.error('[tank-gauging-poll-runs] could not record poll run', e?.message || e);
  }
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {number} [retentionDays]
 * @returns {Promise<number>} rows deleted
 */
export async function purgeOldPollRuns(db, retentionDays = POLL_RUN_RETENTION_DAYS) {
  const r = await db.query(
    `DELETE FROM tank_gauging_poll_runs
     WHERE started_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [retentionDays]
  );
  return r.rowCount ?? 0;
}
