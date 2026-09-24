/**
 * System Health Dashboard — Partner Integration API usage telemetry.
 */
export const PARTNER_API_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @typedef {'healthy'|'degraded'|'unhealthy'|'unknown'|'disabled'} OpsStatus
 */

/**
 * @param {{ activeKeys: number, lastActivityAt: string | null | undefined }} input
 * @param {number} [nowMs]
 * @param {number} [staleMs]
 * @returns {OpsStatus}
 */
export function derivePartnerApiStatus(input, nowMs = Date.now(), staleMs = PARTNER_API_STALE_MS) {
  const activeKeys = Number(input.activeKeys) || 0;
  if (activeKeys === 0) return 'disabled';

  const lastActivityAt = input.lastActivityAt ?? null;
  if (!lastActivityAt) return 'unknown';

  const t = new Date(lastActivityAt).getTime();
  if (Number.isNaN(t)) return 'unknown';

  const ageMs = nowMs - t;
  if (ageMs <= staleMs) return 'healthy';
  return 'degraded';
}

/**
 * @param {OpsStatus} status
 * @param {number} activeKeys
 * @param {string | null} lastActivityAt
 * @param {number} [nowMs]
 */
export function buildPartnerApiSummary(status, activeKeys, lastActivityAt, nowMs = Date.now()) {
  if (status === 'disabled') return 'No active partner API keys';

  const n = Number(activeKeys) || 0;
  const keyLabel = `${n} active key${n === 1 ? '' : 's'}`;

  if (status === 'unknown') {
    return `${keyLabel}; no API usage recorded yet`;
  }

  const t = lastActivityAt ? new Date(lastActivityAt).getTime() : NaN;
  const ageDays =
    lastActivityAt && !Number.isNaN(t) ? Math.max(0, Math.round((nowMs - t) / 86400000)) : null;
  const ageText = ageDays === 0 ? 'today' : `${ageDays}d ago`;

  return `${keyLabel}; last activity ${ageText}`;
}

/**
 * @param {string} id
 * @param {string} title
 * @param {OpsStatus} status
 * @param {string} summary
 * @param {object} [details]
 * @param {{ href?: string, label?: string }} [action]
 */
function checkResult(id, title, status, summary, details = {}, action = {}) {
  return {
    id,
    title,
    status,
    summary,
    details,
    actionHref: action.href ?? null,
    actionLabel: action.label ?? null,
  };
}

/**
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {string | null}
 */
function maxIsoTimestamp(a, b) {
  if (!a && !b) return null;
  if (!a) return b ?? null;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

/**
 * @param {import('pg').Pool} db
 */
export async function checkPartnerApi(db) {
  const existsR = await db.query(
    `SELECT to_regclass('public.integration_api_keys') IS NOT NULL AS keys_ok,
            to_regclass('public.integration_submissions') IS NOT NULL AS subs_ok`
  );
  const { keys_ok: keysOk, subs_ok: subsOk } = existsR.rows[0] ?? {};
  if (!keysOk || !subsOk) {
    return checkResult(
      'partner_api',
      'Partner Integration API',
      'unknown',
      'Partner API tables not found (run migrations)',
      {}
    );
  }

  const aggR = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE active)::int AS active_keys,
       COUNT(*) FILTER (WHERE NOT active)::int AS inactive_keys,
       MAX(last_used_at) FILTER (WHERE active) AS last_used_at
     FROM integration_api_keys`
  );
  const agg = aggR.rows[0] ?? {};

  const subsR = await db.query(
    `SELECT
       MAX(received_at) AS last_submission_at,
       COUNT(*) FILTER (WHERE received_at > NOW() - INTERVAL '7 days')::int AS submissions_last_7d
     FROM integration_submissions`
  );
  const subs = subsR.rows[0] ?? {};

  const partnersR = await db.query(
    `SELECT
       k.id,
       k.partner_name,
       k.key_prefix,
       k.last_used_at,
       MAX(s.received_at) AS last_submission_at,
       COUNT(s.id) FILTER (WHERE s.received_at > NOW() - INTERVAL '30 days')::int AS submissions_last_30d
     FROM integration_api_keys k
     LEFT JOIN integration_submissions s ON s.api_key_id = k.id
     WHERE k.active
     GROUP BY k.id, k.partner_name, k.key_prefix, k.last_used_at
     ORDER BY LOWER(k.partner_name), k.id`
  );

  const activeKeys = Number(agg.active_keys) || 0;
  const inactiveKeys = Number(agg.inactive_keys) || 0;
  const lastUsedAt = agg.last_used_at ?? null;
  const lastSubmissionAt = subs.last_submission_at ?? null;
  const lastActivityAt = maxIsoTimestamp(lastUsedAt, lastSubmissionAt);
  const submissionsLast7d = Number(subs.submissions_last_7d) || 0;

  const status = derivePartnerApiStatus({ activeKeys, lastActivityAt });
  const summary = buildPartnerApiSummary(status, activeKeys, lastActivityAt);

  const partners = partnersR.rows.map((row) => ({
    id: Number(row.id),
    partnerName: row.partner_name,
    keyPrefix: row.key_prefix,
    lastUsedAt: row.last_used_at ?? null,
    lastSubmissionAt: row.last_submission_at ?? null,
    lastActivityAt: maxIsoTimestamp(row.last_used_at, row.last_submission_at),
    submissionsLast30d: Number(row.submissions_last_30d) || 0,
  }));

  return checkResult(
    'partner_api',
    'Partner Integration API',
    status,
    summary,
    {
      activeKeys,
      inactiveKeys,
      lastUsedAt,
      lastSubmissionAt,
      lastActivityAt,
      submissionsLast7d,
      staleThresholdDays: PARTNER_API_STALE_MS / 86400000,
      partners,
    }
  );
}
