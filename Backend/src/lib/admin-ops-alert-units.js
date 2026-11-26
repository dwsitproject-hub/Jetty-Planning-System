/**
 * System Health alert units (per-check + per-port ATG) for email job state keys.
 */

/** @type {Array<{ id: string, title: string, supportsPerPort?: boolean }>} */
export const ADMIN_OPS_ALERT_CHECK_CATALOG = [
  { id: 'atg_sync', title: 'ATG sync', supportsPerPort: true },
  { id: 'atg_cargo_gaps', title: 'ATG cargo coverage' },
  { id: 'manual_override', title: 'Tank manual override' },
  { id: 'purge_job', title: 'ATG data purging' },
  { id: 'synology_mount', title: 'Synology upload mount' },
  { id: 'datahub', title: 'DataHub API' },
  { id: 'partner_api', title: 'Partner Integration API' },
];

/**
 * Any silent source raises an alert: the other sources keep a port looking fine while one
 * source's tanks lose readings. Gaps that already ended are shown on the card but do not alert.
 * @param {{ totalEnabled?: number, staleCount?: number, allHealthy?: boolean, portName?: string }} portRow
 * @returns {'healthy'|'degraded'|'unhealthy'|'unknown'}
 */
export function deriveAtgPortAlertStatus(portRow) {
  const totalEnabled = Number(portRow?.totalEnabled) || 0;
  const staleCount = Number(portRow?.staleCount) || 0;
  if (totalEnabled === 0) return 'unknown';
  if (staleCount === 0) return 'healthy';
  return 'unhealthy';
}

/**
 * @param {{ id: string, title: string, status: string, summary: string, details?: object }} check
 * @returns {Array<{ stateKey: string, checkId: string, portId: number | null, title: string, status: string, summary: string }>}
 */
export function buildAlertUnitsFromChecks(checks) {
  /** @type {Array<{ stateKey: string, checkId: string, portId: number | null, title: string, status: string, summary: string }>} */
  const units = [];
  for (const check of checks ?? []) {
    if (check.id === 'atg_sync' && Array.isArray(check.details?.ports)) {
      for (const port of check.details.ports) {
        const portId = Number(port.portId);
        if (!Number.isFinite(portId)) continue;
        const status = deriveAtgPortAlertStatus(port);
        const portName = port.portName || `Port ${portId}`;
        const summary =
          status === 'unhealthy'
            ? `${portName}: ${port.staleCount ?? 0} of ${port.totalEnabled ?? 0} ATG source(s) silent`
            : status === 'healthy'
              ? `${portName}: ATG sources in sync`
              : `${portName}: ATG sync status unknown`;
        units.push({
          stateKey: `atg_sync:port:${portId}`,
          checkId: 'atg_sync',
          portId,
          title: `ATG sync — ${portName}`,
          status,
          summary,
        });
      }
      continue;
    }
    units.push({
      stateKey: check.id,
      checkId: check.id,
      portId: null,
      title: check.title,
      status: check.status,
      summary: check.summary,
    });
  }
  return units;
}

/**
 * @param {{ checkId: string, portId: number | null }} unit
 * @param {Map<string, string>} recipientMap key `${checkId}\0${portId ?? ''}`
 * @param {string} defaultEmail
 */
export function resolveRecipientForUnit(unit, recipientMap, defaultEmail) {
  const portKey = `${unit.checkId}\0${unit.portId ?? ''}`;
  const checkKey = `${unit.checkId}\0`;
  const specific = recipientMap.get(portKey);
  if (specific && String(specific).trim()) return String(specific).trim();
  const checkLevel = recipientMap.get(checkKey);
  if (checkLevel && String(checkLevel).trim()) return String(checkLevel).trim();
  return String(defaultEmail || '').trim();
}

/**
 * @param {Array<{ check_id: string, port_id: number | null, recipient_email: string }>} rows
 */
export function recipientRowsToMap(rows) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const row of rows ?? []) {
    const key = `${row.check_id}\0${row.port_id ?? ''}`;
    map.set(key, String(row.recipient_email || '').trim());
  }
  return map;
}