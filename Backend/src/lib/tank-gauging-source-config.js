/**
 * Tankvision / ATG source configuration: database (encrypted credentials) with env fallback.
 */
import {
  decryptSmtpPassword,
  encryptSmtpPassword,
} from './smtp-config.js';
import { resolveTankGaugingBaseUrls, trimBaseUrl } from './tankvision-client.js';

const AUTH_TYPES = new Set(['none', 'basic', 'cookie']);

function encryptSecret(plaintext) {
  return encryptSmtpPassword(plaintext);
}

function decryptSecret(ciphertext) {
  return decryptSmtpPassword(ciphertext);
}

function readEnvAuth() {
  const cookie = process.env.TANK_GAUGING_COOKIE;
  if (cookie && String(cookie).trim()) {
    return { type: 'cookie', user: null, secret: String(cookie).trim() };
  }
  const user = process.env.TANK_GAUGING_BASIC_USER;
  if (user && String(user).trim()) {
    return {
      type: 'basic',
      user: String(user).trim(),
      secret: String(process.env.TANK_GAUGING_BASIC_PASS ?? ''),
    };
  }
  return { type: 'none', user: null, secret: null };
}

function authFromRow(row) {
  if (!row) return { type: 'none', user: null, secret: null };
  const type = AUTH_TYPES.has(row.auth_type) ? row.auth_type : 'none';
  if (type === 'none') return { type: 'none', user: null, secret: null };
  let secret = '';
  if (row.auth_secret_encrypted) {
    try {
      secret = decryptSecret(row.auth_secret_encrypted);
    } catch {
      secret = '';
    }
  }
  return {
    type,
    user: row.auth_user || null,
    secret: secret || null,
  };
}

