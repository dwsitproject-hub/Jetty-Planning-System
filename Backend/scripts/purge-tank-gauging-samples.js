#!/usr/bin/env node
/**
 * Two-stage ATG sample retention:
 *   1) Archive: sampled_at older than ACTIVE_DAYS → set archived_at
 *   2) Delete:  archived_at older than ARCHIVE_DAYS → DELETE row
 *
 * Does not touch tank_gauging_latest. Writes per-row audit to tank_gauging_purge_log.
 * Large backlogs are processed in SQL chunks (default 5000 rows) to avoid JSON size
 * and Node memory limits.
 *
 * Usage:
 *   node scripts/purge-tank-gauging-samples.js
 *   node scripts/purge-tank-gauging-samples.js --skip-lock
 *   node scripts/purge-tank-gauging-samples.js --dry-run
 *
 * Env:
 *   TANK_GAUGING_SAMPLE_ACTIVE_DAYS=30
 *   TANK_GAUGING_SAMPLE_ARCHIVE_DAYS=7
 *   TANK_GAUGING_PURGE_CHUNK=5000
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { pool, verifyConnection } from '../src/db.js';

/** Distinct from SLA 930931 and poller 930932. */
const ADVISORY_LOCK_KEY = 930933;

const DEFAULT_PURGE_CHUNK = 5000;

function parseArgs(argv) {
  const out = { skipLock: false, dryRun: false };
  for (const arg of argv) {
    if (arg === '--skip-lock') out.skipLock = true;
    if (arg === '--dry-run') out.dryRun = true;
  }
  return out;
}

function positiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`${name} must be a positive integer (got ${JSON.stringify(raw)})`);
  }
  return Math.floor(n);
}

export function purgeChunkSize() {
  return positiveIntEnv('TANK_GAUGING_PURGE_CHUNK', DEFAULT_PURGE_CHUNK);
}

async function tryAdvisoryLock(db) {
  const r = await db.query(`SELECT pg_try_advisory_lock($1) AS ok`, [ADVISORY_LOCK_KEY]);
  return Boolean(r.rows[0]?.ok);
}

async function releaseAdvisoryLock(db) {
  await db.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_KEY]).catch(() => {});
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number} activeDays
 */
async function countArchiveCandidates(client, activeDays) {
  const r = await client.query(
    `SELECT count(*)::int AS n
     FROM tank_gauging_samples
     WHERE archived_at IS NULL
       AND sampled_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [activeDays]
  );
  return Number(r.rows[0]?.n) || 0;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number} archiveDays
 */
async function countDeleteCandidates(client, archiveDays) {
  const r = await client.query(
    `SELECT count(*)::int AS n
     FROM tank_gauging_samples
     WHERE archived_at IS NOT NULL
       AND archived_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [archiveDays]
  );
  return Number(r.rows[0]?.n) || 0;
}

/**
 * Archive up to chunkSize rows and write purge_log in one SQL statement.
 * @returns {number} rows archived this chunk
 */
async function archiveChunk(client, batchId, activeDays, chunkSize) {
  const r = await client.query(
    `WITH picked AS (
       SELECT id
       FROM tank_gauging_samples
       WHERE archived_at IS NULL
         AND sampled_at < NOW() - ($1::int * INTERVAL '1 day')
       ORDER BY id
       LIMIT $2
     ),
     archived AS (
       UPDATE tank_gauging_samples t
       SET archived_at = NOW()
       FROM picked p
       WHERE t.id = p.id
       RETURNING
         t.id AS sample_id,
         t.tank_id,
         t.source_base_url,
         t.sampled_at,
         t.total_mass,
         t.flow_rate_tph,
         t.level_mm,
         t.temperature_c,
         t.status_text
     ),
     logged AS (
       INSERT INTO tank_gauging_purge_log (
         batch_id, action, sample_id, tank_id, source_base_url, sampled_at,
         total_mass, flow_rate_tph, level_mm, temperature_c, status_text
       )
       SELECT
         $3::uuid, 'archive',
         sample_id, tank_id, source_base_url, sampled_at,
         total_mass, flow_rate_tph, level_mm, temperature_c, status_text
       FROM archived
       RETURNING 1
     )
     SELECT (SELECT count(*)::int FROM archived) AS archived_count`,
    [activeDays, chunkSize, batchId]
  );
  return Number(r.rows[0]?.archived_count) || 0;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string} batchId
 * @param {number} archiveDays
 * @param {number} chunkSize
 * @returns {Promise<number[]>} up to 20 sample ids deleted (any chunk order)
 */
