/** Key numbers shown on a System Health summary card, picked from each check's details. */
import { formatCount, formatRelativeTime } from './adminOpsDisplay.js'

const sum = (rows, key) => (rows ?? []).reduce((n, r) => n + (Number(r?.[key]) || 0), 0)

const BUILDERS = {
  atg_sync: (d) => [
    { labelKey: 'adminOpsKeyStaleSources', value: `${formatCount(sum(d.ports, 'staleCount'))} / ${formatCount(sum(d.ports, 'totalEnabled'))}` },
  ],
  atg_cargo_gaps: (d) => [
    { labelKey: 'adminOpsKeyOpenGapOps', value: formatCount(d.openOperations ?? d.totalWithGaps ?? 0) },
    { labelKey: 'adminOpsKeyLiveRecent', value: formatCount(d.liveWithRecentGap ?? 0) },
  ],
  manual_override: (d) => [
    { labelKey: 'adminOpsKeyOverrideTanks', value: formatCount(d.total ?? 0) },
    { labelKey: 'adminOpsKeyOverrideNoExpiry', value: formatCount(d.noExpiry ?? 0) },
  ],
  purge_job: (d) => [
    { labelKey: 'adminOpsKeyLastPurge', value: formatRelativeTime(d.lastBatch?.lastActedAt) },
  ],
  synology_mount: (d) => [
    { labelKey: 'adminOpsKeyWritable', value: d.writable ? 'yes' : 'no', translateValue: true },
    d.heartbeat
      ? { labelKey: 'adminOpsKeyHeartbeat', value: formatRelativeTime(d.heartbeat.checkedAt) }
      : { labelKey: 'adminOpsKeyHeartbeat', value: 'none', translateValue: true },
  ],
  datahub: (d) => [
    { labelKey: 'adminOpsKeyLastSync', value: formatRelativeTime(d.lastSyncAt) },
  ],
  partner_api: (d) => [
    { labelKey: 'adminOpsKeyActiveKeys', value: formatCount(d.activeKeys ?? 0) },
    { labelKey: 'adminOpsKeyLastActivity', value: formatRelativeTime(d.lastActivityAt) },
  ],
}

/**
 * @param {{ id: string, details?: object }} check
 * @returns {Array<{ labelKey: string, value: string, translateValue?: boolean }>}
 */
export function checkHighlights(check) {
  const build = BUILDERS[check?.id]
  if (!build || !check.details || check.details.error) return []
  return build(check.details)
}
