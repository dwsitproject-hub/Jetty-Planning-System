/** Client-side filter + KPI helpers for cargo movement board. */

const ANOMALY_STATUSES = new Set(['sample_gap', 'qty_mismatch']);

export function tankMatchesSearch(tank, query) {
  if (!query || !query.trim()) return true;
  const q = query.trim().toLowerCase();
  const hay = [
    tank.code,
    tank.name,
    ...(tank.segments || []).map((s) => s.vesselName),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

export function tankHasAnomaly(tank) {
  if (tank.sourceLastPollOk === false) return true;
  return (tank.segments || []).some((s) => ANOMALY_STATUSES.has(s.atgAuditStatus));
}

export function computeBoardKpis(tanks) {
  let anomalyCount = 0;
  let gapCount = 0;
  let pollFaultCount = 0;

  for (const tank of tanks) {
    const hasGap = (tank.segments || []).some((s) => s.atgAuditStatus === 'sample_gap');
    const hasMismatch = (tank.segments || []).some((s) => s.atgAuditStatus === 'qty_mismatch');
    const pollFault = tank.sourceLastPollOk === false;

    if (tankHasAnomaly(tank)) anomalyCount += 1;
    if (hasGap) gapCount += 1;
    if (pollFault) pollFaultCount += 1;
    if (hasMismatch && !hasGap) gapCount += 0; // gapCount is sample_gap tanks only
  }

  const sampleGapSegments = tanks.reduce(
    (n, t) => n + (t.segments || []).filter((s) => s.atgAuditStatus === 'sample_gap').length,
    0
  );

  return {
    anomalyCount,
    gapCount: sampleGapSegments,
    pollFaultCount,
  };
}

export function filterCargoMovementTanks(tanks, filters) {
  const { search, anomaliesOnly, atgOnly, hideIdle } = filters;
  return (tanks || []).filter((tank) => {
    const segCount = tank.segments?.length ?? 0;
    if (hideIdle && segCount === 0) return false;
    if (atgOnly && !tank.hasAtg) return false;
    if (anomaliesOnly && !tankHasAnomaly(tank)) return false;
    if (!tankMatchesSearch(tank, search)) return false;
    return true;
  });
}

export function segmentBandStyle(status) {
  switch (status) {
    case 'manual_override':
      return { fill: '#cbd5e1', stroke: '#64748b', strokeWidth: 1.5, fillOpacity: 0.55 };
    case 'sample_gap':
      return { fill: '#fef3c7', stroke: '#d97706', strokeWidth: 1.5, fillOpacity: 0.5 };
    case 'qty_mismatch':
      return { fill: '#fee2e2', stroke: '#b91c1c', strokeWidth: 1.5, fillOpacity: 0.45 };
    case 'in_progress':
      return { fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 1.5, fillOpacity: 0.35, strokeDasharray: '4 3' };
    default:
      return { fill: '#166534', stroke: '#14532d', strokeWidth: 1, fillOpacity: 0.35 };
  }
}

export function formatMass(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 3 });
}
