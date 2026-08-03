#!/usr/bin/env node
/**
 * Two-stage ATG sample retention:
 *   1) Archive: sampled_at older than ACTIVE_DAYS → set archived_at
 *   2) Delete:  archived_at older than ARCHIVE_DAYS → DELETE row
 *
 * Does not touch tank_gauging_latest. Writes per-row audit to tank_gauging_purge_log.
 *
 * Usage:
 *   node scripts/purge-tank-gauging-samples.js
 *   node scripts/purge-tank-gauging-samples.js --skip-lock
 *   node scripts/purge-tank-gauging-samples.js --dry-run
 *
 * Env:
 *   TANK_GAUGING_SAMPLE_ACTIVE_DAYS=30
 *   TANK_GAUGING_SAMPLE_ARCHIVE_DAYS=7
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { pool, verifyConnection } from '../src/db.js';

/** Distinct from SLA 930931 and poller 930932. */
const ADVISORY_LOCK_KEY = 930933;

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

async function tryAdvisoryLock(db) {
  const r = await db.query(`SELECT pg_try_advisory_lock($1) AS ok`, [ADVISORY_LOCK_KEY]);
  return Boolean(r.rows[0]?.ok);
}

async function releaseAdvisoryLock(db) {
  await db.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_KEY]).catch(() => {});
}

/**
 * @param {import('pg').Pool} db
 * @param {{ skipLock?: boolean, dryRun?: boolean, activeDays?: number, archiveDays?: number }} opts
 */
export async function runTankGaugingPurgeJob(db, opts = {}) {
  const activeDays = opts.activeDays ?? positiveIntEnv('TANK_GAUGING_SAMPLE_ACTIVE_DAYS', 30);
  const archiveDays = opts.archiveDays ?? positiveIntEnv('TANK_GAUGING_SAMPLE_ARCHIVE_DAYS', 7);
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
        dryRun,
      };
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    let archiveCandidates;
    if (dryRun) {
      archiveCandidates = await client.query(
        `SELECT id AS sample_id, tank_id, source_base_url, sampled_at,
                total_mass, flow_rate_tph, level_mm, temperature_c, status_text
         FROM tank_gauging_samples
         WHERE archived_at IS NULL
           AND sampled_at < NOW() - ($1::int * INTERVAL '1 day')
         ORDER BY id`,
        [activeDays]
      );
    } else {
      archiveCandidates = await client.query(
        `UPDATE tank_gauging_samples
         SET archived_at = NOW()
         WHERE archived_at IS NULL
           AND sampled_at < NOW() - ($1::int * INTERVAL '1 day')
         RETURNING id AS sample_id, tank_id, source_base_url, sampled_at,
                   total_mass, flow_rate_tph, level_mm, temperature_c, status_text`,
        [activeDays]
      );
    }

    if (!dryRun && archiveCandidates.rows.length) {
      await client.query(
        `INSERT INTO tank_gauging_purge_log (
           batch_id, action, sample_id, tank_id, source_base_url, sampled_at,
           total_mass, flow_rate_tph, level_mm, temperature_c, status_text
         )
         SELECT $1::uuid, 'archive',
                x.sample_id, x.tank_id, x.source_base_url, x.sampled_at,
                x.total_mass, x.flow_rate_tph, x.level_mm, x.temperature_c, x.status_text
         FROM jsonb_to_recordset($2::jsonb) AS x(
           sample_id bigint, tank_id bigint, source_base_url text, sampled_at timestamptz,
           total_mass numeric, flow_rate_tph numeric, level_mm numeric, temperature_c numeric,
           status_text text
         )`,
        [batchId, JSON.stringify(archiveCandidates.rows)]
      );
    }

    let deleteCandidates;
    if (dryRun) {
      deleteCandidates = await client.query(
        `SELECT id AS sample_id, tank_id, source_base_url, sampled_at,
                total_mass, flow_rate_tph, level_mm, temperature_c, status_text
         FROM tank_gauging_samples
         WHERE archived_at IS NOT NULL
           AND archived_at < NOW() - ($1::int * INTERVAL '1 day')
         ORDER BY id`,
        [archiveDays]
      );
    } else {
      deleteCandidates = await client.query(
        `DELETE FROM tank_gauging_samples
         WHERE archived_at IS NOT NULL
           AND archived_at < NOW() - ($1::int * INTERVAL '1 day')
         RETURNING id AS sample_id, tank_id, source_base_url, sampled_at,
                   total_mass, flow_rate_tph, level_mm, temperature_c, status_text`,
        [archiveDays]
      );
    }

    if (!dryRun && deleteCandidates.rows.length) {
      await client.query(
        `INSERT INTO tank_gauging_purge_log (
           batch_id, action, sample_id, tank_id, source_base_url, sampled_at,
           total_mass, flow_rate_tph, level_mm, temperature_c, status_text
         )
         SELECT $1::uuid, 'delete',
                x.sample_id, x.tank_id, x.source_base_url, x.sampled_at,
                x.total_mass, x.flow_rate_tph, x.level_mm, x.temperature_c, x.status_text
         FROM jsonb_to_recordset($2::jsonb) AS x(
           sample_id bigint, tank_id bigint, source_base_url text, sampled_at timestamptz,
           total_mass numeric, flow_rate_tph numeric, level_mm numeric, temperature_c numeric,
           status_text text
         )`,
        [batchId, JSON.stringify(deleteCandidates.rows)]
      );
    }

    if (dryRun) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }

    const archived = archiveCandidates.rows.length;
    const deleted = deleteCandidates.rows.length;
    const sampleIdsDeleted = deleteCandidates.rows.slice(0, 20).map((r) => Number(r.sample_id));

    return {
      ok: true,
      skipped: false,
      batchId,
      archived,
      deleted,
      activeDays,
      archiveDays,
      dryRun,
      sampleIdsDeletedPreview: sampleIdsDeleted,
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
