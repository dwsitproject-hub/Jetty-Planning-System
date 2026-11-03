/**
 * Partner integration Activity (admin monitoring): webhook deliveries, API requests, health summary.
 */
import {
  buildApiRequestActivityQuery,
  buildRouteOptionsQuery,
  buildWebhookActivityQuery,
  parsePositiveInt,
} from './integration-activity-filters.js';
import { retryFailedWebhookDelivery } from './integration-webhooks.js';

export const SUMMARY_DEFAULT_HOURS = 24;
export const SUMMARY_MAX_HOURS = 24 * 30;

function iso(v) {
  return v ? new Date(v).toISOString() : null;
}

function endpointHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return url ?? null;
  }
}

/** Splits the limit+1 probe row off a page and derives the next cursor. */
function paginate(rows, limit) {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { page, nextCursor: hasMore ? String(page.at(-1).id) : null };
}

function toWebhookItem(row) {
  return {
    id: Number(row.id),
    deliveryId: row.delivery_id,
    eventType: row.event_type,
    externalReference: row.external_reference,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    lastError: row.last_error ?? null,
    httpStatus: row.last_http_status ?? null,
    durationMs: row.last_duration_ms ?? null,
    lastAttemptAt: iso(row.last_attempt_at),
    createdAt: iso(row.created_at),
    sentAt: iso(row.sent_at),
    nextAttemptAt: iso(row.next_attempt_at),
    endpointId: Number(row.endpoint_id),
    endpointUrl: row.endpoint_url,
    endpointHost: endpointHost(row.endpoint_url),
    apiKeyId: Number(row.api_key_id),
    partnerName: row.partner_name,
    payload: row.payload,
  };
}

function toApiRequestItem(row) {
  return {
    id: Number(row.id),
    apiKeyId: row.api_key_id != null ? Number(row.api_key_id) : null,
    partnerName: row.partner_name ?? null,
    keyPrefix: row.key_prefix ?? null,
    requestId: row.request_id ?? null,
    method: row.method,
    route: row.route,
    path: row.path,
    statusCode: Number(row.status_code),
    durationMs: Number(row.duration_ms),
    errorCode: row.error_code ?? null,
    externalReference: row.external_reference ?? null,
    clientIp: row.client_ip ?? null,
    createdAt: iso(row.created_at),
  };
}

/** @param {import('pg').Pool} db @param {Record<string, unknown>} raw req.query */
export async function listWebhookActivity(db, raw) {
  const { sql, params, limit } = buildWebhookActivityQuery(raw);
  const r = await db.query(sql, params);
  const { page, nextCursor } = paginate(r.rows, limit);
  return { items: page.map(toWebhookItem), nextCursor };
}

/** @param {import('pg').Pool} db @param {Record<string, unknown>} raw req.query */
export async function listApiRequestActivity(db, raw) {
  const { sql, params, limit } = buildApiRequestActivityQuery(raw);
  const r = await db.query(sql, params);
  const { page, nextCursor } = paginate(r.rows, limit);
  const result = { items: page.map(toApiRequestItem), nextCursor };
  if (!raw.cursor) {
    const routes = buildRouteOptionsQuery(raw);
    const rr = await db.query(routes.sql, routes.params);
    result.routeOptions = rr.rows.map((x) => x.route);
  }
  return result;
}

