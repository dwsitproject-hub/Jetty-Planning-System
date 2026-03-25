/**
 * PostgreSQL connection pool and startup verification.
 * Reads DATABASE_URL from env. Exits process if connection fails (Step 1.5).
 */
import pg from 'pg';

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('FATAL: DATABASE_URL is not set.');
  process.exit(1);
}

export const pool = new Pool({
  connectionString: databaseUrl,
});

/**
 * Run a trivial query to verify the database is reachable.
 * @throws if connection fails
 */
export async function verifyConnection() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}
