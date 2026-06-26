import { useTranslation } from 'react-i18next'
import PurposeBadge from './PurposeBadge'
import { formatGanttMilestoneShort, resolveGanttBarDensity } from '../utils/ganttBarDisplay.js'
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
 * Map the coarse segment status to a short, readable shipment-status label + style key.
 * @param {string | null | undefined} status
 * @param {(k: string, o?: object) => string} t
 */
function resolveStatusChip(status, t) {
  const s = String(status || '').trim().toLowerCase()
  if (s === 'sailed off' || s === 'sailed') {
    return { key: 'sailed', label: t('ganttStatusSailed', { defaultValue: 'Sailed' }) }
  }
  if (s === 'berthing' || s === 'at berth' || s === 'at-berth') {
    return { key: 'berthing', label: t('ganttStatusAtBerth', { defaultValue: 'At berth' }) }
  }
  if (s === 'arriving' || s === 'arrived') {
    return { key: 'arriving', label: t('ganttStatusArriving', { defaultValue: 'Arriving' }) }
  }
  return null
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
  const statusChip = resolveStatusChip(model.status, t)

  const isLate = layer === 'actual' && model.etcOverdue && model.overMs != null && model.overMs > 0

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
    .map(({ key, label, ms }) => `${t(key, { defaultValue: label })} ${formatGanttMilestoneShort(ms)}`)
    .join(' · ')

  const showCargo = Boolean(model.materialQtyLine)

  return (
    <div
      className={`gantt-dense-block gantt-dense-block--${layer} gantt-dense-block--${density}${overlay ? ' gantt-dense-block--overlay' : ''}${isLate ? ' gantt-dense-block--late' : ''}`}
    >
      <div className="gantt-dense-block__row gantt-dense-block__row--title">
        {statusIcon}
        <span className="gantt-dense-block__vessel">{model.vesselName}</span>
        {model.purposeLabel ? (
          <PurposeBadge purpose={model.purposeLabel} loadDischarge={model.loadDischarge} />
        ) : null}
        {statusChip ? (
          <span
            className={`gantt-dense-block__status-chip gantt-dense-block__status-chip--${statusChip.key}`}
          >
            {statusChip.label}
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
      </div>
      <div className="gantt-dense-block__row gantt-dense-block__row--dates">
        <span className="gantt-dense-block__dates">{milestoneLine}</span>
      </div>
      {showCargo ? (
        <div className="gantt-dense-block__row gantt-dense-block__row--cargo">
          <span className="gantt-dense-block__cargo">{model.materialQtyLine}</span>
        </div>
      ) : null}
    </div>
  )
}
