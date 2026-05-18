import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import InteractiveTooltip from './InteractiveTooltip'

const CHART_W = 760
const CHART_H = 268
const M = { left: 48, right: 24, top: 24, bottom: 76, yLabelX: 18 }

function formatWeekRangeLabel(startIso, endIso, lang) {
  if (!startIso || !endIso) return '—'
  const locale = lang?.startsWith('id') ? 'id-ID' : 'en-US'
  const opts = { month: 'short', day: 'numeric', year: 'numeric' }
  const d1 = new Date(`${startIso}T12:00:00`)
  const d2 = new Date(`${endIso}T12:00:00`)
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return '—'
  const f = new Intl.DateTimeFormat(locale, opts)
  return `${f.format(d1)} - ${f.format(d2)}`
}

function buildYAxis(maxValue) {
  if (!Number.isFinite(maxValue) || maxValue <= 0) {
    return { yMax: 1, ticks: [0, 1] }
  }
  const targetSteps = 5
  let step = Math.ceil((maxValue / targetSteps) * 1000) / 1000
  const pow = 10 ** Math.floor(Math.log10(Math.max(step, 1e-6)))
  const f = step / pow
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  step = nf * pow
  if (maxValue <= 20 && step > 2) {
    step = 2
  }
  const yMax = Math.max(step, Math.ceil(maxValue / step) * step)
  const tickCount = Math.max(0, Math.ceil(yMax / step - 1e-9))
  const ticks = []
  for (let i = 0; i <= tickCount; i++) {
    const v = Math.min(yMax, i * step)
    ticks.push(step >= 1 ? Math.round(v) : Math.round(v * 100) / 100)
  }
  if (ticks.length > 12) {
    const coarser = step * 2
    const yM = Math.ceil(maxValue / coarser) * coarser
    const t2 = []
    for (let v = 0; v <= yM + 1e-9; v += coarser) t2.push(v)
    return { yMax: yM, ticks: t2 }
  }
  return { yMax, ticks }
}

