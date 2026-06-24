import { useTranslation } from 'react-i18next'
import InteractiveTooltip from './InteractiveTooltip'
import PurposeBadge, { resolvePurposeLabel } from './PurposeBadge'
import EtcBreachBadge from './EtcBreachBadge'
import { buildActualPhases, phaseLayout } from '../utils/actualGanttPhases.js'
// phaseModel + layout may be precomputed by parent (avoids render-null gap vs single-bar fallback)

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

function MilestoneAnchorIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 2 7 9h3v8h4V9h3L12 2z" />
    </svg>
  )
}

function MilestoneCraneIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M2 20h20v2H2v-2zm16-8-4-4V4h2v3.17L18.83 10H18V12h2v2h-2v2h-2v-2H8v2H6v-2H4v-2h2v-2H4V10h10V8H8V6h10v6z"
      />
    </svg>
  )
}

function MilestoneWrenchIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M22.7 19.3 17.4 14l1.4-1.4 1.6 1.6 2.1-2.1-1.6-1.6 1.4-1.4 5.3 5.3-4.5 4.5zm-8.2-8.2L14 10.7 9.7 6.4C10.8 4.9 10.5 2.8 8.9 1.3 7.1-.5 4.2-.5 2.4 1.3S.5 6.1 2.3 7.9c1.5 1.6 3.6 1.9 5.1.8l4.3 4.3 1.5-1.5 4.3 4.3-1.5 1.5z"
      />
    </svg>
  )
}

function MilestoneClipboardIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9 2h6a2 2 0 0 1 2 2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2-2zm0 2v2h6V4H9zm-4 4v12h14V8H5z"
      />
    </svg>
  )
}

const PHASE_LABEL_KEYS = {
  berthing: 'ganttPhaseBerthing',
  atBerthOps: 'ganttPhaseAtBerthOps',
  clearance: 'ganttPhaseClearance',
}

const PHASE_NUMBER = { berthing: 1, atBerthOps: 2, clearance: 3 }

function markerIcon(kind, index, total) {
  if (index === 0) return <MilestoneAnchorIcon />
  if (index === total - 1) return <MilestoneClipboardIcon />
  if (index === 1) return <MilestoneCraneIcon />
  return <MilestoneWrenchIcon />
}

function markerLabel(kind, index, total, milestones) {
  if (index === 0) return 'TB'
  if (index === total - 1) return 'Clearance'
  if (index === 1) return 'Start load'
  return 'Ops end'
}

