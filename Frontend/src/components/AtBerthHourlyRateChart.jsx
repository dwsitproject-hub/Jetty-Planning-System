const W = 720
const H = 200
const M = { left: 48, right: 16, top: 12, bottom: 32 }

function yMaxFor(values) {
  let max = 0
  for (const v of values) {
    if (v != null && Number.isFinite(Number(v))) max = Math.max(max, Number(v))
  }
  if (max <= 0) return 1
  const step = 10 ** Math.floor(Math.log10(max))
  return Math.ceil(max / step) * step
}

function linePath(values, xAt, yAt) {
  let d = ''
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(Number(v))) return
    const cmd = d ? 'L' : 'M'
    d += `${cmd} ${xAt(i).toFixed(1)} ${yAt(Number(v)).toFixed(1)} `
  })
  return d.trim()
}

/**
 * 24-hour average MT/h chart (Loading vs Unloading) with optional standard-rate dashes.
 */
export default function AtBerthHourlyRateChart({
  hours = [],
  loadingStandard = null,
  unloadingStandard = null,
  unit = 'MT/h',
}) {
  const loading = hours.map((h) => h?.loading)
  const unloading = hours.map((h) => h?.unloading)
  const yMax = yMaxFor([...loading, ...unloading, loadingStandard, unloadingStandard])
  const plotW = W - M.left - M.right
  const plotH = H - M.top - M.bottom
  const xAt = (i) => (i / 23) * plotW
  const yAt = (v) => plotH - (Math.min(Math.max(v, 0), yMax) / yMax) * plotH
  const ticks = [0, yMax / 2, yMax]
  const loadPath = linePath(loading, xAt, yAt)
  const discPath = linePath(unloading, xAt, yAt)

  return (
    <div className="at-berth-rate-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="at-berth-rate-chart__svg" role="img" aria-label="Average MT per hour by clock hour">
        <g transform={`translate(${M.left},${M.top})`}>
          {ticks.map((tv) => (
            <g key={tv}>
              <line className="at-berth-rate-chart__grid" x1={0} y1={yAt(tv)} x2={plotW} y2={yAt(tv)} />
              <text x={-8} y={yAt(tv) + 4} textAnchor="end" className="at-berth-rate-chart__tick">
                {Math.round(tv)}
              </text>
            </g>
          ))}
          <line className="at-berth-rate-chart__axis" x1={0} y1={plotH} x2={plotW} y2={plotH} />
          {loadPath ? <path d={loadPath} className="at-berth-rate-chart__line at-berth-rate-chart__line--load" fill="none" /> : null}
          {discPath ? <path d={discPath} className="at-berth-rate-chart__line at-berth-rate-chart__line--disc" fill="none" /> : null}
          {loadingStandard != null && Number.isFinite(Number(loadingStandard)) ? (
            <line
              className="at-berth-rate-chart__std at-berth-rate-chart__std--load"
              x1={0}
              y1={yAt(Number(loadingStandard))}
              x2={plotW}
              y2={yAt(Number(loadingStandard))}
            />
          ) : null}
          {unloadingStandard != null && Number.isFinite(Number(unloadingStandard)) ? (
            <line
              className="at-berth-rate-chart__std at-berth-rate-chart__std--disc"
              x1={0}
              y1={yAt(Number(unloadingStandard))}
              x2={plotW}
              y2={yAt(Number(unloadingStandard))}
            />
          ) : null}
          {[0, 6, 12, 18, 23].map((h) => (
            <text key={h} x={xAt(h)} y={plotH + 16} textAnchor="middle" className="at-berth-rate-chart__xtick">
              {String(h).padStart(2, '0')}
            </text>
          ))}
        </g>
        <text x={14} y={H / 2} textAnchor="middle" transform={`rotate(-90 14 ${H / 2})`} className="at-berth-rate-chart__ylabel">
          {unit}
        </text>
      </svg>
    </div>
  )
}
