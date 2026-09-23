/**
 * DataHub (DHM) client configuration: database (encrypted private key) with
 * environment fallback, mirroring tank-gauging-source-config.js.
 *
 * The private key is write-only over the API: admin reads get
 * `privateKeyConfigured` instead of the secret. The public key is an identifier
 * per the DHM contract and is safe to return.
 */
import { decryptSmtpPassword, encryptSmtpPassword } from './smtp-config.js';

const CONFIG_ID = 1;

function encryptSecret(plaintext) {
  return encryptSmtpPassword(plaintext);
}

function decryptSecret(ciphertext) {
  return decryptSmtpPassword(ciphertext);
}

/** Strip a trailing slash so callers can append `/v1/...` safely. */
export function trimBaseUrl(raw) {
  return String(raw || '').trim().replace(/\/+$/, '');
}

export function normalizeBaseUrl(raw) {
  const base = trimBaseUrl(raw);
  if (!base) throw new Error('baseUrl is required');
  let u;
  try {
    u = new URL(base);
  } catch {
    throw new Error('baseUrl must be a valid URL');
  }
  if (!/^https?:$/i.test(u.protocol)) throw new Error('baseUrl must be http or https');
  return trimBaseUrl(u.origin + u.pathname);
}

function readEnvConfig() {
  const baseUrl = trimBaseUrl(process.env.DHM_BASE_URL);
  if (!baseUrl) return null;
  return {
    source: 'environment',
    baseUrl,
    publicKey: String(process.env.DHM_PUBLIC_KEY || '').trim() || null,
    privateKey: String(process.env.DHM_PRIVATE_KEY || '').trim() || null,
    enabled: true,
  };
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
export async function loadDataHubConfigRow(db) {
  const r = await db.query(
    `SELECT id, base_url, public_key, private_key_encrypted, enabled,
            last_sync_at, last_sync_ok, last_error, updated_at, updated_by
     FROM datahub_config WHERE id = $1`,
    [CONFIG_ID]
  );
  return r.rows[0] ?? null;
}

/**
 * Credentials for server-side calls. Never send this to the client.
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
export async function getEffectiveDataHubConfig(db) {
  const row = await loadDataHubConfigRow(db);
  if (row?.enabled && row.base_url && trimBaseUrl(row.base_url)) {
    let privateKey = '';
    if (row.private_key_encrypted) {
      try {
        privateKey = decryptSecret(row.private_key_encrypted);
      } catch {
        privateKey = '';
      }
    }
    return {
      source: 'database',
      baseUrl: trimBaseUrl(row.base_url),
      publicKey: row.public_key || null,
      privateKey: privateKey || null,
      enabled: true,
      lastSyncAt: row.last_sync_at ?? null,
    };
  }
  const envCfg = readEnvConfig();
  if (envCfg) return envCfg;
  return { source: 'none', enabled: false, baseUrl: null, publicKey: null, privateKey: null };
}

/**
 * Admin-safe view: reports whether a private key is stored, never its value.
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
export async function getDataHubConfigForAdmin(db) {
  const row = await loadDataHubConfigRow(db);
  const envCfg = readEnvConfig();
  const effective = await getEffectiveDataHubConfig(db);
  return {
    baseUrl: row?.base_url || envCfg?.baseUrl || '',
    publicKey: row?.public_key || envCfg?.publicKey || '',
    enabled: Boolean(row?.enabled),
    privateKeyConfigured: Boolean(row?.private_key_encrypted) || Boolean(envCfg?.privateKey),
    source: effective.source,
    lastSyncAt: row?.last_sync_at ?? null,
    lastSyncOk: row?.last_sync_ok ?? null,
    lastError: row?.last_error ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

/**
 * A blank privateKey keeps the stored one, so the UI can leave the field empty.
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {object} input
 * @param {number | null} updatedBy
 */
export async function saveDataHubConfig(db, input, updatedBy) {
  const row = await loadDataHubConfigRow(db);
  const baseUrl = input.baseUrl != null ? normalizeBaseUrl(input.baseUrl) : row?.base_url ?? null;
  const publicKey =
    input.publicKey != null ? String(input.publicKey).trim() || null : row?.public_key ?? null;
  const enabled = input.enabled != null ? Boolean(input.enabled) : row?.enabled ?? false;

  let privateKeyEncrypted = row?.private_key_encrypted ?? null;
  if (input.privateKey != null && String(input.privateKey).trim()) {
    privateKeyEncrypted = encryptSecret(String(input.privateKey).trim());
  }

  if (enabled && (!baseUrl || !publicKey || !privateKeyEncrypted)) {
    throw new Error('baseUrl, publicKey and privateKey are required to enable the DataHub integration');
  }

  await db.query(
    `UPDATE datahub_config SET
       base_url = $1,
       public_key = $2,
       private_key_encrypted = $3,
       enabled = $4,
       updated_at = NOW(),
       updated_by = $5
     WHERE id = $6`,
    [baseUrl, publicKey, privateKeyEncrypted, enabled, updatedBy ?? null, CONFIG_ID]
  );
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {{ ok: boolean, error?: string|null }} result
 */
export async function updateDataHubSyncHealth(db, result) {
  await db.query(
    `UPDATE datahub_config SET
       last_sync_at = NOW(),
       last_sync_ok = $1,
       last_error = $2,
       updated_at = NOW()
     WHERE id = $3`,
    [Boolean(result.ok), result.ok ? null : String(result.error || 'sync failed').slice(0, 2000), CONFIG_ID]
  );
}
