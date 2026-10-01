/**
 * SMTP configuration from environment (Backend/.env on the API host).
 * encryptSmtpPassword / decryptSmtpPassword are reused for other encrypted secrets.
 */
import crypto from 'crypto';
import nodemailer from 'nodemailer';

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

function parseEnvBoolean(raw, defaultWhenUnset) {
  if (raw == null || String(raw).trim() === '') return defaultWhenUnset;
  return !['0', 'false', 'no', 'off'].includes(String(raw).trim().toLowerCase());
}

/** STARTTLS required on submission port (587). DownstreamHub uses SMTP_REQUIRE_TLS=false. */
export function getSmtpRequireTls(port, secure) {
  if (secure || Number(port) === 465) return false;
  return parseEnvBoolean(process.env.SMTP_REQUIRE_TLS, false);
}

/** Downstream Hub–style nodemailer transport (no requireTLS/timeouts/forced close). */
export function isSmtpHubParityMode() {
  return parseEnvBoolean(process.env.SMTP_HUB_PARITY, false);
}

/** Pause after SMTP send before closing socket (ms). Env: SMTP_POST_SEND_DELAY_MS (max 30s). */
export function getSmtpPostSendDelayMs() {
  const raw = process.env.SMTP_POST_SEND_DELAY_MS;
  if (raw == null || String(raw).trim() === '') return 0;
  const n = parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 30_000);
}

function sleepMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Wait after send so the mail server can finish spool before the client disconnects. */
export async function smtpPostSendDelay() {
  const ms = getSmtpPostSendDelayMs();
  if (ms > 0) await sleepMs(ms);
}

/**
 * @deprecated Send path uses sendSmtpMail (pre-QUIT delay). Kept for compatibility; clears transport cache only.
 */
export async function finalizeSmtpTransport(_transport) {
  invalidateSmtpTransportCache();
}

/** True when env SMTP is complete enough to send. */
export function isSmtpSendingConfigured(cfg) {
  return Boolean(cfg?.enabled && cfg?.host && cfg?.user && cfg?.pass);
}

/**
 * Options for nodemailer SMTPConnection (graceful send path).
 * @param {Awaited<ReturnType<typeof getEffectiveSmtpConfig>>} cfg
 */
export function buildSmtpConnectionOptions(cfg) {
  if (!cfg?.enabled || !cfg.host) return null;
  const port = Number(cfg.port) || 587;
  const secure = Boolean(cfg.secure) || port === 465;
  const hubParity = isSmtpHubParityMode();
  const requireTLS = hubParity ? false : getSmtpRequireTls(port, secure);
  const base = {
    host: cfg.host,
    port,
    secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass || '' } : undefined,
    tls: { rejectUnauthorized: cfg.rejectUnauthorized !== false },
  };
  if (hubParity) {
    return base;
  }
  return {
    ...base,
    requireTLS,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 25_000,
  };
}

function envFromAddress(user) {
  return (
    process.env.MAIL_FROM ||
    process.env.EMAIL_FROM ||
    process.env.SMTP_FROM ||
    user ||
    'jetty-planning@localhost'
  );
}

function readEnvSmtp() {
  const host = process.env.SMTP_HOST;
  if (!host || !String(host).trim()) return null;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secureRaw = String(process.env.SMTP_SECURE || '').toLowerCase();
  const secure = secureRaw === 'true' || secureRaw === '1' || port === 465;
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '';
  if (!user || !pass) return null;
  const rejectUnauthorized =
    process.env.SMTP_REJECT_UNAUTHORIZED !== 'false' && process.env.SMTP_REJECT_UNAUTHORIZED !== '0';
  return {
    source: 'environment',
    host: String(host).trim(),
    port: Number.isFinite(port) ? port : 587,
    secure,
    user: user || null,
    pass: pass || null,
    fromAddress: envFromAddress(user),
    rejectUnauthorized,
    enabled: true,
  };
}

/** Read-only status for admin UI (no secrets). */
export function getSmtpEnvStatus() {
  const cfg = readEnvSmtp();
  if (!cfg) {
    return { configured: false, source: 'none' };
  }
  return {
    configured: true,
    source: 'environment',
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    fromAddress: cfg.fromAddress,
  };
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} [_db]
 */
export async function getEffectiveSmtpConfig(_db) {
  const envCfg = readEnvSmtp();
  if (envCfg) return envCfg;
  return { source: 'none', enabled: false };
}

function transportCacheKey(cfg) {
  if (!cfg?.host) return '';
  const port = Number(cfg.port) || 587;
  const secure = Boolean(cfg.secure) || port === 465;
  const hub = isSmtpHubParityMode();
  const requireTLS = hub ? false : getSmtpRequireTls(port, secure);
  return [hub ? 'hub' : 'jps', cfg.host, cfg.port, cfg.secure, requireTLS, cfg.user, cfg.pass, cfg.rejectUnauthorized].join('|');
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
  const port = Number(cfg.port) || 587;
  const secure = Boolean(cfg.secure) || port === 465;
  const hubParity = isSmtpHubParityMode();
  const requireTLS = hubParity ? false : getSmtpRequireTls(port, secure);
  const base = {
    host: cfg.host,
    port,
    secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass || '' } : undefined,
    tls: { rejectUnauthorized: cfg.rejectUnauthorized !== false },
  };
  const transport = nodemailer.createTransport(
    hubParity
      ? base
      : {
          ...base,
          requireTLS,
          pool: false,
          connectionTimeout: 20_000,
          greetingTimeout: 15_000,
          socketTimeout: 25_000,
        }
  );
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