function WeeklyLineChart({ weekLabels, yTitle, xAxisTitle, series, ariaLabel, weekTooltip }) {
  const n = weekLabels.length
  if (n === 0) return null

  let dataMax = 0
  for (const s of series) {
    for (const v of s.values) {
      if (v != null && Number.isFinite(Number(v))) dataMax = Math.max(dataMax, Number(v))
    }
  }
  const { yMax, ticks } = buildYAxis(dataMax)
  const plotW = CHART_W - M.left - M.right
  const plotH = CHART_H - M.top - M.bottom

  const xAt = (i) => (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const yAt = (v) => {
    const nv = Math.min(Math.max(Number(v) || 0, 0), yMax)
    return plotH - (nv / yMax) * plotH
  }

  const plotLeftPct = (M.left / CHART_W) * 100
  const plotWidthPct = (plotW / CHART_W) * 100
  const plotTopPct = (M.top / CHART_H) * 100
  const plotHeightPct = (plotH / CHART_H) * 100

  return (
    <div className="v2-weekly-line" aria-label={ariaLabel}>
      <div className="v2-weekly-line__chart-wrap">
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="v2-weekly-line__svg"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden={weekTooltip ? 'true' : undefined}
        >
          <text
            transform={`translate(${M.yLabelX}, ${M.top + plotH / 2}) rotate(-90)`}
            className="v2-weekly-line__y-title"
            textAnchor="middle"
          >
            {yTitle}
          </text>
          <g transform={`translate(${M.left},${M.top})`}>
            {ticks.map((tv) => {
              const y = yAt(tv)
              return (
                <line
                  key={`g-${tv}`}
                  className="v2-weekly-line__grid"
                  x1={0}
                  y1={y}
                  x2={plotW}
                  y2={y}
                />
              )
            })}
            {ticks.map((tv) => (
              <text
                key={`yt-${tv}`}
                x={-8}
                y={yAt(tv) + 4}
                className="v2-weekly-line__ytick"
                textAnchor="end"
              >
                {Number.isInteger(tv) ? tv : tv.toFixed(1)}
              </text>
            ))}
            <line className="v2-weekly-line__axis" x1={0} y1={plotH} x2={plotW} y2={plotH} />
            <line className="v2-weekly-line__axis" x1={0} y1={0} x2={0} y2={plotH} />
            {series.map((s) => {
              const pts = s.values
                .map((v, i) => {
                  const val = v == null || !Number.isFinite(Number(v)) ? 0 : Number(v)
                  return `${xAt(i)},${yAt(val)}`
                })
                .join(' ')
              return (
                <g key={s.key}>
                  <polyline
                    className="v2-weekly-line__stroke"
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    points={pts}
                  />
                  {s.values.map((v, i) => {
                    const val = v == null || !Number.isFinite(Number(v)) ? 0 : Number(v)
                    const title = s.pointTitle ? s.pointTitle(i, val) : `${weekLabels[i]}: ${val}`
                    return (
                      <circle
                        key={`${s.key}-${i}`}
                        cx={xAt(i)}
                        cy={yAt(val)}
                        r={5}
                        fill={s.color}
                        stroke="#fff"
                        strokeWidth={1.5}
                      >
                        <title>{title}</title>
                      </circle>
                    )
                  })}
                </g>
              )
            })}
          </g>
          <g transform={`translate(${M.left},${M.top + plotH + 10})`}>
            {weekLabels.map((lab, i) => {
              const x = xAt(i)
              return (
                <text
                  key={i}
                  x={x}
                  y={0}
                  className="v2-weekly-line__xtext"
                  transform={`rotate(-42 ${x} 0)`}
                  textAnchor="end"
                >
                  {lab}
                </text>
              )
            })}
          </g>
          <text
            x={M.left + plotW / 2}
            y={CHART_H - 10}
            className="v2-weekly-line__x-axis-title"
            textAnchor="middle"
          >
            {xAxisTitle}
          </text>
        </svg>

        {weekTooltip ? (
          <div
            className="v2-weekly-line__plot-overlay"
            style={{
              left: `${plotLeftPct}%`,
              width: `${plotWidthPct}%`,
              top: `${plotTopPct}%`,
              height: `${plotHeightPct}%`,
            }}
          >
            {weekLabels.map((lab, i) => (
              <div key={`wk-${i}`} className="v2-weekly-line__hit-wrap">
                <InteractiveTooltip
                  title={lab}
                  subtitle={weekTooltip.subtitle}
                  items={weekTooltip.itemsForWeek(i)}
                  emptyText="—"
                  placement={weekTooltip.placement ?? 'left'}
                  maxWidth={weekTooltip.maxWidth ?? 360}
                  maxHeight={weekTooltip.maxHeight ?? 260}
                >
                  <span className="v2-weekly-line__hit-target" />
                </InteractiveTooltip>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function DashboardV2WeeklyTrends({ data, totalSlots, loading, dateRangeLabel }) {
  const { t, i18n } = useTranslation('dashboard')

  const weekLabels = useMemo(
    () => (data || []).map((w) => formatWeekRangeLabel(w.startDate, w.endDate, i18n.language)),
    [data, i18n.language],
  )

  const rangeSub = dateRangeLabel || ''

  if (loading && !data) {
    return (
      <section className="card v2-weekly">
        <h2 className="card__title">{t('v2WeeklyTitle')}</h2>
        <p className="text-steel">{t('loadingEllipsis')}</p>
      </section>
    )
  }

  if (!data || data.length === 0) {
    return null
  }

  return (
    <section className="card v2-weekly">
      <div className="v2-weekly__head">
        <h2 className="card__title">{t('v2WeeklyTitle')}</h2>
        <span className="v2-weekly__period">{dateRangeLabel}</span>
      </div>
      <p className="v2-weekly__hint">{t('v2WeeklyHint')}</p>

      <div className="v2-weekly__block">
        <div className="v2-weekly__block-title">{t('v2WeeklyOccupancy')}</div>
        <WeeklyLineChart
          weekLabels={weekLabels}
          yTitle={t('v2WeeklyOccupancy')}
          xAxisTitle={t('v2WeeklyAxisWeek')}
          ariaLabel={`${t('v2WeeklyOccupancy')}. ${rangeSub}`}
          weekTooltip={{
            subtitle: `${t('v2WeeklyOccupancy')} · ${rangeSub}`,
            placement: 'left',
            itemsForWeek: (i) => {
              const w = data[i]
              const pct = w.slotOccupancyPct ?? '—'
              return [
                {
                  primary: t('v2WeeklyOccupancy'),
                  secondary: typeof pct === 'number' ? `${pct}%` : String(pct),
                },
                {
                  primary: t('v2WeeklyTipOccSecondary', {
                    used: w.berthOccupiedPlans ?? 0,
                    total: totalSlots ?? 0,
                  }),
                },
              ]
            },
          }}
          series={[
            {
              key: 'occ',
              color: 'var(--v2-chart-atberth)',
              values: data.map((w) => (w.slotOccupancyPct != null ? Number(w.slotOccupancyPct) : 0)),
              pointTitle: (i) =>
                t('v2WeeklyOccTooltip', {
                  range: weekLabels[i],
                  pct: data[i].slotOccupancyPct ?? '—',
                  used: data[i].berthOccupiedPlans ?? 0,
                  total: totalSlots ?? 0,
                }),
            },
          ]}
        />
      </div>

      <div className="v2-weekly__block">
        <div className="v2-weekly__block-title">{t('v2WeeklyPlansTitle')}</div>
        <div className="v2-weekly__legend">
          <span className="v2-weekly__legend-item">
            <i className="v2-weekly__legend-marker v2-weekly__legend-marker--approved" />
            {t('v2WeeklyLegendApproved')}
          </span>
          <span className="v2-weekly__legend-item">
            <i className="v2-weekly__legend-marker v2-weekly__legend-marker--sailed" />
            {t('v2WeeklyLegendSailed')}
          </span>
        </div>
        <WeeklyLineChart
          weekLabels={weekLabels}
          yTitle={t('v2WeeklyAxisCount')}
          xAxisTitle={t('v2WeeklyAxisWeek')}
          ariaLabel={`${t('v2WeeklyPlansTitle')}. ${rangeSub}`}
          weekTooltip={{
            subtitle: `${t('v2WeeklyPlansTitle')} · ${rangeSub}`,
            placement: 'left',
            itemsForWeek: (i) => {
              const w = data[i]
              return [
                {
                  primary: t('v2WeeklyLegendApproved'),
                  secondary: String(w.approvedPlans ?? 0),
                },
                {
                  primary: t('v2WeeklyLegendSailed'),
                  secondary: String(w.sailedCount ?? 0),
                },
              ]
            },
          }}
          series={[
            {
              key: 'approved',
              color: 'var(--v2-chart-approved)',
              values: data.map((w) => Number(w.approvedPlans ?? 0)),
              pointTitle: (i) =>
                `${weekLabels[i]}: ${t('v2WeeklyLegendApproved')} ${data[i].approvedPlans ?? 0}`,
            },
            {
              key: 'sailed',
              color: 'var(--v2-chart-sailed)',
              values: data.map((w) => Number(w.sailedCount ?? 0)),
              pointTitle: (i) =>
                `${weekLabels[i]}: ${t('v2WeeklyLegendSailed')} ${data[i].sailedCount ?? 0}`,
            },
          ]}
        />
      </div>

      <div className="v2-weekly__block">
        <div className="v2-weekly__block-title">{t('v2WeeklySlaTitle')}</div>
        <WeeklyLineChart
          weekLabels={weekLabels}
          yTitle={t('v2WeeklyAxisCount')}
          xAxisTitle={t('v2WeeklyAxisWeek')}
          ariaLabel={`${t('v2WeeklySlaTitle')}. ${rangeSub}`}
          weekTooltip={{
            subtitle: `${t('v2WeeklySlaTitle')} · ${rangeSub}`,
            placement: 'left',
            itemsForWeek: (i) => {
              const w = data[i]
              const n = w.slaAtRiskCount ?? 0
              const h = w.slaOverHoursSum
              const rows = [
                {
                  primary: t('v2WeeklyAxisCount'),
                  secondary: String(n),
                },
              ]
              if (h != null && Number.isFinite(Number(h))) {
                rows.push({ primary: t('v2WeeklyTipSlaOver', { h }) })
              }
              return rows
            },
          }}
          series={[
            {
              key: 'sla',
              color: 'var(--v2-risk-color)',
              values: data.map((w) => Number(w.slaAtRiskCount ?? 0)),
              pointTitle: (i) =>
                t('v2WeeklySlaTooltip', {
                  range: weekLabels[i],
                  n: data[i].slaAtRiskCount,
                  h: data[i].slaOverHoursSum,
                }),
            },
          ]}
        />
        <div className="v2-weekly__subnote">{t('v2WeeklySlaSub')}</div>
      </div>
    </section>
  )
}
