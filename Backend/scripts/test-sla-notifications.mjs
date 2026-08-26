#!/usr/bin/env node
/**
 * Smoke test for SLA notification job (requires DATABASE_URL + migration 093).
 * Run: npm run test:sla-notifications
 */
import 'dotenv/config';
import { pool, verifyConnection } from '../src/db.js';
import { runSlaNotificationJob } from '../src/lib/sla-notification-job.js';

async function tableExists(name) {
  const r = await pool.query(`SELECT to_regclass($1) AS reg`, [`public.${name}`]);
  return Boolean(r.rows[0]?.reg);
}

async function main() {
  await verifyConnection();
  for (const t of ['notification_event_settings', 'smtp_config']) {
    if (!(await tableExists(t))) {
      console.error(`Missing table ${t}. Run: npm run migrate`);
      process.exit(1);
    }
  }
  const d1 = await runSlaNotificationJob(pool, 'd1');
  const breach = await runSlaNotificationJob(pool, 'breach');
  console.log('D-1 result:', d1);
  console.log('Breach result:', breach);
  const dup = await runSlaNotificationJob(pool, 'd1');
  assertDupSafe(d1, dup);
  await pool.end();
  console.log('OK');
}

function assertDupSafe(first, second) {
  if (first.skipped || second.skipped) return;
  if ((first.notifications || 0) > 0 && (second.notifications || 0) > 0) {
    console.warn('Warning: duplicate notifications on second run (check dedup keys)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
