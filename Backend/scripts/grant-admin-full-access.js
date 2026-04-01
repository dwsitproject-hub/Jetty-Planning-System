/**
 * Runs migrations/041_admin_full_access.sql (idempotent).
 *
 * Prefer `npm run migrate` so the migration is recorded in schema_migrations along with any
 * other pending files. Use this script for a targeted re-apply on the server, e.g.:
 *   docker compose exec api node scripts/grant-admin-full-access.js
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pool } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, '..', 'migrations', '041_admin_full_access.sql');

async function main() {
  const sql = await fs.readFile(sqlPath, 'utf8');
  if (!sql.trim()) {
    console.error('Migration file is empty:', sqlPath);
    process.exit(1);
  }
  await pool.query(sql);
  console.log('Applied 041_admin_full_access.sql');
  await pool.end();
}

main().catch(async (err) => {
  console.error(err?.message || err);
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
