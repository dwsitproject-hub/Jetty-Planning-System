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

const DEFAULT_WEBHOOK_CALLBACK_URL =
  'http://172.28.92.57:3000/api/v1/datahub/webhook';

function encryptSecret(plaintext) {
  return encryptSmtpPassword(plaintext);
}

function decryptSecret(ciphertext) {
  return decryptSmtpPassword(ciphertext);
}

/** Display-only URL registered in the DHM portal (must match exactly). */
export function getDataHubWebhookCallbackUrl() {
  const raw = String(process.env.JPS_DATAHUB_WEBHOOK_CALLBACK_URL || '').trim();
  return raw || DEFAULT_WEBHOOK_CALLBACK_URL;
}

function envWebhookEnabled() {
  const v = String(process.env.DHM_WEBHOOK_ENABLED || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function envWebhookSecret() {
  const s = String(process.env.DHM_WEBHOOK_SECRET || '').trim();
  return s || null;
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
            last_sync_at, last_sync_ok, last_error, updated_at, updated_by,
            webhook_secret_encrypted, webhook_enabled, last_webhook_at, last_webhook_error
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
 * Inbound DHM webhook verification config.
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @returns {Promise<{ enabled: boolean, secret: string | null, source: 'database' | 'environment' | 'none' }>}
 */
export async function getEffectiveWebhookConfig(db) {
  const row = await loadDataHubConfigRow(db);
  if (row?.webhook_enabled) {
    let secret = null;
    if (row.webhook_secret_encrypted) {
      try {
        secret = decryptSecret(row.webhook_secret_encrypted);
      } catch {
        secret = null;
      }
    }
    if (secret) {
      return { enabled: true, secret, source: 'database' };
    }
  }
  if (envWebhookEnabled() && envWebhookSecret()) {
    return { enabled: true, secret: envWebhookSecret(), source: 'environment' };
  }
  return { enabled: false, secret: null, source: 'none' };
}

/**
 * Admin-safe view: reports whether a private key is stored, never its value.
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
export async function getDataHubConfigForAdmin(db) {
  const row = await loadDataHubConfigRow(db);
  const envCfg = readEnvConfig();
  const effective = await getEffectiveDataHubConfig(db);
  const webhookEffective = await getEffectiveWebhookConfig(db);
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
    webhookEnabled: Boolean(row?.webhook_enabled) || envWebhookEnabled(),
    webhookSecretConfigured:
      Boolean(row?.webhook_secret_encrypted) || Boolean(envWebhookSecret()),
    webhookEffectiveSource: webhookEffective.source,
    webhookCallbackUrl: getDataHubWebhookCallbackUrl(),
    lastWebhookAt: row?.last_webhook_at ?? null,
    lastWebhookError: row?.last_webhook_error ?? null,
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

  const webhookEnabled =
    input.webhookEnabled != null ? Boolean(input.webhookEnabled) : row?.webhook_enabled ?? false;

  let webhookSecretEncrypted = row?.webhook_secret_encrypted ?? null;
  if (input.webhookSecret != null && String(input.webhookSecret).trim()) {
    webhookSecretEncrypted = encryptSecret(String(input.webhookSecret).trim());
  }

  if (enabled && (!baseUrl || !publicKey || !privateKeyEncrypted)) {
    throw new Error('baseUrl, publicKey and privateKey are required to enable the DataHub integration');
  }

  if (webhookEnabled && !webhookSecretEncrypted && !envWebhookSecret()) {
    throw new Error('webhookSecret is required to enable inbound DataHub webhooks');
  }

  await db.query(
    `UPDATE datahub_config SET
       base_url = $1,
       public_key = $2,
       private_key_encrypted = $3,
       enabled = $4,
       webhook_enabled = $5,
       webhook_secret_encrypted = $6,
       updated_at = NOW(),
       updated_by = $7
     WHERE id = $8`,
    [
      baseUrl,
      publicKey,
      privateKeyEncrypted,
      enabled,
      webhookEnabled,
      webhookSecretEncrypted,
      updatedBy ?? null,
      CONFIG_ID,
    ]
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

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {{ ok: boolean, error?: string|null }} result
 */
export async function updateDataHubWebhookHealth(db, result) {
  await db.query(
    `UPDATE datahub_config SET
       last_webhook_at = NOW(),
       last_webhook_error = $1,
       updated_at = NOW()
     WHERE id = $2`,
    [result.ok ? null : String(result.error || 'webhook failed').slice(0, 2000), CONFIG_ID]
  );
}
