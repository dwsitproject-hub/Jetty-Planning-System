import { useMemo } from 'react'
import { DateTime } from 'luxon'
import { formatDailyRateDateLabel } from '../utils/cargoDailyRates.js'

const W = 560
const H = 160
const PAD = { top: 12, right: 12, bottom: 28, left: 44 }

/**
 * @param {object} props
 * @param {Array<{ date: string, qtyMoved: number }>} props.dailyBars
 * @param {Array<{ t: number, cumulativeQty: number }>} props.cumulativeSeries
 * @param {number | null | undefined} props.totalQty
 * @param {string} [props.unit]
 * @param {string} [props.timezone]
 * @param {number} [props.nowMs]
 */
export default function CargoDischargeProgressChart({
  dailyBars = [],
  cumulativeSeries = [],
  totalQty = null,
  unit = 'MT',
  timezone = 'Asia/Jakarta',
  nowMs = Date.now(),
}) {
  const todayKey = DateTime.fromMillis(nowMs, { zone: timezone }).toFormat('yyyy-MM-dd')

  const model = useMemo(() => {
    if (!dailyBars.length && !cumulativeSeries.length) return null

    const dates = dailyBars.map((b) => b.date)
    const maxBar = Math.max(...dailyBars.map((b) => b.qtyMoved), 0)
    const maxCum = Math.max(...cumulativeSeries.map((p) => p.cumulativeQty), 0)
    const yMax = Math.max(maxBar, maxCum, totalQty || 0, 1)

    const innerW = W - PAD.left - PAD.right
    const innerH = H - PAD.top - PAD.bottom
    const n = Math.max(dates.length, 1)
    const barW = Math.min(36, innerW / n - 6)

    const bars = dailyBars.map((b, i) => {
      const xCenter = PAD.left + ((i + 0.5) / n) * innerW
      const h = (b.qtyMoved / yMax) * innerH
      return {
        ...b,
        x: xCenter - barW / 2,
        y: PAD.top + innerH - h,
        w: barW,
        h,
        isToday: b.date === todayKey,
      }
    })

    const dateToX = new Map(dates.map((d, i) => [d, PAD.left + ((i + 0.5) / n) * innerW]))
    const linePoints = cumulativeSeries.map((p) => {
      const dk = p.dateKey
      let x = dk && dateToX.has(dk) ? dateToX.get(dk) : null
      if (x == null && dates.length) {
        const idx = dates.findIndex((d) => d >= (dk || ''))
        const i = idx >= 0 ? idx : dates.length - 1
        x = PAD.left + ((i + 0.5) / n) * innerW
      }
      const y = PAD.top + innerH - (p.cumulativeQty / yMax) * innerH
      return { x, y }
    }).filter((p) => p.x != null && Number.isFinite(p.y))

    const linePath =
      linePoints.length >= 2
        ? linePoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
        : linePoints.length === 1
          ? `M ${linePoints[0].x.toFixed(1)} ${linePoints[0].y.toFixed(1)} L ${linePoints[0].x.toFixed(1)} ${linePoints[0].y.toFixed(1)}`
          : ''

    const yTicks = [0, yMax * 0.5, yMax].map((v) => ({
      v,
      y: PAD.top + innerH - (v / yMax) * innerH,
      label: Math.round(v).toLocaleString('en-US'),
    }))

    return { bars, linePath, yTicks, yMax, dates, innerH }
  }, [dailyBars, cumulativeSeries, totalQty, todayKey])

  if (!model) {
    return (
      <p className="operational-progress-section__chart-empty text-steel">
        No Cargo Operations logged yet.
      </p>
    )
  }

  return (
    <div className="operational-progress-section__chart-wrap">
      <svg
        className="operational-progress-section__chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Cargo discharge progress by day"
      >
        {model.yTicks.map((tick) => (
          <g key={tick.v}>
            <line
              x1={PAD.left}
              y1={tick.y}
              x2={W - PAD.right}
              y2={tick.y}
              className="operational-progress-section__grid-line"
            />
            <text x={PAD.left - 6} y={tick.y + 4} textAnchor="end" className="operational-progress-section__axis-label">
              {tick.label}
            </text>
          </g>
        ))}

        {model.bars.map((b) => (
          <rect
            key={b.date}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            rx={2}
            className={
              b.isToday
                ? 'operational-progress-section__bar operational-progress-section__bar--today'
                : 'operational-progress-section__bar'
            }
          >
            <title>{`${formatDailyRateDateLabel(b.date)}: ${Math.round(b.qtyMoved).toLocaleString('en-US')} ${unit}`}</title>
          </rect>
        ))}

        {model.linePath ? (
          <path d={model.linePath} className="operational-progress-section__cum-line" fill="none" />
        ) : null}

        {model.bars.map((b) => (
          <text
            key={`lbl-${b.date}`}
            x={b.x + b.w / 2}
            y={H - 8}
            textAnchor="middle"
            className="operational-progress-section__x-label"
          >
            {formatDailyRateDateLabel(b.date)}
          </text>
        ))}
      </svg>
      <p className="operational-progress-section__chart-legend text-steel">
        <span className="operational-progress-section__legend-bar" aria-hidden /> Daily {unit} moved
        <span className="operational-progress-section__legend-line" aria-hidden /> Cumulative {unit}
        {totalQty != null ? ` · Planned ${Math.round(totalQty).toLocaleString('en-US')} ${unit}` : ''}
      </p>
    </div>
  )
}
