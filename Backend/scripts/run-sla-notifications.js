#!/usr/bin/env node
/**
 * CLI entry for SLA notification scheduled jobs (cron / Task Scheduler).
 * Usage: node scripts/run-sla-notifications.js --mode=d1|breach|all
 */
import 'dotenv/config';
import { pool, verifyConnection } from '../src/db.js';
import { runSlaNotificationJob } from '../src/lib/sla-notification-job.js';

function parseMode(argv) {
  for (const arg of argv) {
    if (arg.startsWith('--mode=')) return arg.slice('--mode='.length);
    if (arg === '--d1') return 'd1';
    if (arg === '--breach') return 'breach';
  }
  return 'all';
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  await verifyConnection();
  const modes = mode === 'all' ? ['d1', 'breach'] : [mode];
  const results = [];
  for (const m of modes) {
    const result = await runSlaNotificationJob(pool, m);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  await pool.end();
  const skipped = results.every((r) => r.skipped);
  process.exit(skipped ? 0 : 0);
}

main().catch((err) => {
  console.error('[run-sla-notifications]', err?.message || err);
  process.exit(1);
});
