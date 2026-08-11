#!/usr/bin/env node
/**
 * Hourly sweeper: persist ATG daily cargo progress for closed operational days.
 *
 * Usage:
 *   node scripts/aggregate-daily-cargo-progress.js
 *   node scripts/aggregate-daily-cargo-progress.js --portId=1
 *   node scripts/aggregate-daily-cargo-progress.js --dry-run
 */
import 'dotenv/config';
import { pool, verifyConnection } from '../src/db.js';
import { runDailyProgressAggregationSweep } from '../src/lib/operational-progress.js';

const ADVISORY_LOCK_KEY = 930934;

function parseArgs(argv) {
  const out = { portId: null, dryRun: false, skipLock: false };
  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    if (arg === '--skip-lock') out.skipLock = true;
    const m = /^--portId=(\d+)$/.exec(arg);
    if (m) out.portId = Number(m[1]);
  }
  return out;
}

async function tryAdvisoryLock(db) {
  const r = await db.query(`SELECT pg_try_advisory_lock($1) AS ok`, [ADVISORY_LOCK_KEY]);
  return Boolean(r.rows[0]?.ok);
}

async function releaseAdvisoryLock(db) {
  await db.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_KEY]).catch(() => {});
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await verifyConnection();

  let locked = args.skipLock;
  if (!args.skipLock) {
    locked = await tryAdvisoryLock(pool);
    if (!locked) {
      console.log('[aggregate-daily-cargo-progress] another run in progress; exiting');
      process.exit(0);
    }
  }

  try {
    if (args.dryRun) {
      console.log('[aggregate-daily-cargo-progress] dry-run (no writes)');
      process.exit(0);
    }
    const result = await runDailyProgressAggregationSweep(pool, { portId: args.portId });
    console.log(
      `[aggregate-daily-cargo-progress] done upserted=${result.upserted ?? 0} portId=${args.portId ?? 'all'}`
    );
  } finally {
    if (locked && !args.skipLock) await releaseAdvisoryLock(pool);
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[aggregate-daily-cargo-progress] fatal', err);
  process.exit(1);
});
