/**
 * Admin Operations Dashboard — extensible health check registry.
 * Each check returns a normalized card payload for GET /api/v1/admin-ops/status.
 */
import fs from 'node:fs';
import path from 'node:path';
import { computeAtgSyncHealth, DEFAULT_ATG_STALE_MS } from './dashboard-atg-sync-health.js';
import { getDataHubConfigForAdmin } from './datahub-config.js';
import { checkPartnerApi } from './admin-ops-partner-api-check.js';
import { UPLOAD_ROOT } from '../paths.js';

export const MOUNT_HEALTH_FILENAME = '.jps-mount-health.json';
const PURGE_STALE_MS = 48 * 60 * 60 * 1000;
const DATAHUB_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const HEARTBEAT_STALE_MS = 30 * 60 * 1000;

/**
 * @typedef {'healthy'|'degraded'|'unhealthy'|'unknown'|'disabled'} OpsStatus
 */

/**
 * @param {OpsStatus[]} statuses
 * @returns {OpsStatus}
 */
export function deriveOverallStatus(statuses) {
  const active = statuses.filter((s) => s !== 'disabled');
  if (active.length === 0) return 'disabled';
  const order = ['unhealthy', 'degraded', 'unknown', 'healthy'];
  for (const level of order) {
    if (active.includes(level)) return level;
  }
  return 'unknown';
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

function ageMs(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Date.now() - t;
}

/**
 * @param {import('pg').Pool} db
 */
export async function checkAtgSync(db) {
  const portsR = await db.query(
    `SELECT id, name FROM ports WHERE deleted_at IS NULL ORDER BY LOWER(name), id`
  );
  const ports = [];
  let totalEnabled = 0;
  let totalStale = 0;

  for (const port of portsR.rows) {
    const health = await computeAtgSyncHealth(db, Number(port.id));
    totalEnabled += health.totalEnabled;
    totalStale += health.staleCount;
    ports.push({
      portId: port.id,
      portName: port.name,
      totalEnabled: health.totalEnabled,
      staleCount: health.staleCount,
      allHealthy: health.allHealthy,
      staleSources: health.staleSources.map((s) => ({
        label: s.label || s.baseUrl,
        staleMinutes: s.staleMinutes,
        lastError: s.lastError,
      })),
    });
  }

  let status = 'unknown';
  if (totalEnabled === 0) {
    status = 'unknown';
  } else if (totalStale === 0) {
    status = 'healthy';
  } else if (totalStale < totalEnabled) {
    status = 'degraded';
  } else {
    status = 'unhealthy';
  }

  const summary =
    totalEnabled === 0
      ? 'No enabled ATG sources configured'
      : totalStale === 0
        ? `${totalEnabled} source(s) in sync across ${ports.length} port(s)`
        : `${totalStale} of ${totalEnabled} source(s) stale (threshold ${DEFAULT_ATG_STALE_MS / 60000} min)`;

  return checkResult('atg_sync', 'ATG sync', status, summary, {
    ports,
    staleThresholdMinutes: DEFAULT_ATG_STALE_MS / 60000,
  });
}

/**
 * @param {import('pg').Pool} db
 */
export async function checkPurgeJob(db) {
  const existsR = await db.query(
    `SELECT to_regclass('public.tank_gauging_purge_log') IS NOT NULL AS ok`
  );
  if (!existsR.rows[0]?.ok) {
    return checkResult(
      'purge_job',
      'ATG sample purge',
      'unknown',
      'Purge audit table not found (run migrations)',
      {},
      { href: '/Docs/Guide/ATG-SAMPLE-PURGE-READINESS.md', label: 'Runbook' }
    );
  }

  const lastR = await db.query(
    `SELECT batch_id, action, COUNT(*)::int AS row_count, MAX(acted_at) AS last_acted_at
     FROM tank_gauging_purge_log
     GROUP BY batch_id, action
     ORDER BY last_acted_at DESC
     LIMIT 6`
  );

  const lastBatchR = await db.query(
    `SELECT batch_id, MAX(acted_at) AS last_acted_at,
            COUNT(*) FILTER (WHERE action = 'archive')::int AS archived,
            COUNT(*) FILTER (WHERE action = 'delete')::int AS deleted
     FROM tank_gauging_purge_log
     GROUP BY batch_id
     ORDER BY last_acted_at DESC
     LIMIT 1`
  );

  const lastBatch = lastBatchR.rows[0] ?? null;
  const lastAt = lastBatch?.last_acted_at ?? null;
  const age = ageMs(lastAt);

  let status = 'unknown';
  if (!lastAt) {
    status = 'unknown';
  } else if (age != null && age <= PURGE_STALE_MS) {
    status = 'healthy';
  } else if (age != null && age <= PURGE_STALE_MS * 3) {
    status = 'degraded';
  } else {
    status = 'unhealthy';
  }

  const summary = !lastAt
    ? 'No purge runs recorded yet'
    : `Last batch ${lastBatch.batch_id?.slice(0, 8) ?? '—'}… at ${new Date(lastAt).toISOString()} (archive ${lastBatch.archived ?? 0}, delete ${lastBatch.deleted ?? 0})`;

  return checkResult('purge_job', 'ATG sample purge', status, summary, {
    lastBatch: lastBatch
      ? {
          batchId: lastBatch.batch_id,
          lastActedAt: lastAt,
          archived: lastBatch.archived,
          deleted: lastBatch.deleted,
          ageHours: age != null ? Math.round(age / 3600000) : null,
        }
      : null,
    recentRuns: lastR.rows.map((r) => ({
      batchId: r.batch_id,
      action: r.action,
      rowCount: r.row_count,
      lastActedAt: r.last_acted_at,
    })),
    expectedCadence: 'Daily ~02:20 server time (cron)',
  });
}

/**
 * Reads host cron heartbeat + lightweight upload-dir probes (container bind mount).
 */
export async function checkSynologyMount() {
  const uploadRoot = UPLOAD_ROOT;
  const heartbeatPath = path.join(uploadRoot, MOUNT_HEALTH_FILENAME);
  let heartbeat = null;
  try {
    if (fs.existsSync(heartbeatPath)) {
      heartbeat = JSON.parse(fs.readFileSync(heartbeatPath, 'utf8'));
    }
  } catch {
    heartbeat = null;
  }

  let writable = false;
  let operationsCount = null;
  try {
    fs.accessSync(uploadRoot, fs.constants.W_OK);
    writable = true;
    const opsDir = path.join(uploadRoot, 'operations');
    if (fs.existsSync(opsDir)) {
      operationsCount = fs.readdirSync(opsDir).length;
    }
  } catch {
    writable = false;
  }

  const hbAge = ageMs(heartbeat?.checkedAt);
  const hbOk = heartbeat?.ok === true && hbAge != null && hbAge <= HEARTBEAT_STALE_MS;
  const hbFailed = heartbeat?.ok === false && hbAge != null && hbAge <= HEARTBEAT_STALE_MS;

  let status = 'unknown';
  if (hbFailed) {
    status = 'unhealthy';
  } else if (hbOk && writable) {
    status = 'healthy';
  } else if (writable && operationsCount != null && operationsCount >= 10) {
    status = 'degraded';
  } else if (!writable) {
    status = 'unhealthy';
  } else {
    status = 'unknown';
  }

  let summary;
  if (hbFailed) {
    summary = heartbeat.message || 'Host mount check failed';
  } else if (hbOk) {
    summary = heartbeat.message || 'Synology mount healthy (host cron)';
  } else if (!writable) {
    summary = 'Upload directory not writable';
  } else if (heartbeat == null) {
    summary = 'No host mount heartbeat yet — install check-synology-mount.sh cron';
  } else {
    summary = `Mount heartbeat stale (${hbAge != null ? Math.round(hbAge / 60000) : '?'} min ago)`;
  }

  return checkResult('synology_mount', 'Synology upload mount', status, summary, {
    uploadRoot,
    writable,
    operationsCount,
    heartbeat,
    heartbeatStaleMinutes: hbAge != null ? Math.round(hbAge / 60000) : null,
  });
}

/**
 * @param {import('pg').Pool} db
 */
export async function checkDataHub(db) {
  const cfg = await getDataHubConfigForAdmin(db);

  if (!cfg.enabled) {
    return checkResult('datahub', 'DataHub API', 'disabled', 'Integration disabled', { ...cfg });
  }

  if (!cfg.privateKeyConfigured || !cfg.baseUrl) {
    return checkResult(
      'datahub',
      'DataHub API',
      'degraded',
      'Enabled but credentials incomplete',
      { ...cfg }
    );
  }

  const syncAge = ageMs(cfg.lastSyncAt);
  let status = 'unknown';

  if (cfg.lastSyncOk === true && syncAge != null && syncAge <= DATAHUB_STALE_MS) {
    status = 'healthy';
  } else if (cfg.lastSyncOk === false) {
    status = 'unhealthy';
  } else if (cfg.lastSyncAt == null) {
    status = 'unknown';
  } else if (syncAge != null && syncAge > DATAHUB_STALE_MS) {
    status = 'degraded';
  } else {
    status = cfg.lastSyncOk ? 'healthy' : 'degraded';
  }

  const summary =
    cfg.lastSyncAt == null
      ? 'Configured; no sync recorded yet'
      : cfg.lastSyncOk
        ? `Last sync OK at ${new Date(cfg.lastSyncAt).toISOString()}`
        : `Last sync failed: ${cfg.lastError || 'see DataHub settings'}`;

  return checkResult('datahub', 'DataHub API', status, summary, { ...cfg });
}

/** @type {Array<(db: import('pg').Pool) => Promise<object>>} */
export const ADMIN_OPS_CHECK_REGISTRY = [
  checkAtgSync,
  checkPurgeJob,
  (_db) => checkSynologyMount(),
  checkDataHub,
  checkPartnerApi,
];

/**
 * @param {import('pg').Pool} db
 */
export async function runAdminOpsChecks(db) {
  const checks = await Promise.all(ADMIN_OPS_CHECK_REGISTRY.map((fn) => fn(db)));
  return {
    checkedAt: new Date().toISOString(),
    overall: deriveOverallStatus(checks.map((c) => c.status)),
    checks,
  };
}
