/**
 * Provision (or revoke) partner API keys for the inbound integration API.
 * The plaintext key is printed ONCE and never stored; share it via a secure channel.
 *
 * Run inside the API container (DATABASE_URL is set there):
 *   docker exec jps-api node scripts/create-integration-api-key.mjs --partner "ERP_A" --ports 3
 *   docker exec jps-api node scripts/create-integration-api-key.mjs --partner "ERP_A" --ports 3,5
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
  const portsRaw = (getArg('ports') || '').trim();
  if (!partner || !portsRaw) {
    console.error('Usage: node scripts/create-integration-api-key.mjs --partner "ERP_A" --ports 3[,5,...]');
    console.error('       node scripts/create-integration-api-key.mjs --list');
    console.error('       node scripts/create-integration-api-key.mjs --deactivate <id>');
    process.exitCode = 1;
    return;
  }
  const portIds = portsRaw.split(',').map((s) => Number.parseInt(s.trim(), 10));
  if (portIds.some((p) => !Number.isFinite(p) || Number.isNaN(p))) {
    console.error(`Invalid --ports value: ${portsRaw}`);
    process.exitCode = 1;
    return;
  }
  const known = await pool.query(`SELECT id FROM ports WHERE id = ANY($1) AND deleted_at IS NULL`, [portIds]);
  const knownIds = new Set(known.rows.map((r) => Number(r.id)));
  const missing = portIds.filter((p) => !knownIds.has(p));
  if (missing.length > 0) {
    console.error(`Unknown or inactive port id(s): ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const plaintext = `jps_live_${crypto.randomBytes(16).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(plaintext, 'utf8').digest('hex');
  const keyPrefix = plaintext.slice(0, 13);

  const ins = await pool.query(
    `INSERT INTO integration_api_keys (partner_name, key_prefix, key_hash, allowed_port_ids)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [partner, keyPrefix, keyHash, portIds]
  );

  console.log('API key created.');
  console.log(`  id:        ${ins.rows[0].id}`);
  console.log(`  partner:   ${partner}`);
  console.log(`  ports:     ${portIds.join(', ')}`);
  console.log('');
  console.log('  Plaintext key (shown ONCE, share securely, never commit):');
  console.log(`  ${plaintext}`);
}

try {
  await main();
} finally {
  await pool.end();
}
