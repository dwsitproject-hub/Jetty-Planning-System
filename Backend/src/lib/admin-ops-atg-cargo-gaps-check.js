/**
 * System Health Dashboard — ATG cargo coverage gaps during logged cargo segments.
 */
import { scanAtgCargoGaps } from './atg-cargo-gap-scan.js';
import { loadLastResyncByOperation } from './atg-cargo-gap-store.js';
import { loadActiveJobs } from './atg-gap-jobs.js';

const CHECK_ID = 'atg_cargo_gaps';
const CHECK_TITLE = 'ATG cargo coverage';

function checkResult(status, summary, details = {}) {
  return { id: CHECK_ID, title: CHECK_TITLE, status, summary, details, actionHref: null, actionLabel: null };
}

function buildSummary(scan, openOps) {
  const { liveWithRecentGap } = scan.severity;
  if (scan.totalWithGaps === 0) return `No ATG coverage gaps in the last ${scan.lookbackDays} days`;
  if (openOps === 0) return `All ATG gaps in the last ${scan.lookbackDays} days are resolved or acknowledged`;
  if (liveWithRecentGap > 0) {
    return `${liveWithRecentGap} vessel(s) at berth lost ATG in the last ${scan.recentWindowMinutes / 60} h · ${openOps} operation(s) need review`;
  }
  return `${openOps} operation(s) with open ATG gaps (last ${scan.lookbackDays} days)`;
}

/**
 * @param {import('pg').Pool} db
 */
export async function checkAtgCargoGaps(db) {
  try {
    const scan = await scanAtgCargoGaps(db);
    const operationIds = scan.operations.map((op) => op.operationId);
    const lastResync = await loadLastResyncByOperation(db, operationIds);
    const activeJobs = await loadActiveJobs(db, operationIds);
    const openOps = scan.operations.filter((op) => op.openGapCount > 0).length;

    return checkResult(scan.severity.status, buildSummary(scan, openOps), {
      lookbackDays: scan.lookbackDays,
      minGapMinutes: scan.minGapMinutes,
      recentWindowMinutes: scan.recentWindowMinutes,
      totalWithGaps: scan.totalWithGaps,
      openOperations: openOps,
      truncated: scan.truncated,
      liveWithRecentGap: scan.severity.liveWithRecentGap,
      liveWithOlderGap: scan.severity.liveWithOlderGap,
      completedWithGaps: scan.severity.completedWithGaps,
      operations: scan.operations.map((op) => ({
        operationId: op.operationId,
        portId: op.portId,
        portName: op.portName,
        planRef: op.planRef,
        vesselName: op.vesselName,
        operationLabel: op.operationLabel,
        atBerth: op.atBerth,
        longestGapMinutes: op.longestGapMinutes,
        totalGapMinutes: op.totalGapMinutes,
        openGapCount: op.openGapCount,
        acknowledgedGapCount: op.acknowledgedGapCount,
        lastResync: lastResync.get(op.operationId) ?? null,
        activeJob: activeJobs.get(op.operationId) ?? null,
        gaps: op.gaps,
      })),
    });
  } catch (err) {
    return checkResult('unknown', err?.message || 'Gap scan failed', { error: err?.message || String(err) });
  }
}