async function deleteChunkWithPreview(client, batchId, archiveDays, chunkSize, previewIds) {
  const r = await client.query(
    `WITH picked AS (
       SELECT id
       FROM tank_gauging_samples
       WHERE archived_at IS NOT NULL
         AND archived_at < NOW() - ($1::int * INTERVAL '1 day')
       ORDER BY id
       LIMIT $2
     ),
     deleted AS (
       DELETE FROM tank_gauging_samples t
       USING picked p
       WHERE t.id = p.id
       RETURNING
         t.id AS sample_id,
         t.tank_id,
         t.source_base_url,
         t.sampled_at,
         t.total_mass,
         t.flow_rate_tph,
         t.level_mm,
         t.temperature_c,
         t.status_text
     ),
     logged AS (
       INSERT INTO tank_gauging_purge_log (
         batch_id, action, sample_id, tank_id, source_base_url, sampled_at,
         total_mass, flow_rate_tph, level_mm, temperature_c, status_text
       )
       SELECT
         $3::uuid, 'delete',
         sample_id, tank_id, source_base_url, sampled_at,
         total_mass, flow_rate_tph, level_mm, temperature_c, status_text
       FROM deleted
       RETURNING 1
     )
     SELECT
       (SELECT count(*)::int FROM deleted) AS deleted_count,
       (SELECT coalesce(array_agg(sample_id ORDER BY sample_id), ARRAY[]::bigint[])
        FROM deleted) AS deleted_ids`,
    [archiveDays, chunkSize, batchId]
  );
  const row = r.rows[0] || {};
  const deletedCount = Number(row.deleted_count) || 0;
  const ids = Array.isArray(row.deleted_ids) ? row.deleted_ids : [];
  for (const id of ids) {
    if (previewIds.length >= 20) break;
    previewIds.push(Number(id));
  }
  return deletedCount;
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ skipLock?: boolean, dryRun?: boolean, activeDays?: number, archiveDays?: number, chunkSize?: number }} opts
 */
export async function runTankGaugingPurgeJob(db, opts = {}) {
  const activeDays = opts.activeDays ?? positiveIntEnv('TANK_GAUGING_SAMPLE_ACTIVE_DAYS', 30);
  const archiveDays = opts.archiveDays ?? positiveIntEnv('TANK_GAUGING_SAMPLE_ARCHIVE_DAYS', 7);
  const chunkSize = opts.chunkSize ?? purgeChunkSize();
  const dryRun = Boolean(opts.dryRun);
  const batchId = randomUUID();

  let locked = false;
  if (!opts.skipLock) {
    locked = await tryAdvisoryLock(db);
    if (!locked) {
      return {
        ok: true,
        skipped: true,
        reason: 'lock_held',
        batchId,
        archived: 0,
        deleted: 0,
        activeDays,
        archiveDays,
        chunkSize,
        dryRun,
      };
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    let archived = 0;
    let deleted = 0;
    const sampleIdsDeletedPreview = [];

    if (dryRun) {
      archived = await countArchiveCandidates(client, activeDays);
      deleted = await countDeleteCandidates(client, archiveDays);
      await client.query('ROLLBACK');
    } else {
      for (;;) {
        const n = await archiveChunk(client, batchId, activeDays, chunkSize);
        archived += n;
        if (n === 0) break;
      }

      for (;;) {
        const n = await deleteChunkWithPreview(
          client,
          batchId,
          archiveDays,
          chunkSize,
          sampleIdsDeletedPreview
        );
        deleted += n;
        if (n === 0) break;
      }

      await client.query('COMMIT');
    }

    return {
      ok: true,
      skipped: false,
      batchId,
      archived,
      deleted,
      activeDays,
      archiveDays,
      chunkSize,
      dryRun,
      sampleIdsDeletedPreview,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    if (locked) await releaseAdvisoryLock(db);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await verifyConnection();
  const result = await runTankGaugingPurgeJob(pool, {
    skipLock: args.skipLock,
    dryRun: args.dryRun,
  });
  console.log(JSON.stringify(result));
  await pool.end();
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error('[purge-tank-gauging-samples]', err?.message || err);
  process.exit(1);
});