function toAdminDto(row) {
  const auth = authFromRow(row);
  return {
    id: String(row.id),
    portId: String(row.port_id),
    baseUrl: row.base_url,
    label: row.label ?? null,
    enabled: Boolean(row.enabled),
    authType: auth.type,
    authUser: auth.user,
    secretConfigured: Boolean(row.auth_secret_encrypted),
    lastPollAt: row.last_poll_at ?? null,
    lastPollOk: row.last_poll_ok ?? null,
    lastError: row.last_error ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function normalizeBaseUrl(raw) {
  const base = trimBaseUrl(String(raw || '').trim());
  if (!base) throw new Error('baseUrl is required');
  try {
    const u = new URL(base);
    if (!/^https?:$/i.test(u.protocol)) throw new Error('baseUrl must be http or https');
    return trimBaseUrl(u.origin + u.pathname.replace(/\/index\.esp$/i, ''));
  } catch (e) {
    if (e?.message?.includes('baseUrl')) throw e;
    throw new Error('baseUrl must be a valid URL');
  }
}

function normalizeAuthType(raw) {
  const t = String(raw || 'none').trim().toLowerCase();
  if (!AUTH_TYPES.has(t)) throw new Error('authType must be none, basic, or cookie');
  return t;
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
async function tableHasRows(db) {
  const r = await db.query(`SELECT EXISTS (SELECT 1 FROM tank_gauging_sources LIMIT 1) AS ok`);
  return Boolean(r.rows[0]?.ok);
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {number} portId
 */
export async function listSourcesForPort(db, portId) {
  const r = await db.query(
    `SELECT id, port_id, base_url, label, enabled, auth_type, auth_user,
            auth_secret_encrypted, last_poll_at, last_poll_ok, last_error, updated_at
     FROM tank_gauging_sources
     WHERE port_id = $1
     ORDER BY LOWER(COALESCE(label, base_url)), base_url`,
    [portId]
  );
  return r.rows.map(toAdminDto);
}

/**
 * Enabled sources for poller (decrypted auth server-side only).
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {{ portId?: number|null }} [opts]
 */
export async function resolveEnabledSources(db, opts = {}) {
  const filterPortId =
    opts.portId != null && Number.isFinite(Number(opts.portId)) && Number(opts.portId) > 0
      ? Number(opts.portId)
      : null;

  if (await tableHasRows(db)) {
    const params = [];
    let where = 'enabled = TRUE';
    if (filterPortId != null) {
      params.push(filterPortId);
      where += ` AND port_id = $${params.length}`;
    }
    const r = await db.query(
      `SELECT id, port_id, base_url, label, enabled, auth_type, auth_user, auth_secret_encrypted
       FROM tank_gauging_sources
       WHERE ${where}
       ORDER BY port_id, base_url`,
      params
    );
    return r.rows.map((row) => ({
      id: row.id,
      portId: Number(row.port_id),
      baseUrl: row.base_url,
      label: row.label,
      auth: authFromRow(row),
      source: 'database',
    }));
  }

  const portId = filterPortId ?? Number(process.env.TANK_GAUGING_PORT_ID);
  if (!Number.isFinite(portId) || portId <= 0) return [];

  const auth = readEnvAuth();
  return resolveTankGaugingBaseUrls().map((baseUrl) => ({
    id: null,
    portId,
    baseUrl,
    label: null,
    auth,
    source: 'environment',
  }));
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {number} sourceId
 */
export async function getSourceById(db, sourceId) {
  const r = await db.query(
    `SELECT id, port_id, base_url, label, enabled, auth_type, auth_user,
            auth_secret_encrypted, last_poll_at, last_poll_ok, last_error, updated_at
     FROM tank_gauging_sources WHERE id = $1`,
    [sourceId]
  );
  return r.rows[0] ?? null;
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {object} input
 * @param {number | null} updatedBy
 */
export async function createSource(db, input, updatedBy) {
  const portId = Number(input.portId);
  if (!Number.isFinite(portId) || portId <= 0) throw new Error('portId is required');

  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const authType = normalizeAuthType(input.authType);
  const label = input.label != null ? String(input.label).trim() || null : null;
  const enabled = input.enabled != null ? Boolean(input.enabled) : true;
  const authUser =
    authType === 'basic' && input.authUser != null
      ? String(input.authUser).trim() || null
      : authType === 'basic'
        ? null
        : null;

  let authSecretEncrypted = null;
  if (authType !== 'none') {
    const secret = String(input.authSecret ?? input.password ?? '').trim();
    if (!secret) throw new Error('authSecret is required for basic or cookie auth');
    authSecretEncrypted = encryptSecret(secret);
  }

  const r = await db.query(
    `INSERT INTO tank_gauging_sources (
       port_id, base_url, label, enabled, auth_type, auth_user, auth_secret_encrypted, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, port_id, base_url, label, enabled, auth_type, auth_user,
               auth_secret_encrypted, last_poll_at, last_poll_ok, last_error, updated_at`,
    [portId, baseUrl, label, enabled, authType, authUser, authSecretEncrypted, updatedBy ?? null]
  );
  return toAdminDto(r.rows[0]);
}

/**
 * Move tank map / latest / sample rows when an ATG source base URL changes in place.
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {number} portId
 * @param {string} oldUrl
 * @param {string} newUrl
 */
export async function migrateSourceBaseUrl(db, portId, oldUrl, newUrl) {
  const oldBase = trimBaseUrl(oldUrl);
  const newBase = trimBaseUrl(newUrl);
  if (oldBase === newBase) {
    return { mapsMigrated: 0, latestMigrated: 0, samplesMigrated: 0 };
  }

  const mapRes = await db.query(
    `UPDATE tank_gauging_tank_map SET source_base_url = $1, updated_at = NOW()
     WHERE port_id = $2 AND source_base_url = $3`,
    [newBase, portId, oldBase]
  );

  const latestRes = await db.query(
    `UPDATE tank_gauging_latest SET source_base_url = $1
     WHERE source_base_url = $2
       AND tank_id IN (
         SELECT tank_id FROM tank_gauging_tank_map
         WHERE port_id = $3 AND source_base_url = $1
       )`,
    [newBase, oldBase, portId]
  );

  const samplesRes = await db.query(
    `UPDATE tank_gauging_samples SET source_base_url = $1 WHERE source_base_url = $2`,
    [newBase, oldBase]
  );

  return {
    mapsMigrated: mapRes.rowCount ?? 0,
    latestMigrated: latestRes.rowCount ?? 0,
    samplesMigrated: samplesRes.rowCount ?? 0,
  };
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {number} sourceId
 * @param {object} input
 * @param {number | null} updatedBy
 */
export async function updateSource(db, sourceId, input, updatedBy) {
  const row = await getSourceById(db, sourceId);
  if (!row) throw new Error('Source not found');

  const baseUrl = input.baseUrl != null ? normalizeBaseUrl(input.baseUrl) : row.base_url;
  const authType = input.authType != null ? normalizeAuthType(input.authType) : row.auth_type;
  const label = input.label !== undefined ? (String(input.label || '').trim() || null) : row.label;
  const enabled = input.enabled != null ? Boolean(input.enabled) : Boolean(row.enabled);

  let authUser = row.auth_user;
  if (input.authUser !== undefined) {
    authUser = String(input.authUser || '').trim() || null;
  } else if (authType !== 'basic') {
    authUser = null;
  }

  let authSecretEncrypted = row.auth_secret_encrypted;
  if (authType === 'none') {
    authSecretEncrypted = null;
  } else if (input.authSecret != null || input.password != null) {
    const secret = String(input.authSecret ?? input.password ?? '').trim();
    if (secret) authSecretEncrypted = encryptSecret(secret);
    else if (!authSecretEncrypted) throw new Error('authSecret is required for basic or cookie auth');
  } else if (authType !== row.auth_type && !authSecretEncrypted) {
    throw new Error('authSecret is required when changing auth type');
  }

  const runUpdate = async (client) => {
    if (baseUrl !== row.base_url) {
      await migrateSourceBaseUrl(client, Number(row.port_id), row.base_url, baseUrl);
    }

    const r = await client.query(
      `UPDATE tank_gauging_sources SET
         base_url = $1,
         label = $2,
         enabled = $3,
         auth_type = $4,
         auth_user = $5,
         auth_secret_encrypted = $6,
         updated_at = NOW(),
         updated_by = $7
       WHERE id = $8
       RETURNING id, port_id, base_url, label, enabled, auth_type, auth_user,
                 auth_secret_encrypted, last_poll_at, last_poll_ok, last_error, updated_at`,
      [baseUrl, label, enabled, authType, authUser, authSecretEncrypted, updatedBy ?? null, sourceId]
    );
    return toAdminDto(r.rows[0]);
  };

  if (typeof db.connect === 'function') {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const updated = await runUpdate(client);
      await client.query('COMMIT');
      return updated;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  return runUpdate(db);
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {number} sourceId
 */
export async function deleteSource(db, sourceId) {
  const row = await getSourceById(db, sourceId);
  if (!row) throw new Error('Source not found');

  const mapCheck = await db.query(
    `SELECT 1 FROM tank_gauging_tank_map
     WHERE port_id = $1 AND source_base_url = $2
     LIMIT 1`,
    [row.port_id, row.base_url]
  );
  if (mapCheck.rows.length) {
    throw new Error(
      'Cannot delete: tank map entries exist for this source. Disable the source instead.'
    );
  }

  await db.query(`DELETE FROM tank_gauging_sources WHERE id = $1`, [sourceId]);
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {number|null} sourceId
 * @param {{ ok: boolean, error?: string|null }} result
 */
export async function updateSourcePollHealth(db, sourceId, result) {
  if (sourceId == null) return;
  await db.query(
    `UPDATE tank_gauging_sources SET
       last_poll_at = NOW(),
       last_poll_ok = $2,
       last_error = $3,
       updated_at = NOW()
     WHERE id = $1`,
    [sourceId, Boolean(result.ok), result.ok ? null : (result.error || 'poll failed').slice(0, 2000)]
  );
}

/** Resolve auth for test-connection (DB row or inline body). */
export function resolveAuthForTest(row, body = {}) {
  if (body.authType != null || body.authSecret != null || body.password != null) {
    const type = normalizeAuthType(body.authType ?? row?.auth_type ?? 'none');
    if (type === 'none') return { type: 'none', user: null, secret: null };
    const secret = String(body.authSecret ?? body.password ?? '').trim();
    if (secret) {
      return {
        type,
        user: type === 'basic' ? String(body.authUser ?? row?.auth_user ?? '').trim() || null : null,
        secret,
      };
    }
  }
  return authFromRow(row);
}
