#!/usr/bin/env node
/**
 * CLI entry for Tankvision gauging poll (cron / Task Scheduler).
 * Usage:
 *   node scripts/run-tank-gauging-poll.js
 *   node scripts/run-tank-gauging-poll.js --fixture=fixtures/tankvision-datatype47-sample.json
 *   node scripts/run-tank-gauging-poll.js --portId=1 --skip-lock
 */
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, verifyConnection } from '../src/db.js';
import { runTankGaugingPollJob } from '../src/lib/tank-gauging-poll-job.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { fixturePath: null, portId: null, skipLock: false };
  for (const arg of argv) {
    if (arg.startsWith('--fixture=')) {
      const p = arg.slice('--fixture='.length);
      out.fixturePath = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
    } else if (arg.startsWith('--portId=')) {
      out.portId = Number(arg.slice('--portId='.length));
    } else if (arg === '--skip-lock') {
      out.skipLock = true;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await verifyConnection();
  const result = await runTankGaugingPollJob(pool, {
    portId: args.portId,
    fixturePath: args.fixturePath,
    skipLock: args.skipLock,
  });
  console.log(JSON.stringify(result));
  await pool.end();
  if (result.skipped) process.exit(0);
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error('[run-tank-gauging-poll]', err?.message || err);
  process.exit(1);
});
