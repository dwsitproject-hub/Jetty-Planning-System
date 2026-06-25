import PurposeBadge, { resolvePurposeLabel } from './PurposeBadge'
import EtcBreachBadge from './EtcBreachBadge'

function GanttVesselIcon() {
  return (
    <svg className="jetty-schedule-gantt__bar-ship" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M2 20h20v2H2v-2zm2-2h16l-2-6H6L4 18zm2.5-8L8 6h8l.5 2 2.5 4H7L6.5 10z"
      />
    </svg>
  )
}

function GanttCompletedIcon() {
  return (
    <svg className="jetty-schedule-gantt__bar-ship" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M9.2 16.6 4.9 12.3l1.4-1.4 2.9 2.9 8-8 1.4 1.4-9.4 9.4z" />
    </svg>
  )
}

function PhaseIcon({ kind }) {
  if (kind === 'berthing') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M12 2 7 9h3v8h4V9h3L12 2z" />
      </svg>
    )
  }
  if (kind === 'atBerthOps') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M2 20h20v2H2v-2zm16-8-4-4V4h2v3.17L18.83 10H18V12h2v2h-2v2h-2v-2H8v2H6v-2H4v-2h2v-2H4V10h10V8H8V6h10v6z"
        />
      </svg>
    )
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9 2h6a2 2 0 0 1 2 2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2-2zm0 2v2h6V4H9zm-4 4v12h14V8H5z"
      />
    </svg>
  )
}

export default function ActualPhaseSegment({
  phase,
  phaseModel,
  seg,
  row,
  showVesselName = false,
  showPurpose = false,
  barWidthPct,
  onClick,
  canClick,
}) {
  const isSailed = phaseModel.isSailed || seg.status === 'Sailed off'
  const statusIcon = isSailed ? <GanttCompletedIcon /> : <GanttVesselIcon />
  const purposeLabel = resolvePurposeLabel(
    seg.purposeLabel || row.planPurposeLabel || row.purpose,
    seg.loadDischarge ?? row.loadDischarge
  )
  const showOverdueBadge =
    phaseModel.etcOverdue &&
    phaseModel.etcOverduePhase === phase.kind &&
    phaseModel.overMs != null &&
    (barWidthPct == null || barWidthPct >= 0.35)

  const className = [
    'jetty-schedule-gantt__phase-segment',
    `jetty-schedule-gantt__phase-segment--${phase.kind}`,
    phase.openEnd ? 'jetty-schedule-gantt__phase-segment--open-end' : '',
    phase.isFirst ? 'jetty-schedule-gantt__phase-segment--first' : '',
    phase.isLast ? 'jetty-schedule-gantt__phase-segment--last' : '',
    phaseModel.etcOverdue && phaseModel.etcOverduePhase === phase.kind
      ? 'jetty-schedule-gantt__phase-segment--overdue'
      : '',
    isSailed ? 'jetty-schedule-gantt__phase-segment--sailed' : '',
    canClick ? 'jetty-schedule-gantt__phase-segment--btn' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const inner = (
    <>
      <span className="jetty-schedule-gantt__phase-segment-icon" aria-hidden="true">
        <PhaseIcon kind={phase.kind} />
      </span>
      {showVesselName ? (
        <>
          {statusIcon}
          <span className="jetty-schedule-gantt__bar-text">{seg.vesselName}</span>
        </>
      ) : null}
      {showPurpose && purposeLabel ? (
        <PurposeBadge purpose={purposeLabel} loadDischarge={seg.loadDischarge ?? row.loadDischarge} />
      ) : null}
      {showOverdueBadge ? (
        <EtcBreachBadge overMs={phaseModel.overMs} etcMs={phaseModel.estCompMs} size="icon-only" />
      ) : null}
    </>
  )

  if (canClick) {
    return (
      <button type="button" className={className} onClick={onClick} aria-label={seg.vesselName}>
        {inner}
      </button>
    )
  }

  return (
    <span className={className} role="img" aria-label={seg.vesselName}>
      {inner}
    </span>
  )
}
