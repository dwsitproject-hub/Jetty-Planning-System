import { useMemo } from 'react'
import CargoSegmentTooltip, { segmentClass, formatQty, badgeLabel } from './CargoSegmentTooltip.jsx'
import { assignSegmentLanes } from '../../utils/cargoMovementTimeScale.js'

const SEG_H = 28
const PAD_Y = 10

function SegmentBar({ seg, xPct, widthPct, y, timezone, t }) {
  const minWidth = Math.max(widthPct, 0.5)
  return (
    <div
      className="cargo-movement-seg-wrap"
      style={{
        position: 'absolute',
        left: `${xPct}%`,
        width: `${minWidth}%`,
        top: y,
        height: SEG_H,
      }}
    >
      <CargoSegmentTooltip segment={seg} timezone={timezone} t={t}>
        <div
          className={`cargo-movement-seg-bar ${segmentClass(seg.atgAuditStatus)}`}
          style={{ width: '100%', height: '100%', borderRadius: 3, padding: '4px 6px', overflow: 'hidden', boxSizing: 'border-box' }}
        >
          <span className="cargo-movement-seg-label" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>
            {seg.vesselName?.slice(0, 14) || '—'} · {formatQty(seg.qty)} · {badgeLabel(seg, t)}
          </span>
        </div>
      </CargoSegmentTooltip>
    </div>
  )
}

export default function TankVesselSegmentLane({ scale, segments = [], timezone, t, nowMs = Date.now() }) {
  const layout = useMemo(() => {
    if (!segments.length) return null
    const laneById = assignSegmentLanes(segments, nowMs)
    const laneCount = Math.max(0, ...[...laneById.values()]) + 1
    const height = PAD_Y * 2 + laneCount * (SEG_H + 4)

    const bars = segments.map((seg) => {
      const startMs = seg.startAt ? Date.parse(seg.startAt) : scale.fromMs
      const endMs = seg.endAt ? Date.parse(seg.endAt) : nowMs
      const x = scale.toX(startMs)
      const x2 = scale.toX(endMs)
      const xPct = (x / scale.width) * 100
      const widthPct = ((Math.max(x2 - x, 4)) / scale.width) * 100
      const lane = laneById.get(seg.loadLineId) ?? 0
      const y = PAD_Y + lane * (SEG_H + 4)
      return { seg, xPct, widthPct, y }
    })

    return { bars, height }
  }, [segments, scale, nowMs])

  if (!layout) {
    return <div className="cargo-movement-empty-lane">{t('cargoMovementNoSegments')}</div>
  }

  return (
    <div
      className="cargo-movement-vessel-lane"
      style={{ position: 'relative', width: '100%', minHeight: layout.height }}
      role="img"
      aria-label={t('cargoMovementVesselLaneAria')}
    >
      {layout.bars.map(({ seg, xPct, widthPct, y }) => (
        <SegmentBar
          key={seg.loadLineId}
          seg={seg}
          xPct={xPct}
          widthPct={widthPct}
          y={y}
          timezone={timezone}
          t={t}
        />
      ))}
    </div>
  )
}
