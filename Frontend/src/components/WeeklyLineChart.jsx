/**
 * Shared weekly line chart (Ops Analytics / Dashboard V2 weekly trends).
 */
import InteractiveTooltip from './InteractiveTooltip'
import { formatDateDisplay } from '../utils/formatDateTimeDisplay'

export const WEEKLY_LINE_CHART_W = 760
export const WEEKLY_LINE_CHART_H = 200
const CHART_W = WEEKLY_LINE_CHART_W
const CHART_H = WEEKLY_LINE_CHART_H
const M = { left: 48, right: 24, top: 16, bottom: 52, yLabelX: 18 }
const PROJECTED_STROKE = 'var(--v2-chart-projected)'

function numericValue(v) {
  return v == null || !Number.isFinite(Number(v)) ? 0 : Number(v)
}

function isFiniteValue(v) {
  return v != null && Number.isFinite(Number(v))
}

export function formatWeekRangeLabel(startIso, endIso) {
  if (!startIso || !endIso) return '—'
  return `${formatDateDisplay(startIso)} - ${formatDateDisplay(endIso)}`
}

export function buildYAxis(maxValue) {
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

function ChartInfoIcon({ text }) {
  if (!text) return null
  return (
    <InteractiveTooltip items={[{ primary: text }]} maxWidth={360} placement="right">
      <span className="v2-weekly__info-icon" aria-label={text} tabIndex={0} role="img">
        ⓘ
      </span>
    </InteractiveTooltip>
  )
}

export function ChartBlockTitle({ children, info }) {
  return (
    <div className="v2-weekly__block-title">
      <span className="v2-weekly__title-with-info">
        <span>{children}</span>
        <ChartInfoIcon text={info} />
      </span>
    </div>
  )
}

const defaultFormatYTick = (tv) => (Number.isInteger(tv) ? tv : tv.toFixed(1))

export default function WeeklyLineChart({
  weekLabels,
  yTitle,
  xAxisTitle,
  showXAxisTitle = false,
  series,
  ariaLabel,
  weekTooltip,
  weekIsUpcoming = [],
  nullGap = false,
  formatYTick = defaultFormatYTick,
  onBucketClick,
}) {
  const n = weekLabels.length
  if (n === 0) return null

  let dataMax = 0
  for (const s of series) {
    for (const v of s.values) {
      if (isFiniteValue(v)) dataMax = Math.max(dataMax, Number(v))
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
                {formatYTick(tv)}
              </text>
            ))}
            <line className="v2-weekly-line__axis" x1={0} y1={plotH} x2={plotW} y2={plotH} />
            <line className="v2-weekly-line__axis" x1={0} y1={0} x2={0} y2={plotH} />
            {series.map((s) => (
              <g key={s.key}>
                {s.values.length > 1 &&
                  s.values.slice(0, -1).map((_, i) => {
                    const projected = Boolean(weekIsUpcoming[i + 1])
                    let v0
                    let v1
                    if (nullGap) {
                      if (!isFiniteValue(s.values[i]) || !isFiniteValue(s.values[i + 1])) return null
                      v0 = Number(s.values[i])
                      v1 = Number(s.values[i + 1])
                    } else {
                      v0 = numericValue(s.values[i])
                      v1 = numericValue(s.values[i + 1])
                    }
                    return (
                      <line
                        key={`${s.key}-seg-${i}`}
                        className={`v2-weekly-line__stroke${projected ? ' v2-weekly-line__stroke--projected' : ''}`}
                        x1={xAt(i)}
                        y1={yAt(v0)}
                        x2={xAt(i + 1)}
                        y2={yAt(v1)}
                        stroke={projected ? PROJECTED_STROKE : s.color}
                        strokeWidth={2}
                      />
                    )
                  })}
                {s.values.map((v, i) => {
                  if (nullGap && !isFiniteValue(v)) return null
                  const val = nullGap ? Number(v) : numericValue(v)
                  const projected = Boolean(weekIsUpcoming[i])
                  const title = s.pointTitle ? s.pointTitle(i, val) : `${weekLabels[i]}: ${val}`
                  return (
                    <circle
                      key={`${s.key}-${i}`}
                      cx={xAt(i)}
                      cy={yAt(val)}
                      r={5}
                      fill={projected ? PROJECTED_STROKE : s.color}
                      stroke="#fff"
                      strokeWidth={1.5}
                      className={projected ? 'v2-weekly-line__point--projected' : undefined}
                    >
                      <title>{title}</title>
                    </circle>
                  )
                })}
              </g>
            ))}
          </g>
          <g transform={`translate(${M.left},${M.top + plotH + 10})`}>
            {weekLabels.map((lab, i) => {
              const x = xAt(i)
              const projected = Boolean(weekIsUpcoming[i])
              return (
                <text
                  key={i}
                  x={x}
                  y={0}
                  className={`v2-weekly-line__xtext${projected ? ' v2-weekly-line__xtext--projected' : ''}`}
                  transform={`rotate(-32 ${x} 0)`}
                  textAnchor="end"
                >
                  {lab}
                </text>
              )
            })}
          </g>
          {showXAxisTitle ? (
            <text
              x={M.left + plotW / 2}
              y={CHART_H - 8}
              className="v2-weekly-line__x-axis-title"
              textAnchor="middle"
            >
              {xAxisTitle}
            </text>
          ) : null}
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
                  title={weekTooltip.titleForWeek ? weekTooltip.titleForWeek(i) : lab}
                  subtitle={weekTooltip.subtitle}
                  items={weekTooltip.itemsForWeek(i)}
                  emptyText="—"
                  placement={weekTooltip.placement ?? 'left'}
                  maxWidth={weekTooltip.maxWidth ?? 360}
                  maxHeight={weekTooltip.maxHeight ?? 260}
                  interactiveChild={Boolean(onBucketClick)}
                >
                  {onBucketClick ? (
                    <button
                      type="button"
                      className="v2-weekly-line__hit-target v2-weekly-line__hit-target--clickable"
                      aria-label={`Show voyages for ${lab}`}
                      onClick={() => onBucketClick(i)}
                    />
                  ) : (
                    <span className="v2-weekly-line__hit-target" />
                  )}
                </InteractiveTooltip>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
