#!/usr/bin/env node
/**
 * Live no-flow check on its own (it also runs after each tank gauging poll):
 * closes open stops where ATG shows flow again and alerts on new no-flow runs.
 * Usage: node scripts/run-no-flow-live-check.js
 */
import 'dotenv/config';
import { pool, verifyConnection } from '../src/db.js';
import { runNoFlowLiveCheck } from '../src/lib/no-flow-live.js';

async function main() {
  await verifyConnection();
  console.log(JSON.stringify(await runNoFlowLiveCheck(pool)));
  await pool.end();
}

main().catch((err) => {
  console.error('[run-no-flow-live-check]', err?.message || err);
  process.exit(1);
});
