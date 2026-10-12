import PurposeBadge from './PurposeBadge'
import {
  ganttProductInitial,
  ganttVesselInitial,
} from '../utils/ganttBarDisplay.js'

function InlineSep() {
  return (
    <span className="gantt-dense-block__sep" aria-hidden>
      {' '}
      ·{' '}
    </span>
  )
}

function NeedsUpdateMark({ text }) {
  if (!text) return null
  return (
    <span className="gantt-needs-update gantt-missing-etc-warn" title={text} aria-label={text}>
      ⚠️
    </span>
  )
}

function StackLine({ children, title }) {
  return (
    <div className="gantt-dense-block__row gantt-dense-block__row--plan-stack" title={title}>
      {children}
    </div>
  )
}

function ComfortableBody({
  model,
  showPurpose,
  showCommodity,
  showWait,
  waitLabel,
  waitTooltip,
  needsUpdateText,
  plan3AvgRate,
  balanceLine,
  avgFlowTitle,
}) {
  return (
    <>
      <div className="gantt-dense-block__row gantt-dense-block__row--plan3">
        <span className="gantt-dense-block__plan3-left">
          <span className="gantt-dense-block__vessel">{model.vesselName}</span>
          {showPurpose ? (
            <PurposeBadge
              purpose={model.purposeLabel}
              loadDischarge={model.loadDischarge}
              short="gantt"
            />
          ) : null}
          <NeedsUpdateMark text={needsUpdateText} />
        </span>
        <InlineSep />
        <span className="gantt-dense-block__plan3-right" title={model.commodityTitle || undefined}>
          {showCommodity ? model.materialDisplay : '—'}
        </span>
      </div>
      <div className="gantt-dense-block__row gantt-dense-block__row--plan3">
        <span className="gantt-dense-block__plan3-left">
          {showWait ? (
            <span className="gantt-dense-block__wait-chip" title={waitTooltip}>
              {waitLabel}
            </span>
          ) : (
            '—'
          )}
        </span>
        <InlineSep />
        {plan3AvgRate ? (
          <span className="gantt-dense-block__plan3-highlight" title={avgFlowTitle}>
            {plan3AvgRate}
          </span>
        ) : (
          <span className="gantt-dense-block__plan3-right">—</span>
        )}
      </div>
      <div className="gantt-dense-block__row gantt-dense-block__row--plan3">
        <span className="gantt-dense-block__plan3-left">{model.totalVolumeLine || '—'}</span>
        <InlineSep />
        <span className="gantt-dense-block__plan3-right">{balanceLine || '—'}</span>
      </div>
    </>
  )
}

/**
 * Berthing Plan in-bar layouts by pixel density.
 * @param {object} props
 * @param {'comfortable' | 'medium' | 'narrow' | 'micro'} props.density
 */
export default function GanttPlanBarBody({
  density,
  model,
  showPurpose,
  showCommodity,
  showWait,
  waitLabel,
  waitTooltip,
  needsUpdateText,
  plan3AvgRate,
  balanceLine,
  avgFlowTitle,
}) {
  if (density === 'micro') {
    const full = [model.vesselName, model.materialDisplay].filter(Boolean).join(' · ')
    return (
      <div className="gantt-dense-block__micro" title={full || undefined}>
        <span className="gantt-dense-block__micro-vessel">{ganttVesselInitial(model.vesselName)}</span>
        <span className="gantt-dense-block__micro-product">{ganttProductInitial(model.materialDisplay)}</span>
      </div>
    )
  }

  if (density === 'narrow' || density === 'medium') {
    return (
      <>
        <StackLine title={model.vesselName}>{model.vesselName}</StackLine>
        <StackLine title={model.commodityTitle || model.materialDisplay || undefined}>
          {showCommodity ? model.materialDisplay : '—'}
        </StackLine>
        {density === 'medium' ? (
          <StackLine title={waitTooltip}>{showWait ? waitLabel : '—'}</StackLine>
        ) : null}
      </>
    )
  }

  return (
    <ComfortableBody
      model={model}
      showPurpose={showPurpose}
      showCommodity={showCommodity}
      showWait={showWait}
      waitLabel={waitLabel}
      waitTooltip={waitTooltip}
      needsUpdateText={needsUpdateText}
      plan3AvgRate={plan3AvgRate}
      balanceLine={balanceLine}
      avgFlowTitle={avgFlowTitle}
    />
  )
}
