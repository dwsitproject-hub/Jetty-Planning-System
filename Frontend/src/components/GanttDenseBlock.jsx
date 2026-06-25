import { useTranslation } from 'react-i18next'
import PurposeBadge from './PurposeBadge'
import EtcBreachBadge from './EtcBreachBadge'
import { formatGanttMilestoneMs, resolveGanttBarDensity } from '../utils/ganttBarDisplay.js'

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

  const milestoneEntries =
    layer === 'planned'
      ? [
          { key: 'ganttBarEta', label: 'ETA', ms: model.etaMs },
          { key: 'ganttBarEtb', label: 'ETB', ms: model.etbMs },
          { key: 'ganttBarEtc', label: 'ETC', ms: model.etcMs },
        ]
      : [
          { key: 'ganttBarTa', label: 'TA', ms: model.taMs },
          { key: 'ganttBarTb', label: 'TB', ms: model.tbMs },
          { key: 'ganttBarActualCompletion', label: 'Done', ms: model.actualCompMs },
        ]

  const milestoneLine = milestoneEntries
    .map(({ key, label, ms }) => `${t(key, { defaultValue: label })} ${formatGanttMilestoneMs(ms)}`)
    .join(' · ')

  const showDates = true
  const showCargo = Boolean(model.materialQtyLine)
  const showOverdueBadge =
    layer === 'actual' &&
    model.etcOverdue &&
    model.overMs != null &&
    (barWidthPct == null || barWidthPct >= 35)

  return (
    <div
      className={`gantt-dense-block gantt-dense-block--${layer} gantt-dense-block--${density}${overlay ? ' gantt-dense-block--overlay' : ''}`}
    >
      <div className="gantt-dense-block__row gantt-dense-block__row--title">
        {statusIcon}
        <span className="gantt-dense-block__vessel">{model.vesselName}</span>
        {model.purposeLabel ? (
          <PurposeBadge purpose={model.purposeLabel} loadDischarge={model.loadDischarge} />
        ) : null}
        {showOverdueBadge ? (
          <EtcBreachBadge overMs={model.overMs} etcMs={model.estCompMs} size="icon-only" />
        ) : null}
      </div>
      {showDates ? (
        <div className="gantt-dense-block__row gantt-dense-block__row--dates">
          <span className="gantt-dense-block__dates" title={milestoneLine}>
            {milestoneLine}
          </span>
        </div>
      ) : null}
      {showCargo ? (
        <div className="gantt-dense-block__row gantt-dense-block__row--cargo">
          <span className="gantt-dense-block__cargo" title={model.materialQtyLine}>
            {model.materialQtyLine}
          </span>
        </div>
      ) : null}
      {/* Aging slot — hidden until business rule is defined */}
      <span className="gantt-dense-block__aging" aria-hidden="true" />
    </div>
  )
}
