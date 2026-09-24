#!/usr/bin/env node
/**
 * CLI entry for System Health Dashboard unhealthy email alerts (cron / Task Scheduler).
 * Usage: node scripts/run-admin-ops-alerts.js [--dry-run]
 */
import 'dotenv/config';
import { pool, verifyConnection } from '../src/db.js';
import { runAdminOpsAlertJob } from '../src/lib/admin-ops-alert-job.js';

function parseDryRun(argv) {
  return argv.includes('--dry-run');
}

async function main() {
  const dryRun = parseDryRun(process.argv.slice(2));
  await verifyConnection();
  const result = await runAdminOpsAlertJob(pool, { dryRun });
  console.log(JSON.stringify(result));
  await pool.end();
  process.exit(result.skipped && result.reason === 'lock_not_acquired' ? 0 : 0);
}

main().catch((err) => {
  console.error('[run-admin-ops-alerts]', err?.message || err);
  process.exit(1);
});
