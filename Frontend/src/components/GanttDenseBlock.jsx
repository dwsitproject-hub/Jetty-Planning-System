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
  resolveGanttWaitTooltip,
} from '../utils/ganttBarDisplay.js'
import { formatOverdueDuration } from '../utils/etcBreach'

function GanttVesselIcon() {
  return (
    <svg className="gantt-dense-block__icon" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M2 20h20v2H2v-2zm2-2h16l-2-6H6L4 18zm2.5-8L8 6h8l.5 2 2.5 4H7L6.5 10z"
      />
    </svg>
  )
}

function GanttCompletedIcon() {
  return (
    <svg className="gantt-dense-block__icon" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M9.2 16.6 4.9 12.3l1.4-1.4 2.9 2.9 8-8 1.4 1.4-9.4 9.4z" />
    </svg>
  )
}

function InlineSep() {
  return <span className="gantt-dense-block__sep" aria-hidden> · </span>
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
  showLateChip = true,
  showAvgFlow = false,
  showPlannedWait = false,
  showEtr = false,
  pinLabel = false,
}) {
  const { t } = useTranslation('allocation')
  const density = densityProp ?? resolveGanttBarDensity(barWidthPct)
  const isSailed = model.status === 'Sailed off'
  const statusIcon = isSailed ? <GanttCompletedIcon /> : <GanttVesselIcon />
  const compactPlan = showEtr && layer === 'actual' && density === 'full'

  const isLate =
    showLateChip && layer === 'actual' && model.etcOverdue && model.overMs != null && model.overMs > 0

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
    !compactPlan &&
    layer === 'actual' &&
    density === 'full' &&
    (model.etaMs != null || model.etbMs != null || model.etcMs != null || model.estCompMs != null)

  const showMilestone = density !== 'narrow'
  const showPlannedMilestone = showMilestone && layer === 'planned'
  const showActualMilestone =
    showMilestone && layer === 'actual' && (density === 'medium' || density === 'full')
  const showActualMilestoneCombined = showActualMilestone && density === 'medium'
  const showActualMilestoneSplit = showActualMilestone && density === 'full' && !compactPlan

  const showCommodity = Boolean(model.materialDisplay)
  const showCargoDetail =
    density !== 'narrow' &&
    Boolean(model.materialQtyLine) &&
    model.materialQtyLine !== model.materialDisplay

  const waitLabel = model.waitLine
    ? t('ganttBarWait', { wait: model.waitLine, defaultValue: 'Wait {{wait}}' })
    : null
  const waitTooltip = waitLabel ? resolveGanttWaitTooltip(model, t) : null
  const showWait =
    Boolean(waitLabel) && (layer === 'actual' || (showPlannedWait && layer === 'planned'))

  const avgFlowLabel =
    showAvgFlow &&
    layer === 'actual' &&
    model.avgRateLine &&
    model.avgRateLine !== '—'
      ? model.avgRateLine
      : null

  const balanceLine =
    showEtr && layer === 'actual' && model.balanceLine ? model.balanceLine : null

  const etrLabel =
    showEtr &&
    layer === 'actual' &&
    density !== 'narrow' &&
    model.etrDuration
      ? t('ganttBarEtr', { duration: model.etrDuration, defaultValue: 'ETR {{duration}}' })
      : null

  const combinedScheduleLine =
    compactPlan && estimateLine && actualMilestoneLine
      ? `${estimateLine} · ${actualMilestoneLine}`
      : compactPlan
        ? estimateLine || actualMilestoneLine || null
        : null

  const showMetaRow = !compactPlan && (showCommodity || showWait)
  const showCompactMetaRow = compactPlan && (showCommodity || showWait)
  const showCompactSchedule = Boolean(combinedScheduleLine)
  const showCompactProgress =
    compactPlan && (showCargoDetail || balanceLine || etrLabel)
  const showLegacyBalanceEtr = !compactPlan && (balanceLine || etrLabel)

  const blockBody = (
    <>
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
        {model.missingEtc ? (
          <span
            className="gantt-missing-etc-warn"
            title={t('ganttMissingEtcWarn', {
              defaultValue:
                'Estimated completion (ETC) not set — schedule bar uses +3 days for display only.',
            })}
            aria-label={t('ganttMissingEtcWarn', {
              defaultValue:
                'Estimated completion (ETC) not set — schedule bar uses +3 days for display only.',
            })}
          >
            ⏱️❓
          </span>
        ) : null}
        {isLate ? (
          <span
            className="gantt-dense-block__late-chip"
            title={`${formatOverdueDuration(model.overMs)} ${t('ganttLatePastEtcTooltip', { defaultValue: 'past estimated completion (ETC)' })}`}
          >
            {t('ganttLateChip', { defaultValue: 'LATE' })} {formatOverdueDuration(model.overMs)}
          </span>
        ) : null}
        {avgFlowLabel ? (
          <span
            className="gantt-dense-block__avg-flow-chip"
            title={t('ganttBarAvgFlow', { rate: avgFlowLabel, defaultValue: '{{rate}}' })}
          >
            {avgFlowLabel}
          </span>
        ) : null}
      </div>

      {showCompactMetaRow ? (
        <div className="gantt-dense-block__row gantt-dense-block__row--meta">
          {showCommodity ? (
            <span className="gantt-dense-block__commodity" title={model.commodityTitle || undefined}>
              {model.materialDisplay}
            </span>
          ) : null}
          {showCommodity && showWait ? <InlineSep /> : null}
          {showWait ? (
            <span className="gantt-dense-block__wait-chip" title={waitTooltip}>
              {waitLabel}
            </span>
          ) : null}
        </div>
      ) : null}

      {showMetaRow ? (
        <div className="gantt-dense-block__row gantt-dense-block__row--commodity">
          {showCommodity ? (
            <span className="gantt-dense-block__commodity" title={model.commodityTitle || undefined}>
              {model.materialDisplay}
            </span>
          ) : null}
          {showWait ? (
            <span className="gantt-dense-block__wait" title={waitTooltip}>
              {waitLabel}
            </span>
          ) : null}
        </div>
      ) : null}

      {showCompactSchedule ? (
        <div className="gantt-dense-block__row gantt-dense-block__row--dates gantt-dense-block__row--schedule">
          <span className="gantt-dense-block__dates">{combinedScheduleLine}</span>
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

      {showCompactProgress ? (
        <div className="gantt-dense-block__row gantt-dense-block__row--progress">
          {showCargoDetail && model.materialQtyLine ? (
            <span className="gantt-dense-block__progress-qty">{model.materialQtyLine}</span>
          ) : null}
          {showCargoDetail && model.materialQtyLine && (balanceLine || etrLabel) ? (
            <InlineSep />
          ) : null}
          {balanceLine ? (
            <span className="gantt-dense-block__balance">{balanceLine}</span>
          ) : null}
          {balanceLine && etrLabel ? <InlineSep /> : null}
          {etrLabel ? (
            <span
              className="gantt-dense-block__etr"
              title={t('cardEtrTooltip', {
                defaultValue: 'Estimated time to finish remaining cargo (balance ÷ rate)',
              })}
            >
              {etrLabel}
            </span>
          ) : null}
        </div>
      ) : null}

      {!compactPlan && (showCargoDetail || showLegacyBalanceEtr) ? (
        <div className="gantt-dense-block__row gantt-dense-block__row--cargo">
          {showCargoDetail ? (
            <span className="gantt-dense-block__cargo">{model.materialQtyLine}</span>
          ) : null}
          {showLegacyBalanceEtr ? (
            <span className="gantt-dense-block__balance-etr">
              {balanceLine ? (
                <span className="gantt-dense-block__balance">{balanceLine}</span>
              ) : null}
              {etrLabel ? (
                <>
                  {balanceLine ? ' -- ' : null}
                  <span
                    className="gantt-dense-block__etr"
                    title={t('cardEtrTooltip', {
                      defaultValue: 'Estimated time to finish remaining cargo (balance ÷ rate)',
                    })}
                  >
                    {etrLabel}
                  </span>
                </>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  )

  return (
    <div
      className={`gantt-dense-block gantt-dense-block--${layer} gantt-dense-block--${density}${compactPlan ? ' gantt-dense-block--plan-compact' : ''}${overlay ? ' gantt-dense-block--overlay' : ''}${isLate ? ' gantt-dense-block--late' : ''}${pinLabel ? ' gantt-dense-block--pinned' : ''}`}
    >
      {pinLabel ? <div className="gantt-dense-block__pin">{blockBody}</div> : blockBody}
    </div>
  )
}
