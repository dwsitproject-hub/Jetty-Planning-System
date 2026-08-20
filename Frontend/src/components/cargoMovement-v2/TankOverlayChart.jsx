import { useMemo } from 'react'
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  ReferenceArea,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { DateTime } from 'luxon'
import { segmentBandStyle } from './cargoMovementFilters.js'
import { splitSampleRuns } from '../../utils/cargoMovementTimeScale.js'

function toChartMassData(samples) {
  return (samples || [])
    .map((s) => ({
      t: Date.parse(s.sampledAt),
      totalMass: s.totalMass,
    }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.totalMass))
    .sort((a, b) => a.t - b.t)
}

function buildGapRegions(samples, fromMs, toMs) {
  const runs = splitSampleRuns(
    (samples || []).map((s) => ({ sampledAt: s.sampledAt, totalMass: s.totalMass }))
  )
  const gaps = []
  for (let i = 0; i < runs.length - 1; i += 1) {
    const endPrev = Date.parse(runs[i][runs[i].length - 1].sampledAt)
    const startNext = Date.parse(runs[i + 1][0].sampledAt)
    if (startNext - endPrev > 120_000) {
      gaps.push({ x1: endPrev, x2: startNext })
    }
  }
  if (samples?.length) {
    const first = Date.parse(samples[0].sampledAt)
    const last = Date.parse(samples[samples.length - 1].sampledAt)
    if (first > fromMs) gaps.unshift({ x1: fromMs, x2: first })
    if (last < toMs) gaps.push({ x1: last, x2: toMs })
  }
  return gaps
}

export default function TankOverlayChart({
  fromIso,
  toIso,
  timezone,
  samples,
  segments,
  height = 220,
  compact = false,
  hoverSegmentId,
  onHoverSegment,
  onSelectSegment,
}) {
  const fromMs = Date.parse(fromIso)
  const toMs = Date.parse(toIso)
  const nowMs = Date.now()

  const massData = useMemo(() => toChartMassData(samples), [samples])
  const gapRegions = useMemo(
    () => buildGapRegions(samples, fromMs, toMs),
    [samples, fromMs, toMs]
  )

  const formatAxis = (ms) => {
    if (!Number.isFinite(ms)) return ''
    return DateTime.fromMillis(ms, { zone: timezone }).toFormat(compact ? 'dd/MM' : 'dd/MM HH:mm')
  }

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={massData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          {gapRegions.map((g, i) => (
            <ReferenceArea
              key={`gap-${i}`}
              x1={g.x1}
              x2={g.x2}
              yAxisId="mass"
              fill="#fef3c7"
              fillOpacity={0.45}
              ifOverflow="hidden"
            />
          ))}
          {(segments || []).map((seg) => {
            const x1 = seg.startAt ? Date.parse(seg.startAt) : fromMs
            const x2 = seg.endAt ? Date.parse(seg.endAt) : nowMs
            const style = segmentBandStyle(seg.atgAuditStatus)
            const dimmed = hoverSegmentId && hoverSegmentId !== seg.loadLineId
            return (
              <ReferenceArea
                key={seg.loadLineId}
                x1={x1}
                x2={x2}
                yAxisId="mass"
                fill={style.fill}
                stroke={style.stroke}
                strokeWidth={style.strokeWidth}
                strokeDasharray={style.strokeDasharray}
                fillOpacity={dimmed ? 0.12 : style.fillOpacity}
                onMouseEnter={(e) => onHoverSegment?.(seg, e?.nativeEvent || e)}
                onMouseLeave={() => onHoverSegment?.(null, null)}
                onClick={() => onSelectSegment?.(seg)}
                style={{ cursor: 'pointer' }}
                ifOverflow="hidden"
              />
            )
          })}
          <XAxis
            type="number"
            dataKey="t"
            domain={[fromMs, toMs]}
            tickFormatter={formatAxis}
            tick={{ fontSize: compact ? 10 : 11 }}
            stroke="#94a3b8"
          />
          <YAxis
            yAxisId="mass"
            tickFormatter={(v) => `${Math.round(v)}`}
            width={compact ? 36 : 44}
            tick={{ fontSize: 10 }}
            stroke="#94a3b8"
          />
          <Line
            yAxisId="mass"
            type="monotone"
            dataKey="totalMass"
            stroke="#166534"
            strokeWidth={compact ? 1.5 : 2}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
