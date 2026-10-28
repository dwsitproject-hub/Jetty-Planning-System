/**
 * Query builders for the partner integration Activity views (webhook deliveries, API requests).
 * Pure functions: parse raw query-string input and return { sql, params, limit }.
 */
import { WEBHOOK_EVENT_TYPES } from './integration-webhooks.js';

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

const WEBHOOK_STATUSES = ['pending', 'sent', 'failed'];
const API_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];
const STATUS_CLASS_SQL = {
  '2xx': 'l.status_code >= 200 AND l.status_code < 300',
  '4xx': 'l.status_code >= 400 AND l.status_code < 500',
  '5xx': 'l.status_code >= 500',
  error: 'l.status_code >= 400',
};

export function parseLimit(v) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.max(n, 1), MAX_PAGE_LIMIT);
}

export function parsePositiveInt(v) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** @returns {string | null} ISO timestamp, or null when the input is not a valid date */
export function parseTimestamp(v) {
  if (v == null || v === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function escapeLike(text) {
  return String(text).replace(/[\\%_]/g, (c) => `\\${c}`);
}

function pickOne(v, allowed) {
  const s = typeof v === 'string' ? v.trim() : '';
  return allowed.includes(s) ? s : null;
}

function searchText(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s.slice(0, 100) : null;
}

/** Collects WHERE clauses and positional params together so numbering never drifts. */
function createClauses() {
  const params = [];
  const clauses = [];
  return {
    params,
    add(sqlWithPlaceholder, value) {
      params.push(value);
      clauses.push(sqlWithPlaceholder.replace('?', `$${params.length}`));
    },
    addRaw(sql) {
      clauses.push(sql);
    },
    where() {
      return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    },
  };
}

function applyTimeRange(c, column, raw) {
  const from = parseTimestamp(raw.from);
  const to = parseTimestamp(raw.to);
  if (from) c.add(`${column} >= ?::timestamptz`, from);
  if (to) c.add(`${column} <= ?::timestamptz`, to);
}

function finish(c, selectSql, orderColumn, raw) {
  const limit = parseLimit(raw.limit);
  const cursor = parsePositiveInt(raw.cursor);
  if (cursor) c.add(`${orderColumn} < ?`, cursor);
  c.params.push(limit + 1);
  const sql = `${selectSql}
    ${c.where()}
    ORDER BY ${orderColumn} DESC
    LIMIT $${c.params.length}`;
  return { sql, params: c.params, limit };
}

const WEBHOOK_SELECT = `
  SELECT d.id, d.delivery_id, d.event_type, d.external_reference, d.status, d.attempt_count,
         d.last_error, d.last_http_status, d.last_duration_ms, d.last_attempt_at,
         d.created_at, d.sent_at, d.next_attempt_at, d.payload,
         e.id AS endpoint_id, e.url AS endpoint_url,
         k.id AS api_key_id, k.partner_name
  FROM integration_webhook_deliveries d
  JOIN integration_webhook_endpoints e ON e.id = d.endpoint_id
  JOIN integration_api_keys k ON k.id = e.api_key_id`;

/** @param {Record<string, unknown>} raw req.query */
export function buildWebhookActivityQuery(raw = {}) {
  const c = createClauses();
  const keyId = parsePositiveInt(raw.keyId);
  const endpointId = parsePositiveInt(raw.endpointId);
  const status = pickOne(raw.status, WEBHOOK_STATUSES);
  const eventType = pickOne(raw.eventType, WEBHOOK_EVENT_TYPES);
  const q = searchText(raw.q);

  if (keyId) c.add('e.api_key_id = ?', keyId);
  if (endpointId) c.add('d.endpoint_id = ?', endpointId);
  if (status) c.add('d.status = ?', status);
  if (eventType) c.add('d.event_type = ?', eventType);
  if (q) {
    c.params.push(`%${escapeLike(q)}%`);
    const n = c.params.length;
    c.addRaw(`(d.external_reference ILIKE $${n} OR d.delivery_id ILIKE $${n})`);
  }
  applyTimeRange(c, 'd.created_at', raw);
  return finish(c, WEBHOOK_SELECT, 'd.id', raw);
}

const API_SELECT = `
  SELECT l.id, l.api_key_id, l.key_prefix, l.request_id, l.method, l.route, l.path,
         l.status_code, l.duration_ms, l.error_code, l.external_reference, l.client_ip,
         l.created_at, k.partner_name
  FROM integration_api_request_logs l
  LEFT JOIN integration_api_keys k ON k.id = l.api_key_id`;

/** @param {Record<string, unknown>} raw req.query */
export function buildApiRequestActivityQuery(raw = {}) {
  const c = createClauses();
  const keyId = parsePositiveInt(raw.keyId);
  const statusClass = pickOne(raw.statusClass, Object.keys(STATUS_CLASS_SQL));
  const method = pickOne(typeof raw.method === 'string' ? raw.method.toUpperCase() : '', API_METHODS);
  const route = searchText(raw.route);
  const q = searchText(raw.q);

  if (keyId) c.add('l.api_key_id = ?', keyId);
  if (statusClass) c.addRaw(STATUS_CLASS_SQL[statusClass]);
  if (method) c.add('l.method = ?', method);
  if (route) c.add('l.route = ?', route);
  if (q) {
    c.params.push(`%${escapeLike(q)}%`);
    const n = c.params.length;
    c.addRaw(`(l.request_id ILIKE $${n} OR l.external_reference ILIKE $${n})`);
  }
  applyTimeRange(c, 'l.created_at', raw);
  return finish(c, API_SELECT, 'l.id', raw);
}

/** Distinct route labels in the same time window, for the route filter dropdown. */
export function buildRouteOptionsQuery(raw = {}) {
  const c = createClauses();
  const keyId = parsePositiveInt(raw.keyId);
  if (keyId) c.add('l.api_key_id = ?', keyId);
  applyTimeRange(c, 'l.created_at', raw);
  return {
    sql: `SELECT DISTINCT l.route FROM integration_api_request_logs l ${c.where()} ORDER BY l.route LIMIT 50`,
    params: c.params,
  };
}
