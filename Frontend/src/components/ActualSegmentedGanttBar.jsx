import { useTranslation } from 'react-i18next'
import InteractiveTooltip from './InteractiveTooltip'
import ActualPhaseSegment from './ActualPhaseSegment'
import { segmentTrackStyleFromMs } from '../utils/actualGanttPhases.js'

const PHASE_LABEL_KEYS = {
  berthing: 'ganttPhaseBerthing',
  atBerthOps: 'ganttPhaseAtBerthOps',
  clearance: 'ganttPhaseClearance',
}

const PHASE_NUMBER = { berthing: 1, atBerthOps: 2, clearance: 3 }

export default function ActualSegmentedGanttBar({
  row,
  seg,
  phaseModel,
  trackSegments,
  windowStartMs,
  totalMs,
  stackIndex = 0,
  showPhaseLabels = false,
  onSelectVessel,
}) {
  const { t } = useTranslation('allocation')
  const canClick = Boolean(seg.vesselId && typeof onSelectVessel === 'function')
  const barTop = 6 + stackIndex * 26
  const labelTop = barTop + 24

  const widestIdx = trackSegments.reduce(
    (best, p, idx) =>
      p.endMs - p.startMs > (trackSegments[best]?.endMs - trackSegments[best]?.startMs || 0) ? idx : best,
    0
  )

  const tooltipItems = phaseModel.tooltipPhases.map((p) => ({
    primary: `${p.label}: From ${p.fromLabel} (${p.fromShort}) to ${p.toLabel} (${p.toShort})`,
    secondary: p.duration,
  }))
  if (canClick) {
    tooltipItems.push({ primary: t('ganttClickVesselDetail', { defaultValue: 'Click to open vessel details.' }) })
  }

  const tooltipTitle = t('ganttTooltipMilestonesTitle', { defaultValue: 'Actual Schedule Milestones' })
  const ariaLabel = [seg.vesselName, seg.purposeLabel, seg.status].filter(Boolean).join(', ')

  const handleClick = () => {
    if (canClick) onSelectVessel(seg.vesselId)
  }

  const inner = (
    <div className="jetty-schedule-gantt__segmented-group" aria-label={ariaLabel}>
      {trackSegments.map((phase, idx) => {
        const pos = segmentTrackStyleFromMs(phase.startMs, phase.endMs, windowStartMs, totalMs)
        if (!pos) return null
        const { rawWidthPct, ...posStyle } = pos
        return (
          <div
            key={`${phase.key}-${phase.startMs}`}
            className="jetty-schedule-gantt__bar-slot jetty-schedule-gantt__bar-slot--phase"
            style={{ ...posStyle, top: `${barTop}px` }}
          >
            <ActualPhaseSegment
              phase={phase}
              phaseModel={phaseModel}
              seg={seg}
              row={row}
              showVesselName={idx === 0}
              showPurpose={phase.kind === 'atBerthOps' || idx === widestIdx}
              barWidthPct={rawWidthPct}
              canClick={canClick}
              onClick={handleClick}
            />
          </div>
        )
      })}
      {showPhaseLabels && trackSegments.length ? (
        <div className="jetty-schedule-gantt__phase-labels-row" style={{ top: `${labelTop}px` }}>
          {trackSegments.map((phase) => {
            const pos = segmentTrackStyleFromMs(phase.startMs, phase.endMs, windowStartMs, totalMs)
            if (!pos) return null
            const title = t(PHASE_LABEL_KEYS[phase.kind], { defaultValue: phase.label })
            return (
              <span
                key={`label-${phase.key}`}
                className="jetty-schedule-gantt__phase-label-block"
                style={{ left: pos.left, width: pos.width }}
              >
                <span className="jetty-schedule-gantt__phase-label-title">
                  {PHASE_NUMBER[phase.kind]}. {title}
                </span>
              </span>
            )
          })}
        </div>
      ) : null}
    </div>
  )

  return (
    <InteractiveTooltip
      title={tooltipTitle}
      subtitle={seg.vesselName}
      items={tooltipItems}
      emptyText="No details."
      placement="right"
      interactiveChild={canClick}
    >
      {inner}
    </InteractiveTooltip>
  )
}
