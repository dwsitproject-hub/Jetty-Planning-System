import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const PLOT_W = 1000
const HOUR_LABELS = [0, 6, 12, 18, 23]
const OVERNIGHT_END = 6

function finiteOrNull(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function yMaxFor(values) {
  let max = 0
  for (const v of values) {
    if (v != null && Number.isFinite(v)) max = Math.max(max, v)
  }
  if (max <= 0) return 1
  const step = 10 ** Math.floor(Math.log10(max))
  return Math.ceil(max / step) * step
}

function formatTick(v) {
  if (v >= 10) return String(Math.round(v))
  return String(Math.round(v * 10) / 10)
}

function formatRate(v) {
  if (v == null) return '—'
  if (Math.abs(v) >= 100) return String(Math.round(v))
  return String(Math.round(v * 10) / 10)
}

function linePath(values, yAt) {
  const xAt = (i) => (i / 23) * PLOT_W
  let d = ''
  let drawing = false
  values.forEach((v, i) => {
    if (v == null) {
      drawing = false
      return
    }
    d += `${drawing ? 'L' : 'M'} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)} `
    drawing = true
  })
  return d.trim()
}

function areaPath(values, yAt, baseline) {
  const xAt = (i) => (i / 23) * PLOT_W
  let d = ''
  let run = []
  const flush = () => {
    if (!run.length) return
    d += `M ${xAt(run[0].i).toFixed(1)} ${baseline.toFixed(1)} `
    for (const p of run) d += `L ${xAt(p.i).toFixed(1)} ${yAt(p.v).toFixed(1)} `
    d += `L ${xAt(run[run.length - 1].i).toFixed(1)} ${baseline.toFixed(1)} Z `
    run = []
  }
  values.forEach((v, i) => {
    if (v == null) flush()
    else run.push({ i, v })
  })
  flush()
  return d.trim()
}

function SeriesPlot({ series, plotH, hoverHour, onMove, overnightLabel }) {
  const yMax = series.yMax
  const yAt = (v) => plotH - (Math.min(Math.max(v, 0), yMax) / yMax) * plotH
  const ticks = [yMax, yMax / 2, 0]
  const xAt = (i) => (i / 23) * PLOT_W
  const hoverValue = hoverHour == null ? null : series.values[hoverHour]

  return (
    <div className="at-berth-rate-chart__row">
      <div className="at-berth-rate-chart__name">
        <span className={`at-berth-rate-chart__swatch at-berth-rate-chart__swatch--${series.key}`} />
        <span>{series.label}</span>
        {series.standard != null ? (
          <span className="at-berth-rate-chart__std-note" title={series.stdLabel}>
            <span className={`at-berth-rate-chart__std-mark at-berth-rate-chart__std-mark--${series.key}`} />
            {formatTick(series.standard)}
          </span>
        ) : null}
      </div>
      <div className="at-berth-rate-chart__yticks" style={{ height: plotH }} aria-hidden="true">
        {ticks.map((tv) => (
          <span key={tv}>{formatTick(tv)}</span>
        ))}
      </div>
      <div className="at-berth-rate-chart__plot" style={{ height: plotH }} onMouseMove={onMove}>
        <svg
          viewBox={`0 0 ${PLOT_W} ${plotH}`}
          preserveAspectRatio="none"
          className="at-berth-rate-chart__svg"
          aria-hidden="true"
        >
          <rect className="at-berth-rate-chart__overnight" x={0} y={0} width={xAt(OVERNIGHT_END)} height={plotH} />
          {ticks.map((tv) => (
            <line key={tv} className="at-berth-rate-chart__grid" x1={0} y1={yAt(tv)} x2={PLOT_W} y2={yAt(tv)} />
          ))}
          <line className="at-berth-rate-chart__axis" x1={0} y1={plotH - 0.5} x2={PLOT_W} y2={plotH - 0.5} />
          {series.area ? <path d={series.area(yAt, plotH)} className={`at-berth-rate-chart__area at-berth-rate-chart__area--${series.key}`} /> : null}
          {series.line ? (
            <path d={series.line(yAt)} className={`at-berth-rate-chart__line at-berth-rate-chart__line--${series.key}`} fill="none" />
          ) : null}
          {series.standard != null ? (
            <line
              className={`at-berth-rate-chart__std at-berth-rate-chart__std--${series.key}`}
              x1={0}
              y1={yAt(series.standard)}
              x2={PLOT_W}
              y2={yAt(series.standard)}
            />
          ) : null}
        </svg>
        {overnightLabel ? <span className="at-berth-rate-chart__overnight-label">{overnightLabel}</span> : null}
        {hoverHour != null ? (
          <span className="at-berth-rate-chart__guide" style={{ left: `${(hoverHour / 23) * 100}%` }} />
        ) : null}
        {hoverValue != null ? (
          <span
            className={`at-berth-rate-chart__dot at-berth-rate-chart__dot--${series.key}`}
            style={{ left: `${(hoverHour / 23) * 100}%`, top: `${(yAt(hoverValue) / plotH) * 100}%` }}
          />
        ) : null}
      </div>
    </div>
  )
}

export default function AtBerthHourlyRateChart({
  hours = [],
  loadingStandard = null,
  unloadingStandard = null,
  unit = 'MT/h',
}) {
  const { t } = useTranslation('atBerth')
  const rootRef = useRef(null)
  const [hover, setHover] = useState(null)

  const loadingStd = finiteOrNull(loadingStandard)
  const unloadingStd = finiteOrNull(unloadingStandard)
  const loading = hours.map((h) => finiteOrNull(h?.loading))
  const unloading = hours.map((h) => finiteOrNull(h?.unloading))

  const defs = [
    {
      key: 'load',
      label: t('purposeLoading'),
      values: loading,
      counts: hours.map((h) => finiteOrNull(h?.loadingN)),
      standard: loadingStd,
      stdLabel: t('flowPatternStdLoading'),
    },
    {
      key: 'disc',
      label: t('purposeUnloading'),
      values: unloading,
      counts: hours.map((h) => finiteOrNull(h?.unloadingN)),
      standard: unloadingStd,
      stdLabel: t('flowPatternStdUnloading'),
    },
  ]
  const series = defs
    .filter((s) => s.values.some((v) => v != null))
    .map((s) => ({
      ...s,
      yMax: yMaxFor([...s.values, s.standard]),
      line: (yAt) => linePath(s.values, yAt),
      area: (yAt, baseline) => areaPath(s.values, yAt, baseline),
    }))

  if (!series.length) return null

  const plotH = series.length > 1 ? 72 : 96
  const hoverHour = hover?.hour ?? null

  const onMove = (e) => {
    const plot = e.currentTarget.getBoundingClientRect()
    const chart = rootRef.current?.getBoundingClientRect()
    if (!chart || plot.width <= 0) return
    const ratio = Math.min(1, Math.max(0, (e.clientX - plot.left) / plot.width))
    const hour = Math.round(ratio * 23)
    setHover({
      hour,
      x: e.clientX - chart.left,
      placeLeft: chart.right - e.clientX < 176,
    })
  }

  const hourLabel = (h) => String(h).padStart(2, '0')

  return (
    <div
      ref={rootRef}
      className="at-berth-rate-chart"
      onMouseLeave={() => setHover(null)}
    >
      <div className="at-berth-rate-chart__plots" role="img" aria-label={t('flowPatternChartAria')}>
        {series.map((s, index) => (
          <SeriesPlot
            key={s.key}
            series={s}
            plotH={plotH}
            hoverHour={hoverHour}
            onMove={onMove}
            overnightLabel={index === 0 ? t('flowPatternOvernight') : null}
          />
        ))}
      </div>
      <div className="at-berth-rate-chart__axis-row">
        <span className="at-berth-rate-chart__unit">{unit}</span>
        <span />
        <div className="at-berth-rate-chart__xaxis" aria-hidden="true">
          {HOUR_LABELS.map((h) => (
            <span
              key={h}
              className={`at-berth-rate-chart__xtick${h === 0 ? ' at-berth-rate-chart__xtick--start' : ''}${h === 23 ? ' at-berth-rate-chart__xtick--end' : ''}`}
              style={{ left: `${(h / 23) * 100}%` }}
            >
              {hourLabel(h)}
            </span>
          ))}
        </div>
      </div>
      {hover ? (
        <div
          className="at-berth-rate-chart__tip"
          style={{ left: hover.x, transform: hover.placeLeft ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)' }}
        >
          <div className="at-berth-rate-chart__tip-hour">{t('flowPatternTooltipHour', { hour: hourLabel(hover.hour) })}</div>
          {series.map((s) => {
            const rate = s.values[hover.hour]
            const count = s.counts[hover.hour]
            return (
              <div key={s.key} className="at-berth-rate-chart__tip-row">
                <span className={`at-berth-rate-chart__swatch at-berth-rate-chart__swatch--${s.key}`} />
                <span>{s.label}</span>
                <span className="at-berth-rate-chart__tip-rate">
                  {formatRate(rate)} {unit}
                </span>
                {rate != null && count != null && count > 0 ? (
                  <span className="at-berth-rate-chart__tip-n">{t('flowPatternTooltipSamples', { count })}</span>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
