/**
 * Simple SQL migration runner for Jetty Planning System (Step 1.6).
 *
 * - Reads DATABASE_URL from env (via dotenv/config already loaded by node when needed).
 * - Applies all .sql files in /migrations (sorted by filename).
 * - Tracks applied migrations in schema_migrations table.
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pool } from '../src/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '..', 'migrations');

async function ensureSchemaMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedMigrationNames() {
  const res = await pool.query(`SELECT name FROM schema_migrations ORDER BY name ASC;`);
  return new Set(res.rows.map((r) => r.name));
}

async function listMigrationFiles() {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.sql'))
    .map((e) => e.name)
    .sort();
}

async function applyMigration(name) {
  const fullPath = path.join(migrationsDir, name);
  const sql = await fs.readFile(fullPath, 'utf8');

  // Wrap each migration in a transaction.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (sql.trim().length > 0) {
      await client.query(sql);
    }
    await client.query(`INSERT INTO schema_migrations (name) VALUES ($1);`, [name]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  await ensureSchemaMigrationsTable();
  const applied = await getAppliedMigrationNames();
  const files = await listMigrationFiles();

  let appliedCount = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    console.log(`Applying migration: ${file}`);
    await applyMigration(file);
    appliedCount += 1;
  }

  console.log(`Migrations complete. Applied ${appliedCount} new migration(s).`);
  await pool.end();
}

main().catch(async (err) => {
  console.error('Migration failed:', err?.message || err);
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});