const SUMMARY_SQL = `
  WITH api AS (
    SELECT api_key_id,
           COUNT(*)::int AS calls,
           COUNT(*) FILTER (WHERE status_code >= 400 AND status_code < 500)::int AS errors_4xx,
           COUNT(*) FILTER (WHERE status_code >= 500)::int AS errors_5xx
    FROM integration_api_request_logs
    WHERE created_at >= NOW() - ($1::int * interval '1 hour') AND api_key_id IS NOT NULL
    GROUP BY api_key_id
  ),
  wh AS (
    SELECT e.api_key_id,
           COUNT(*) FILTER (WHERE d.status = 'sent' AND d.created_at >= NOW() - ($1::int * interval '1 hour'))::int AS sent,
           COUNT(*) FILTER (WHERE d.status = 'failed' AND d.created_at >= NOW() - ($1::int * interval '1 hour'))::int AS failed,
           COUNT(*) FILTER (WHERE d.status = 'pending')::int AS pending,
           MIN(d.created_at) FILTER (WHERE d.status = 'pending') AS oldest_pending_at,
           MAX(d.sent_at) AS last_sent_at
    FROM integration_webhook_deliveries d
    JOIN integration_webhook_endpoints e ON e.id = d.endpoint_id
    GROUP BY e.api_key_id
  ),
  ep AS (
    SELECT api_key_id, COUNT(*) FILTER (WHERE active)::int AS active_endpoints
    FROM integration_webhook_endpoints
    GROUP BY api_key_id
  )
  SELECT k.id, k.partner_name, k.active, k.last_used_at,
         COALESCE(api.calls, 0) AS calls,
         COALESCE(api.errors_4xx, 0) AS errors_4xx,
         COALESCE(api.errors_5xx, 0) AS errors_5xx,
         COALESCE(ep.active_endpoints, 0) AS active_endpoints,
         COALESCE(wh.sent, 0) AS webhooks_sent,
         COALESCE(wh.failed, 0) AS webhooks_failed,
         COALESCE(wh.pending, 0) AS webhooks_pending,
         wh.oldest_pending_at, wh.last_sent_at
  FROM integration_api_keys k
  LEFT JOIN api ON api.api_key_id = k.id
  LEFT JOIN wh ON wh.api_key_id = k.id
  LEFT JOIN ep ON ep.api_key_id = k.id
  WHERE ($2::bigint IS NULL OR k.id = $2)
  ORDER BY LOWER(k.partner_name), k.id`;

function toSummaryItem(row) {
  return {
    keyId: Number(row.id),
    partnerName: row.partner_name,
    active: Boolean(row.active),
    lastApiCallAt: iso(row.last_used_at),
    apiCalls: row.calls,
    apiErrors4xx: row.errors_4xx,
    apiErrors5xx: row.errors_5xx,
    activeWebhookEndpoints: row.active_endpoints,
    webhooksSent: row.webhooks_sent,
    webhooksFailed: row.webhooks_failed,
    webhooksPending: row.webhooks_pending,
    oldestPendingAt: iso(row.oldest_pending_at),
    lastWebhookSentAt: iso(row.last_sent_at),
  };
}

/** @param {import('pg').Pool} db @param {{ keyId?: unknown, hours?: unknown }} raw */
export async function getActivitySummary(db, raw = {}) {
  const hoursRaw = parsePositiveInt(raw.hours) ?? SUMMARY_DEFAULT_HOURS;
  const hours = Math.min(hoursRaw, SUMMARY_MAX_HOURS);
  const r = await db.query(SUMMARY_SQL, [hours, parsePositiveInt(raw.keyId)]);
  return { hours, partners: r.rows.map(toSummaryItem) };
}

/**
 * Retry a failed delivery by its public id, resolving endpoint and key server-side.
 * @param {import('pg').Pool} db
 */
export async function retryFailedDeliveryById(db, deliveryId) {
  const r = await db.query(
    `SELECT e.id AS endpoint_id, e.api_key_id
     FROM integration_webhook_deliveries d
     JOIN integration_webhook_endpoints e ON e.id = d.endpoint_id
     WHERE d.delivery_id = $1`,
    [deliveryId]
  );
  if (r.rows.length === 0) return { error: 'not_found' };
  const { endpoint_id: endpointId, api_key_id: apiKeyId } = r.rows[0];
  return retryFailedWebhookDelivery(db, Number(apiKeyId), Number(endpointId), deliveryId);
}
