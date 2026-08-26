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
  // Cloud VPC/NAT/security-group paths can silently drop idle TCP connections
  // without a FIN/RST. Without keepalive + proactive recycling, the pool can
  // hand out a "zombie" client whose deadness is only discovered after a long
  // OS-level timeout (minutes), which surfaces as a hung request -> gateway 504.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// Idle clients emit 'error' when their underlying connection dies unexpectedly
// (e.g. dropped by a network intermediary). Without this handler, node-postgres
// still recovers, but the error was surfacing as an unhandled rejection deep in
// unrelated request handlers. Log it here instead so it's clearly attributed.
pool.on('error', (err) => {
  console.error('[pg pool] idle client error (connection will be discarded):', err.message);
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
