/**
 * Provision (or revoke) partner API keys for the inbound integration API.
 * The plaintext key is printed ONCE and never stored; share it via a secure channel.
 *
 * Keys are not port-scoped; partners pass a valid port_id on each request.
 * Run inside the API container (DATABASE_URL is set there):
 *   docker exec jps-api node scripts/create-integration-api-key.mjs --partner "ERP_A"
 *   docker exec jps-api node scripts/create-integration-api-key.mjs --list
 *   docker exec jps-api node scripts/create-integration-api-key.mjs --deactivate 2
 */
import crypto from 'crypto';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function getArg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
}

async function main() {
  if (process.argv.includes('--list')) {
    const r = await pool.query(
      `SELECT id, partner_name, key_prefix, allowed_port_ids, active, created_at, last_used_at
       FROM integration_api_keys ORDER BY id`
    );
    console.table(
      r.rows.map((k) => ({
        id: Number(k.id),
        partner: k.partner_name,
        prefix: k.key_prefix,
        ports: (k.allowed_port_ids || []).join(','),
        active: k.active,
        last_used: k.last_used_at ? new Date(k.last_used_at).toISOString() : '-',
      }))
    );
    return;
  }

  const deactivateId = getArg('deactivate');
  if (deactivateId != null) {
    const r = await pool.query(
      `UPDATE integration_api_keys SET active = false, deactivated_at = NOW()
       WHERE id = $1 AND active
       RETURNING id, partner_name, key_prefix`,
      [Number.parseInt(deactivateId, 10)]
    );
    if (r.rows.length === 0) {
      console.error(`No active API key with id ${deactivateId}.`);
      process.exitCode = 1;
      return;
    }
    console.log(`Deactivated key #${r.rows[0].id} (${r.rows[0].partner_name}, ${r.rows[0].key_prefix}...).`);
    return;
  }

  const partner = (getArg('partner') || '').trim();
  if (!partner) {
    console.error('Usage: node scripts/create-integration-api-key.mjs --partner "ERP_A"');
    console.error('       node scripts/create-integration-api-key.mjs --list');
    console.error('       node scripts/create-integration-api-key.mjs --deactivate <id>');
    process.exitCode = 1;
    return;
  }

  const plaintext = `jps_live_${crypto.randomBytes(16).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(plaintext, 'utf8').digest('hex');
  const keyPrefix = plaintext.slice(0, 13);

  // Keys are not port-scoped; partners pass a valid port_id per request.
  const ins = await pool.query(
    `INSERT INTO integration_api_keys (partner_name, key_prefix, key_hash)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [partner, keyPrefix, keyHash]
  );

  console.log('API key created.');
  console.log(`  id:        ${ins.rows[0].id}`);
  console.log(`  partner:   ${partner}`);
  console.log('');
  console.log('  Plaintext key (shown ONCE, share securely, never commit):');
  console.log(`  ${plaintext}`);
}

try {
  await main();
} finally {
  await pool.end();
}
