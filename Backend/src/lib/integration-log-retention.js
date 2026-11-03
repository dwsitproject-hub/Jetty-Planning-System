/**
 * Retention for the partner API request log (integration_api_request_logs).
 */
import { pool } from '../db.js';

export const DEFAULT_RETENTION_DAYS = 30;
const PURGE_BATCH_SIZE = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 30_000;

let timerId = null;

export function resolveRetentionDays(raw = process.env.INTEGRATION_API_LOG_RETENTION_DAYS) {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_RETENTION_DAYS;
}

/**
 * Deletes rows older than the cutoff in batches.
 * @param {import('pg').Pool} db
 * @returns {Promise<number>} rows deleted
 */
export async function purgeIntegrationApiLogs(db, retentionDays = resolveRetentionDays(), batchSize = PURGE_BATCH_SIZE) {
  let total = 0;
  for (;;) {
    const r = await db.query(
      `DELETE FROM integration_api_request_logs
       WHERE id IN (
         SELECT id FROM integration_api_request_logs
         WHERE created_at < NOW() - ($1::int * interval '1 day')
         ORDER BY id
         LIMIT $2
       )`,
      [retentionDays, batchSize]
    );
    total += r.rowCount ?? 0;
    if ((r.rowCount ?? 0) < batchSize) return total;
  }
}

async function runPurge() {
  try {
    const deleted = await purgeIntegrationApiLogs(pool);
    if (deleted > 0) console.log(`[integration-log-retention] purged ${deleted} API log rows`);
  } catch (err) {
    console.error('[integration-log-retention] purge failed:', err?.message || err);
  }
}

export function startIntegrationLogRetention() {
  if (timerId) return;
  const first = setTimeout(runPurge, FIRST_RUN_DELAY_MS);
  first.unref?.();
  timerId = setInterval(runPurge, DAY_MS);
  timerId.unref?.();
  console.log(`[integration-log-retention] started (keep ${resolveRetentionDays()} days)`);
}