export default function ActualSegmentedGanttBar({
  row,
  seg,
  phaseModel: phaseModelProp,
  layout: layoutProp,
  posStyle,
  barWidthPct,
  showPhaseLabels = false,
  onSelectVessel,
}) {
  const { t } = useTranslation('allocation')
  const phaseModel =
    phaseModelProp ??
    buildActualPhases(row, Date.now())
  const layout =
    layoutProp ??
    (phaseModel
      ? phaseLayout(phaseModel.phases, phaseModel.barStartMs, phaseModel.barEndMs)
      : [])
  if (!phaseModel || !layout.length) return null

  const purposeLabel = resolvePurposeLabel(seg.purposeLabel || row.planPurposeLabel || row.purpose, seg.loadDischarge ?? row.loadDischarge)
  const canClick = Boolean(seg.vesselId && typeof onSelectVessel === 'function')
  const isSailed = phaseModel.isSailed || seg.status === 'Sailed off'
  const statusIcon = isSailed ? <GanttCompletedIcon /> : <GanttVesselIcon />
  const showOverdueBadge =
    phaseModel.etcOverdue && phaseModel.overMs != null && (barWidthPct == null || barWidthPct >= 0.48)

  const markerPcts = phaseModel.markers.map(
    (ms) => ((ms - phaseModel.barStartMs) / (phaseModel.barEndMs - phaseModel.barStartMs)) * 100
  )

  const tooltipItems = phaseModel.tooltipPhases.map((p) => ({
    primary: `${p.label}: From ${p.fromLabel} (${p.fromShort}) to ${p.toLabel} (${p.toShort})`,
    secondary: p.duration,
  }))
  if (canClick) tooltipItems.push({ primary: t('ganttClickVesselDetail', { defaultValue: 'Click to open vessel details.' }) })

  const barClassName = [
    'jetty-schedule-gantt__bar-host',
    canClick ? 'jetty-schedule-gantt__bar-host--btn' : '',
    isSailed ? ' jetty-schedule-gantt__bar-host--sailed' : '',
    phaseModel.openEnd ? ' jetty-schedule-gantt__bar-host--open-end' : '',
  ].join('')

  const style = posStyle

  const inner = (
    <div className="jetty-schedule-gantt__segmented-wrap">
      <div className={`jetty-schedule-gantt__bar jetty-schedule-gantt__bar--actual-segmented${isSailed ? ' jetty-schedule-gantt__bar--st-sailed-off' : ''}`}>
        <div className="jetty-schedule-gantt__actual-phases" aria-hidden="true">
          {layout.map((p) => (
            <div
              key={p.key}
              className={[
                'jetty-schedule-gantt__actual-phase',
                `jetty-schedule-gantt__actual-phase--${p.kind}`,
                p.openEnd ? 'jetty-schedule-gantt__actual-phase--open-end' : '',
                phaseModel.etcOverdue && phaseModel.etcOverduePhase === p.kind
                  ? 'jetty-schedule-gantt__actual-phase--overdue'
                  : '',
              ].join(' ')}
              style={{
                left: `${p.leftPct}%`,
                width: `${p.widthPct}%`,
                minWidth: `${p.minWidthPx}px`,
              }}
            />
          ))}
          {markerPcts.map((pct, i) => (
            <span
              key={`marker-${i}`}
              className="jetty-schedule-gantt__phase-marker"
              style={{ left: `${pct}%` }}
              title={markerLabel(phaseModel.phases[i]?.kind, i, markerPcts.length, phaseModel.milestones)}
            >
              <span className="jetty-schedule-gantt__phase-marker-icon">{markerIcon(phaseModel.phases[i]?.kind, i, markerPcts.length)}</span>
            </span>
          ))}
        </div>
        <div className="jetty-schedule-gantt__bar-overlay">
          {statusIcon}
          <span className="jetty-schedule-gantt__bar-text">{seg.vesselName}</span>
          {purposeLabel ? (
            <PurposeBadge purpose={purposeLabel} loadDischarge={seg.loadDischarge ?? row.loadDischarge} />
          ) : null}
          {showOverdueBadge ? (
            <EtcBreachBadge overMs={phaseModel.overMs} etcMs={phaseModel.estCompMs} size="icon-only" />
          ) : null}
        </div>
      </div>
      {showPhaseLabels ? (
        <div className="jetty-schedule-gantt__phase-labels" aria-hidden="true">
          {layout.map((p) => (
            <span
              key={`label-${p.key}`}
              className="jetty-schedule-gantt__phase-label"
              style={{ left: `${p.leftPct}%`, width: `${p.widthPct}%` }}
            >
              {PHASE_NUMBER[p.kind]}. {t(PHASE_LABEL_KEYS[p.kind], { defaultValue: p.label })}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )

  const ariaLabel = [seg.vesselName, purposeLabel, seg.status].filter(Boolean).join(', ')

  const tooltipTitle = t('ganttTooltipMilestonesTitle', { defaultValue: 'Actual Schedule Milestones' })

  if (canClick) {
    return (
      <InteractiveTooltip
        title={tooltipTitle}
        subtitle={seg.vesselName}
        items={tooltipItems}
        emptyText="No details."
        placement="right"
        interactiveChild
      >
        <button
          type="button"
          className={barClassName}
          style={style}
          aria-label={ariaLabel}
          onClick={() => onSelectVessel(seg.vesselId)}
        >
          {inner}
        </button>
      </InteractiveTooltip>
    )
  }

  return (
    <InteractiveTooltip
      title={tooltipTitle}
      subtitle={seg.vesselName}
      items={tooltipItems}
      emptyText="No details."
      placement="right"
    >
      <span className={barClassName} style={style} role="img" aria-label={ariaLabel}>
        {inner}
      </span>
    </InteractiveTooltip>
  )
}
