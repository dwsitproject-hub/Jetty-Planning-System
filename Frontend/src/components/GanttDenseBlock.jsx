import { useTranslation } from 'react-i18next'
import PurposeBadge from './PurposeBadge'
import { resolvePurposeLabel } from '../utils/resolvePurposeLabel.js'
import {
  buildGanttActualMilestoneEntries,
  buildGanttCombinedActualMilestoneEntries,
  buildGanttEstimateMilestoneEntries,
  buildGanttPlannedMilestoneEntries,
  formatGanttMilestoneEntriesCompact,
  resolveGanttBarDensity,
} from '../utils/ganttBarDisplay.js'
import { formatOverdueDuration } from '../utils/etcBreach'

function GanttVesselIcon() {
  return (
    <svg className="gantt-dense-block__icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M2 20h20v2H2v-2zm2-2h16l-2-6H6L4 18zm2.5-8L8 6h8l.5 2 2.5 4H7L6.5 10z"
      />
    </svg>
  )
}

function GanttCompletedIcon() {
  return (
    <svg className="gantt-dense-block__icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M9.2 16.6 4.9 12.3l1.4-1.4 2.9 2.9 8-8 1.4 1.4-9.4 9.4z" />
    </svg>
  )
}

/**
 * @param {object} props
 * @param {'planned' | 'actual'} props.layer
 * @param {object} props.model from buildPlannedBlockModel / buildActualBlockModel
 * @param {number | null | undefined} props.barWidthPct
 * @param {'narrow' | 'medium' | 'full' | null | undefined} props.density override auto density
 * @param {boolean} [props.overlay] transparent background for segmented actual overlay
 */
export default function GanttDenseBlock({
  layer,
  model,
  barWidthPct,
  density: densityProp,
  overlay = false,
}) {
  const { t } = useTranslation('allocation')
  const density = densityProp ?? resolveGanttBarDensity(barWidthPct)
  const isSailed = model.status === 'Sailed off'
  const statusIcon = isSailed ? <GanttCompletedIcon /> : <GanttVesselIcon />

  const isLate = layer === 'actual' && model.etcOverdue && model.overMs != null && model.overMs > 0

  const resolvedPurpose = resolvePurposeLabel(model.purposeLabel, model.loadDischarge)
  const showPurpose = resolvedPurpose === 'Loading' || resolvedPurpose === 'Unloading'

  const plannedEntries = buildGanttPlannedMilestoneEntries(model)
  const estimateEntries = buildGanttEstimateMilestoneEntries(model)
  const actualEntries = buildGanttActualMilestoneEntries(model)
  const combinedActualEntries = buildGanttCombinedActualMilestoneEntries(model)

  const plannedMilestoneLine = formatGanttMilestoneEntriesCompact(plannedEntries, t)
  const estimateLine = formatGanttMilestoneEntriesCompact(estimateEntries, t)
  const actualMilestoneLine = formatGanttMilestoneEntriesCompact(actualEntries, t)
  const combinedActualLine = formatGanttMilestoneEntriesCompact(combinedActualEntries, t)

  const showEstimate =
    layer === 'actual' &&
    density === 'full' &&
    (model.etaMs != null || model.etbMs != null || model.etcMs != null || model.estCompMs != null)

  const showMilestone = density !== 'narrow'
  const showPlannedMilestone = showMilestone && layer === 'planned'
  const showActualMilestone =
    showMilestone && layer === 'actual' && (density === 'medium' || density === 'full')
  const showActualMilestoneCombined = showActualMilestone && density === 'medium'
  const showActualMilestoneSplit = showActualMilestone && density === 'full'

  const showCommodity = Boolean(model.materialDisplay)
  const showCargoDetail =
    density === 'full' &&
    Boolean(model.materialQtyLine) &&
    model.materialQtyLine !== model.materialDisplay

  return (
    <div
      className={`gantt-dense-block gantt-dense-block--${layer} gantt-dense-block--${density}${overlay ? ' gantt-dense-block--overlay' : ''}${isLate ? ' gantt-dense-block--late' : ''}`}
    >
      <div className="gantt-dense-block__row gantt-dense-block__row--title">
        {statusIcon}
        <span className="gantt-dense-block__vessel">{model.vesselName}</span>
        {showPurpose ? (
          <PurposeBadge
            purpose={model.purposeLabel}
            loadDischarge={model.loadDischarge}
            short="gantt"
          />
        ) : null}
        {isLate ? (
          <span
            className="gantt-dense-block__late-chip"
            title={`${formatOverdueDuration(model.overMs)} ${t('ganttLatePastEtcTooltip', { defaultValue: 'past estimated completion (ETC)' })}`}
          >
            {t('ganttLateChip', { defaultValue: 'LATE' })} {formatOverdueDuration(model.overMs)}
          </span>
        ) : null}
      </div>
      {showCommodity ? (
        <div className="gantt-dense-block__row gantt-dense-block__row--commodity">
          <span className="gantt-dense-block__commodity">{model.materialDisplay}</span>
        </div>
      ) : null}
      {showEstimate ? (
        <div className="gantt-dense-block__row gantt-dense-block__row--dates gantt-dense-block__row--estimates">
          <span className="gantt-dense-block__dates gantt-dense-block__dates--estimate">{estimateLine}</span>
        </div>
      ) : null}
      {showPlannedMilestone ? (
        <div className="gantt-dense-block__row gantt-dense-block__row--dates">
          <span className="gantt-dense-block__dates">{plannedMilestoneLine}</span>
        </div>
      ) : null}
      {showActualMilestoneCombined ? (
        <div className="gantt-dense-block__row gantt-dense-block__row--dates">
          <span className="gantt-dense-block__dates">{combinedActualLine}</span>
        </div>
      ) : null}
      {showActualMilestoneSplit ? (
        <div className="gantt-dense-block__row gantt-dense-block__row--dates">
          <span className="gantt-dense-block__dates">{actualMilestoneLine}</span>
        </div>
      ) : null}
      {showCargoDetail ? (
        <div className="gantt-dense-block__row gantt-dense-block__row--cargo">
          <span className="gantt-dense-block__cargo">{model.materialQtyLine}</span>
        </div>
      ) : null}
    </div>
  )
}
