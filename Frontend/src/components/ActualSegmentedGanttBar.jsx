import { useTranslation } from 'react-i18next'
import InteractiveTooltip from './InteractiveTooltip'
import ActualPhaseSegment from './ActualPhaseSegment'
import GanttDenseBlock from './GanttDenseBlock'
import { segmentTrackStyleFromMs } from '../utils/actualGanttPhases.js'
import {
  buildActualBlockModel,
  ganttDenseBlockAriaLabel,
  GANTT_BAR_STACK_STEP,
} from '../utils/ganttBarDisplay.js'

export default function ActualSegmentedGanttBar({
  row,
  seg,
  phaseModel,
  trackSegments,
  windowStartMs,
  totalMs,
  stackIndex = 0,
  onSelectVessel,
}) {
  const { t } = useTranslation('allocation')
  const canClick = Boolean(seg.vesselId && typeof onSelectVessel === 'function')
  const barTop = 6 + stackIndex * GANTT_BAR_STACK_STEP

  const blockModel = buildActualBlockModel(seg, row)
  const ariaLabel = ganttDenseBlockAriaLabel(blockModel, 'actual')

  const positions = trackSegments
    .map((phase) => {
      const pos = segmentTrackStyleFromMs(phase.startMs, phase.endMs, windowStartMs, totalMs)
      return pos ? { phase, pos } : null
    })
    .filter(Boolean)

  if (!positions.length) return null

  const groupLeftPct = Math.min(...positions.map(({ pos }) => parseFloat(pos.left)))
  const groupRightPct = Math.max(
    ...positions.map(({ pos }) => parseFloat(pos.left) + parseFloat(pos.width))
  )
  const groupWidthPct = Math.max(0.12, groupRightPct - groupLeftPct)
  const groupRawWidthPct = positions.reduce((max, { pos }) => Math.max(max, pos.rawWidthPct ?? 0), 0)

  const tooltipItems = phaseModel.tooltipPhases.map((p) => ({
    primary: `${p.label}: From ${p.fromLabel} (${p.fromShort}) to ${p.toLabel} (${p.toShort})`,
    secondary: p.duration,
  }))
  if (blockModel.materialQtyLine) {
    tooltipItems.unshift({ primary: 'Cargo', secondary: blockModel.materialQtyLine })
  }
  if (canClick) {
    tooltipItems.push({ primary: t('ganttClickVesselDetail', { defaultValue: 'Click to open vessel details.' }) })
  }

  const tooltipTitle = t('ganttTooltipMilestonesTitle', { defaultValue: 'Actual Schedule Milestones' })

  const handleClick = () => {
    if (canClick) onSelectVessel(seg.vesselId)
  }

  const barClassName = [
    'jetty-schedule-gantt__segmented-block',
    canClick ? 'jetty-schedule-gantt__segmented-block--btn' : '',
    seg.status === 'Sailed off' ? 'jetty-schedule-gantt__segmented-block--sailed' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const inner = (
    <div
      className="jetty-schedule-gantt__segmented-group"
      style={{ left: `${groupLeftPct}%`, width: `${groupWidthPct}%`, top: `${barTop}px` }}
    >
      <div className="jetty-schedule-gantt__segmented-bg" aria-hidden="true">
        {positions.map(({ phase, pos }) => {
          const relLeft =
            groupWidthPct > 0
              ? ((parseFloat(pos.left) - groupLeftPct) / groupWidthPct) * 100
              : 0
          const relWidth =
            groupWidthPct > 0 ? (parseFloat(pos.width) / groupWidthPct) * 100 : parseFloat(pos.width)
          return (
            <ActualPhaseSegment
              key={`${phase.key}-${phase.startMs}`}
              phase={phase}
              phaseModel={phaseModel}
              style={{ left: `${relLeft}%`, width: `${relWidth}%` }}
            />
          )
        })}
      </div>
      {canClick ? (
        <button type="button" className={barClassName} onClick={handleClick} aria-label={ariaLabel}>
          <GanttDenseBlock
            layer="actual"
            model={blockModel}
            barWidthPct={groupRawWidthPct}
            overlay
          />
        </button>
      ) : (
        <span className={barClassName} role="img" aria-label={ariaLabel}>
          <GanttDenseBlock
            layer="actual"
            model={blockModel}
            barWidthPct={groupRawWidthPct}
            overlay
          />
        </span>
      )}
    </div>
  )

  return (
    <InteractiveTooltip
      title={tooltipTitle}
      subtitle={seg.vesselName}
      items={tooltipItems}
      emptyText="No details."
      placement="right"
      interactiveChild
    >
      {inner}
    </InteractiveTooltip>
  )
}
