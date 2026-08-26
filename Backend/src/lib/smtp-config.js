/**
 * SMTP configuration: database (encrypted) with environment fallback.
 */
import crypto from 'crypto';
import nodemailer from 'nodemailer';

const CONFIG_ID = 1;
let cachedTransport = null;
let cachedTransportKey = null;

function encryptionKey() {
  const raw = process.env.NOTIFICATION_ENCRYPTION_KEY || process.env.JWT_SECRET || '';
  if (!raw || !String(raw).trim()) {
    throw new Error('NOTIFICATION_ENCRYPTION_KEY or JWT_SECRET required for SMTP password encryption');
  }
  return crypto.createHash('sha256').update(String(raw).trim(), 'utf8').digest();
}

export function encryptSmtpPassword(plaintext) {
  const text = String(plaintext || '');
  if (!text) return null;
  const key = encryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSmtpPassword(ciphertext) {
  if (!ciphertext) return '';
  const key = encryptionKey();
  const buf = Buffer.from(String(ciphertext), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

function readEnvSmtp() {
  const host = process.env.SMTP_HOST;
  if (!host || !String(host).trim()) return null;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure =
    String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '';
  const rejectUnauthorized = String(process.env.SMTP_REJECT_UNAUTHORIZED ?? 'true').toLowerCase() !== 'false';
  return {
    source: 'environment',
    host: String(host).trim(),
    port: Number.isFinite(port) ? port : 587,
    secure,
    user: user || null,
    pass: pass || null,
    fromAddress: process.env.SMTP_FROM || user || 'jetty-planning@localhost',
    rejectUnauthorized,
    enabled: true,
  };
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
export async function loadSmtpConfigRow(db) {
  const r = await db.query(
    `SELECT id, host, port, secure, "user", password_encrypted, from_address,
            reject_unauthorized, enabled, updated_at, updated_by
     FROM smtp_config WHERE id = $1`,
    [CONFIG_ID]
  );
  return r.rows[0] ?? null;
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
export async function getEffectiveSmtpConfig(db) {
  const row = await loadSmtpConfigRow(db);
  if (row?.enabled && row.host && String(row.host).trim()) {
    let pass = '';
    if (row.password_encrypted) {
      try {
        pass = decryptSmtpPassword(row.password_encrypted);
      } catch {
        pass = '';
      }
    }
    return {
      source: 'database',
      host: String(row.host).trim(),
      port: Number(row.port) || 465,
      secure: Boolean(row.secure),
      user: row.user || null,
      pass: pass || null,
      fromAddress: row.from_address || row.user || 'jetty-planning@localhost',
      rejectUnauthorized: row.reject_unauthorized !== false,
      enabled: true,
      updatedAt: row.updated_at,
    };
  }
  const envCfg = readEnvSmtp();
  if (envCfg) return envCfg;
  return { source: 'none', enabled: false };
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
export async function getSmtpConfigForAdmin(db) {
  const row = await loadSmtpConfigRow(db);
  const envCfg = readEnvSmtp();
  const effective = await getEffectiveSmtpConfig(db);
  return {
    host: row?.host || envCfg?.host || '',
    port: row?.port ?? envCfg?.port ?? 465,
    secure: row?.secure ?? envCfg?.secure ?? true,
    user: row?.user || envCfg?.user || '',
    fromAddress: row?.from_address || envCfg?.fromAddress || row?.user || envCfg?.user || '',
    rejectUnauthorized: row?.reject_unauthorized ?? envCfg?.rejectUnauthorized ?? true,
    enabled: Boolean(row?.enabled),
    passwordConfigured: Boolean(row?.password_encrypted),
    source: effective.source,
    updatedAt: row?.updated_at ?? null,
  };
}

function transportCacheKey(cfg) {
  if (!cfg?.host) return '';
  return [cfg.host, cfg.port, cfg.secure, cfg.user, cfg.pass, cfg.rejectUnauthorized].join('|');
}

export function invalidateSmtpTransportCache() {
  cachedTransport = null;
  cachedTransportKey = null;
}

/**
 * @param {Awaited<ReturnType<typeof getEffectiveSmtpConfig>>} cfg
 */
export function buildNodemailerTransport(cfg) {
  if (!cfg?.enabled || !cfg.host) return null;
  const key = transportCacheKey(cfg);
  if (cachedTransport && cachedTransportKey === key) return cachedTransport;
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass || '' } : undefined,
    tls: { rejectUnauthorized: cfg.rejectUnauthorized !== false },
  });
  cachedTransport = transport;
  cachedTransportKey = key;
  return transport;
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
export async function getSmtpTransport(db) {
  const cfg = await getEffectiveSmtpConfig(db);
  return buildNodemailerTransport(cfg);
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
export async function getFromAddress(db) {
  const cfg = await getEffectiveSmtpConfig(db);
  return cfg.fromAddress || cfg.user || 'jetty-planning@localhost';
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {object} input
 * @param {number | null} updatedBy
 */
export async function saveSmtpConfig(db, input, updatedBy) {
  const row = await loadSmtpConfigRow(db);
  const host = input.host != null ? String(input.host).trim() : row?.host;
  const port = input.port != null ? Number(input.port) : row?.port ?? 465;
  const secure = input.secure != null ? Boolean(input.secure) : row?.secure ?? true;
  const user = input.user != null ? String(input.user).trim() : row?.user;
  const fromAddress =
    input.fromAddress != null ? String(input.fromAddress).trim() : row?.from_address;
  const rejectUnauthorized =
    input.rejectUnauthorized != null
      ? Boolean(input.rejectUnauthorized)
      : row?.reject_unauthorized ?? true;
  const enabled = input.enabled != null ? Boolean(input.enabled) : row?.enabled ?? false;

  let passwordEncrypted = row?.password_encrypted ?? null;
  if (input.password != null && String(input.password).trim()) {
    passwordEncrypted = encryptSmtpPassword(String(input.password).trim());
  }

  await db.query(
    `UPDATE smtp_config SET
       host = $1,
       port = $2,
       secure = $3,
       "user" = $4,
       password_encrypted = $5,
       from_address = $6,
       reject_unauthorized = $7,
       enabled = $8,
       updated_at = NOW(),
       updated_by = $9
     WHERE id = $10`,
    [
      host || null,
      Number.isFinite(port) ? port : 465,
      secure,
      user || null,
      passwordEncrypted,
      fromAddress || null,
      rejectUnauthorized,
      enabled,
      updatedBy ?? null,
      CONFIG_ID,
    ]
  );
  invalidateSmtpTransportCache();
}
