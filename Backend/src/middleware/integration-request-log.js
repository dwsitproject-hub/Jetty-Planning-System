/**
 * Partner integration API request log (one row per call, no headers or bodies).
 * Mounted before requireIntegrationKey so rejected calls (401, 429) are recorded too.
 */
import { pool } from '../db.js';

const KEY_PREFIX_LENGTH = 13;
const MAX_PATH_LENGTH = 300;
const MAX_REFERENCE_LENGTH = 100;
const UNKNOWN_KEY_LIMIT_PER_MINUTE = 30;
const UNKNOWN_KEY_WINDOW_MS = 60_000;
const UNKNOWN_KEY_MAP_MAX = 5000;

const unknownKeyHits = new Map();

/** Caps rows written for unauthenticated calls per client IP so scanners cannot bloat the table. */
export function allowUnknownKeyLog(ip, nowMs = Date.now()) {
  const key = ip || 'unknown';
  if (unknownKeyHits.size > UNKNOWN_KEY_MAP_MAX) unknownKeyHits.clear();
  const entry = unknownKeyHits.get(key);
  if (!entry || nowMs - entry.windowStart >= UNKNOWN_KEY_WINDOW_MS) {
    unknownKeyHits.set(key, { windowStart: nowMs, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= UNKNOWN_KEY_LIMIT_PER_MINUTE;
}

export function resetUnknownKeyLogCap() {
  unknownKeyHits.clear();
}

/** `/api/v1/integrations/shipping-instructions/142?x=1` -> `/shipping-instructions/142` */
export function extractIntegrationPath(originalUrl) {
  const noQuery = String(originalUrl ?? '').split('?')[0];
  const idx = noQuery.indexOf('/integrations');
  const rest = idx >= 0 ? noQuery.slice(idx + '/integrations'.length) : noQuery;
  return (rest || '/').slice(0, MAX_PATH_LENGTH);
}

/** Replaces numeric path segments so the route label stays low-cardinality. */
export function toRoutePattern(path) {
  return path.replace(/\/\d+(?=\/|$)/g, '/:id');
}

function asShortString(v, max) {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

export function readKeyPrefix(headerValue) {
  const raw = typeof headerValue === 'string' ? headerValue.trim() : '';
  return raw.startsWith('jps_live_') ? raw.slice(0, KEY_PREFIX_LENGTH) : null;
}

/** @returns {object | null} row to insert, or null when the call must not be logged */
export function buildRequestLogRow(req, res, durationMs) {
  const apiKeyId = req.integrationKey?.id ?? null;
  const clientIp = asShortString(req.ip, 64);
  if (apiKeyId == null && !allowUnknownKeyLog(clientIp)) return null;

  const path = extractIntegrationPath(req.originalUrl);
  return {
    apiKeyId,
    keyPrefix: readKeyPrefix(req.headers?.['x-api-key']),
    requestId: asShortString(req.integrationRequestId, 64),
    method: String(req.method ?? 'GET').toUpperCase(),
    route: toRoutePattern(path),
    path,
    statusCode: res.statusCode,
    durationMs: Math.max(0, Math.round(durationMs)),
    errorCode: asShortString(res.locals?.integrationErrorCode, 64),
    externalReference:
      asShortString(req.query?.external_reference, MAX_REFERENCE_LENGTH) ??
      asShortString(req.body?.external_reference, MAX_REFERENCE_LENGTH),
    clientIp,
  };
}

const INSERT_SQL = `
  INSERT INTO integration_api_request_logs
    (api_key_id, key_prefix, request_id, method, route, path, status_code,
     duration_ms, error_code, external_reference, client_ip)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`;

export async function insertRequestLog(db, row) {
  await db.query(INSERT_SQL, [
    row.apiKeyId,
    row.keyPrefix,
    row.requestId,
    row.method,
    row.route,
    row.path,
    row.statusCode,
    row.durationMs,
    row.errorCode,
    row.externalReference,
    row.clientIp,
  ]);
}

/** Express middleware. Logging is fire-and-forget and never affects the partner response. */
export function createIntegrationRequestLogger(db = pool) {
  return function integrationRequestLog(req, res, next) {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      try {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        const row = buildRequestLogRow(req, res, durationMs);
        if (!row) return;
        insertRequestLog(db, row).catch((err) => {
          console.error('[integration-request-log] insert failed:', err?.message || err);
        });
      } catch (err) {
        console.error('[integration-request-log] build failed:', err?.message || err);
      }
    });
    next();
  };
}

export const integrationRequestLog = createIntegrationRequestLogger();
