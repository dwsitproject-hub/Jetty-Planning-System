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
import { runNoFlowLiveCheck } from '../src/lib/no-flow-live.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { fixturePath: null, metaFixturePath: null, portId: null, skipLock: false };
  for (const arg of argv) {
    if (arg.startsWith('--fixture=')) {
      const p = arg.slice('--fixture='.length);
      out.fixturePath = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
    } else if (arg.startsWith('--metaFixture=')) {
      const p = arg.slice('--metaFixture='.length);
      out.metaFixturePath = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
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
    metaFixturePath: args.metaFixturePath,
    skipLock: args.skipLock,
  });
  console.log(JSON.stringify(result));
  if (!result.skipped && !args.fixturePath) {
    // Fresh ATG samples: close open stops where flow is back, alert on new no-flow runs.
    try {
      console.log(JSON.stringify({ noFlowLive: await runNoFlowLiveCheck(pool) }));
    } catch (e) {
      console.error('[run-tank-gauging-poll] no-flow live check failed', e?.message || e);
    }
  }
  await pool.end();
  if (result.skipped) process.exit(0);
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error('[run-tank-gauging-poll]', err?.message || err);
  process.exit(1);
});
