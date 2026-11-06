/**
 * System Health Dashboard — ATG cargo coverage gaps during logged cargo segments.
 */
import { scanAtgCargoGaps } from './atg-cargo-gap-scan.js';
/**
 * @param {string} id
 * @param {string} title
 * @param {string} status
 * @param {string} summary
 * @param {object} details
 */
function checkResult(id, title, status, summary, details = {}) {
  return {
    id,
    title,
    status,
    summary,
    details,
    actionHref: null,
    actionLabel: null,
  };
}

/**
 * @param {import('pg').Pool} db
 */
export async function checkAtgCargoGaps(db) {
  try {
    const scan = await scanAtgCargoGaps(db);
    const { status, liveWithRecentGap, completedWithGaps } = scan.severity;
    const total = scan.totalWithGaps ?? scan.operations.length;

    let summary;
    if (total === 0) {
      summary = `No ATG coverage gaps in the last ${scan.lookbackDays} days`;
    } else if (liveWithRecentGap > 0) {
      summary = `${liveWithRecentGap} vessel(s) at berth with recent ATG gaps · ${total} total in ${scan.lookbackDays}d window`;
    } else {
      summary = `${total} operation(s) with ATG gaps (last ${scan.lookbackDays} days)`;
    }

    return checkResult('atg_cargo_gaps', 'ATG cargo coverage', status, summary, {
      lookbackDays: scan.lookbackDays,
      minGapMinutes: scan.minGapMinutes,
      totalWithGaps: total,
      truncated: scan.truncated,
      liveWithRecentGap,
      completedWithGaps,
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
        segmentCountWithGaps: op.segmentCountWithGaps,
        gaps: op.gaps,
        unionGaps: op.unionGaps,
      })),
    });
  } catch (err) {
    return checkResult(
      'atg_cargo_gaps',
      'ATG cargo coverage',
      'unknown',
      err?.message || 'Gap scan failed',
      { error: err?.message || String(err) }
    );
  }
}
