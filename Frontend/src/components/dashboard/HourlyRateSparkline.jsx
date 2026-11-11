/**
 * Hourly cargo rate line (MT/h per clock hour). Grey columns = no-flow hours; dashed line = fast threshold.
 * Hover any hour for its time and rate (native SVG tooltip).
 */
import { FAST_RATE_MTH } from '../../utils/hourlyRateBands.js'
import { MGMT_DASHBOARD_TIMEZONE } from '../../utils/managementDashboardMetricEvidence.js'

const HOUR_MS = 3600000

function fmtHour(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: MGMT_DASHBOARD_TIMEZONE,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function HourlyRateSparkline({ series, scaleMax, width = 160, height = 36, detailed = false }) {
  const points = Array.isArray(series) ? series : []
  if (!points.length) return null
  const pad = detailed ? { l: 34, r: 8, t: 8, b: 20 } : { l: 1, r: 1, t: 3, b: 3 }
  const iw = width - pad.l - pad.r
  const ih = height - pad.t - pad.b
  const n = points.length
  const step = iw / Math.max(n - 1, 1)
  const x = (i) => pad.l + (n <= 1 ? iw / 2 : i * step)
  const y = (r) => pad.t + ih - (Math.min(Math.max(r, 0), scaleMax) / scaleMax) * ih
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.r ?? 0).toFixed(1)}`).join('')
  const area = `${line}L${x(n - 1).toFixed(1)},${pad.t + ih}L${x(0).toFixed(1)},${pad.t + ih}Z`
  const ticks = []
  if (detailed) for (let v = 0; v <= scaleMax; v += scaleMax > 200 ? 50 : 25) ticks.push(v)

  return (
    <svg
      className="mgmt-rate-spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Hourly cargo rate over ${n} hours`}
    >
      {ticks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className="mgmt-rate-spark__grid" />
          <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" className="mgmt-rate-spark__tick">{v}</text>
        </g>
      ))}
      {points.map((p, i) =>
        p.r === 0 ? (
          <rect key={`z${i}`} x={x(i) - step / 2} y={pad.t} width={step} height={ih} className="mgmt-rate-spark__noflow" />
        ) : null
      )}
      <line x1={pad.l} x2={width - pad.r} y1={y(FAST_RATE_MTH)} y2={y(FAST_RATE_MTH)} className="mgmt-rate-spark__fast" />
      {detailed ? (
        <text x={width - pad.r - 2} y={y(FAST_RATE_MTH) - 3} textAnchor="end" className="mgmt-rate-spark__fast-lbl">
          {FAST_RATE_MTH} MT/h (fast)
        </text>
      ) : null}
      <path d={area} className="mgmt-rate-spark__area" />
      <path d={line} className="mgmt-rate-spark__line" />
      {detailed ? (
        <>
          <text x={pad.l} y={height - 4} className="mgmt-rate-spark__tick">{fmtHour(points[0].t)}</text>
          <text x={width - pad.r} y={height - 4} textAnchor="end" className="mgmt-rate-spark__tick">
            {fmtHour(new Date(new Date(points[n - 1].t).getTime() + HOUR_MS).toISOString())}
          </text>
        </>
      ) : null}
      {points.map((p, i) => (
        <rect key={`h${i}`} x={x(i) - step / 2} y={pad.t} width={step} height={ih} fill="transparent">
          <title>
            {fmtHour(p.t)} · {p.r == null ? 'excluded (incomplete data)' : p.r > 0 ? `${p.r} MT/h` : 'no flow'}
          </title>
        </rect>
      ))}
    </svg>
  )
}
