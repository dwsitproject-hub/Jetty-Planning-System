import { useState } from 'react'
import { ChevronDown, ChevronRight, Gauge, AlertTriangle, Ship } from 'lucide-react'
import TankOverlayChart from './TankOverlayChart.jsx'
import SegmentHoverPopover from './SegmentHoverPopover.jsx'
import { formatMass } from './cargoMovementFilters.js'

export default function TankAuditCard({
  tank,
  samples,
  fromIso,
  toIso,
  timezone,
  t,
  defaultExpanded,
  onSelectSegment,
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [hoverSegment, setHoverSegment] = useState(null)
  const [popoverAnchor, setPopoverAnchor] = useState(null)

  const pollFault = tank.sourceLastPollOk === false
  const currentLabel = tank.currentMovement
    ? `${tank.currentMovement.vesselName} (${tank.currentMovement.purpose || '—'})`
    : t('cargoMovementIdle')

  const handleHover = (seg, evt) => {
    setHoverSegment(seg)
    if (seg && evt?.clientX != null) {
      setPopoverAnchor({ x: evt.clientX, y: evt.clientY })
    } else if (seg) {
      setPopoverAnchor({ x: window.innerWidth / 2, y: 200 })
    } else {
      setPopoverAnchor(null)
    }
  }

  return (
    <article className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-slate-50"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">
              TK {tank.code}{tank.name ? ` · ${tank.name}` : ''}
            </span>
            {tank.productName ? (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{tank.productName}</span>
            ) : null}
            {tank.hasAtg ? (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-800">
                <Gauge className="h-3 w-3" /> ATG
              </span>
            ) : null}
            {pollFault ? (
              <span
                className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-xs text-red-700"
                title={[tank.sourceLastError, tank.sourceLastPollAt].filter(Boolean).join(' · ')}
              >
                <AlertTriangle className="h-3 w-3" /> {t('cargoMovementPollerFault')}
              </span>
            ) : (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{t('cargoMovementPollerNormal')}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-600">
            <span>{t('cargoMovementCurrentMass')}: {formatMass(tank.currentMass)} MT</span>
            <span className="inline-flex items-center gap-1">
              <Ship className="h-3 w-3" /> {currentLabel}
            </span>
          </div>
        </div>
      </button>

      <div className="border-t border-slate-100 px-2 pb-2">
        <TankOverlayChart
          fromIso={fromIso}
          toIso={toIso}
          timezone={timezone}
          samples={samples}
          segments={tank.segments}
          height={expanded ? 220 : 48}
          compact={!expanded}
          hoverSegmentId={hoverSegment?.loadLineId}
          onHoverSegment={handleHover}
          onSelectSegment={onSelectSegment}
        />
      </div>

      {expanded && tank.segments?.length ? (
        <div className="border-t border-slate-100 px-3 py-2">
          <table className="w-full text-left text-xs text-slate-600">
            <thead>
              <tr className="text-slate-500">
                <th className="py-1">{t('cargoMovementTipVessel')}</th>
                <th className="py-1">{t('cargoMovementTipQty')}</th>
                <th className="py-1">{t('cargoMovementInspectorAuditStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {tank.segments.map((seg) => (
                <tr
                  key={seg.loadLineId}
                  className="cursor-pointer border-t border-slate-50 hover:bg-slate-50"
                  onClick={() => onSelectSegment(seg)}
                >
                  <td className="py-1">{seg.vesselName}</td>
                  <td className="py-1">{formatMass(seg.qty)} MT</td>
                  <td className="py-1">{seg.atgAuditStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <SegmentHoverPopover
        segment={hoverSegment}
        timezone={timezone}
        t={t}
        anchor={popoverAnchor}
        onClose={() => {
          setHoverSegment(null)
          setPopoverAnchor(null)
        }}
      />
    </article>
  )
}
