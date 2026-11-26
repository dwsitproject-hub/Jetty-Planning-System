#!/usr/bin/env node
/**
 * Recover ATG samples for one Tankvision source over a time range from the Tankvision archive.
 * Dry run by default (reads the archive, writes nothing). --apply inserts the missing samples
 * in one transaction; if any tank fails to download, nothing is written.
 *
 * Usage:
 *   node scripts/recover-atg-source-range.mjs --port=1 --source=http://172.16.250.15 \
 *     --from=2026-11-25T15:00:00Z --to=2026-11-26T00:30:00Z [--tank=3203,3502] [--apply]
 *
 * Times must carry a zone (Z or +07:00). Window limit: 7 days.
 */
import 'dotenv/config';
import { pool, verifyConnection } from '../src/db.js';
import { recoverAtgSourceRange } from '../src/lib/atg-source-recovery.js';

const ZONED = /(Z|[+-]\d{2}:?\d{2})$/i;

function parseArgs(argv) {
  const out = { apply: false, tankCodes: null };
  for (const arg of argv) {
    if (arg === '--apply') out.apply = true;
    else if (arg.startsWith('--port=')) out.portId = Number(arg.slice(7));
    else if (arg.startsWith('--source=')) out.sourceBaseUrl = arg.slice(9);
    else if (arg.startsWith('--from=')) out.startAt = arg.slice(7);
    else if (arg.startsWith('--to=')) out.endAt = arg.slice(5);
    else if (arg.startsWith('--tank=')) out.tankCodes = arg.slice(7).split(',').map((s) => s.trim());
  }
  return out;
}

function validate(args) {
  const problems = [];
  if (!Number.isFinite(args.portId) || args.portId <= 0) problems.push('--port=<id> is required');
  if (!args.sourceBaseUrl) problems.push('--source=<base url> is required');
  for (const [flag, value] of [['--from', args.startAt], ['--to', args.endAt]]) {
    if (!value || !ZONED.test(value) || Number.isNaN(new Date(value).getTime())) {
      problems.push(`${flag}=<ISO time with Z or an offset> is required`);
    }
  }
  if (!problems.length && new Date(args.endAt) <= new Date(args.startAt)) problems.push('--to must be after --from');
  return problems;
}

async function run(args) {
  const opts = { ...args, dryRun: !args.apply };
  if (!args.apply) return recoverAtgSourceRange(pool, opts);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await recoverAtgSourceRange(client, opts);
    if (result.totals.tanksWithErrors > 0) {
      await client.query('ROLLBACK');
      return { ...result, rolledBack: true };
    }
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const problems = validate(args);
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  await verifyConnection();
  const result = await run(args);
  console.log(JSON.stringify(result, null, 2));
  await pool.end();
  process.exit(result.rolledBack ? 2 : 0);
}

main().catch((err) => {
  console.error('[recover-atg-source-range]', err?.message || err);
  process.exit(1);
});
