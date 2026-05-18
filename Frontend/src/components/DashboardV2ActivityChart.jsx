import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'

const MODE_OPS = 'operations'
const MODE_PLANS = 'plans'

const PLAN_STATUSES = ['Draft', 'Submitted', 'Approved', 'Rejected']
const STATUS_COLORS = {
  Draft: 'var(--v2-chart-draft)',
  Submitted: 'var(--v2-chart-submitted)',
  Approved: 'var(--v2-chart-approved)',
  Rejected: 'var(--v2-chart-rejected)',
  Planned: 'var(--v2-chart-planned)',
  AtBerth: 'var(--v2-chart-atberth)',
  Sailed: 'var(--v2-chart-sailed)',
}

function computeYTicks(dataMax) {
  if (dataMax <= 0) return { yMax: 1, ticks: [0, 1] }
  if (dataMax <= 1) return { yMax: 1, ticks: [0, 1] }
  const targetSteps = 4
  let step = Math.ceil(dataMax / targetSteps)
  const pow = 10 ** Math.floor(Math.log10(Math.max(step, 1)))
  const f = step / pow
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  step = nf * pow
  const yMax = Math.ceil(dataMax / step) * step
  const ticks = []
  for (let v = 0; v <= yMax; v += step) ticks.push(v)
  return { yMax, ticks }
}

function buildOpsSeries(ops) {
  const list = Array.isArray(ops) ? ops : []
  const AT_BERTH_STATUSES = new Set(['DOCKED', 'IN_PROGRESS', 'POST_OPS', 'SIGNOFF_REQUESTED', 'SIGNOFF_APPROVED'])
  const PLANNED_STATUSES = new Set(['PENDING', 'ALLOCATED'])

  const result = {
    Loading: { Planned: 0, AtBerth: 0, Sailed: 0, vessels: { Planned: [], AtBerth: [], Sailed: [] } },
    Unloading: { Planned: 0, AtBerth: 0, Sailed: 0, vessels: { Planned: [], AtBerth: [], Sailed: [] } },
  }
  for (const op of list) {
    const purpose = op?.purpose
    if (purpose !== 'Loading' && purpose !== 'Unloading') continue
    const name = (op?.vesselName || '').trim() || `Op #${op?.id ?? '—'}`
    if (PLANNED_STATUSES.has(op.status)) {
      result[purpose].Planned += 1
      result[purpose].vessels.Planned.push(name)
    } else if (AT_BERTH_STATUSES.has(op.status)) {
      result[purpose].AtBerth += 1
      result[purpose].vessels.AtBerth.push(name)
    } else if (op.status === 'SAILED') {
      result[purpose].Sailed += 1
      result[purpose].vessels.Sailed.push(name)
    }
  }
  return result
}

function buildPlansSeries(plans) {
  const list = Array.isArray(plans) ? plans : []
  const result = {
    Loading: { Draft: 0, Submitted: 0, Approved: 0, Rejected: 0, vessels: { Draft: [], Submitted: [], Approved: [], Rejected: [] } },
    Unloading: { Draft: 0, Submitted: 0, Approved: 0, Rejected: 0, vessels: { Draft: [], Submitted: [], Approved: [], Rejected: [] } },
  }
  for (const plan of list) {
    const purpose = plan?.purposeCode
    if (purpose !== 'Loading' && purpose !== 'Unloading') continue
    const status = plan?.approvalStatus || 'Draft'
    if (!PLAN_STATUSES.includes(status)) continue
    const name = (plan?.vesselName || '').trim() || `Plan #${plan?.id ?? '—'}`
    result[purpose][status] = (result[purpose][status] || 0) + 1
    result[purpose].vessels[status].push(name)
  }
  return result
}

function TooltipPortal({ children, anchorRef, visible }) {
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!visible || !anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    setPos({
      top: rect.top + window.scrollY - 8,
      left: rect.left + window.scrollX + rect.width / 2,
    })
  }, [visible, anchorRef])

  if (!visible) return null
  return createPortal(
    <div
      className="v2-chart-tooltip"
      style={{ position: 'absolute', top: pos.top, left: pos.left, transform: 'translate(-50%, -100%)' }}
    >
      {children}
    </div>,
    document.body
  )
}

function ChartBar({ label, color, count, total, vessels, seriesName }) {
  const anchorRef = useRef(null)
  const [hovered, setHovered] = useState(false)
  const pct = total > 0 ? Math.round((count / total) * 100) : 0

  return (
    <div className="v2-chart-bar-wrap">
      <div
        ref={anchorRef}
        className="v2-chart-bar"
        style={{ '--bar-color': color, '--bar-pct': `${Math.min(100, pct)}%`, height: '100%' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label={`${seriesName} ${label}: ${count}`}
        role="img"
      >
        <div className="v2-chart-bar__fill" style={{ background: color, width: `${Math.min(100, pct)}%` }} />
        <span className="v2-chart-bar__count">{count}</span>
      </div>
      <TooltipPortal anchorRef={anchorRef} visible={hovered}>
        <div className="v2-chart-tooltip__title">{seriesName} — {label}</div>
        <div className="v2-chart-tooltip__stat">{count} vessels ({pct}%)</div>
        {vessels.length > 0 && (
          <ul className="v2-chart-tooltip__list">
            {vessels.slice(0, 8).map((v, i) => <li key={i}>{v}</li>)}
            {vessels.length > 8 && <li>+{vessels.length - 8} more</li>}
          </ul>
        )}
        {vessels.length === 0 && <div className="v2-chart-tooltip__empty">No vessels</div>}
      </TooltipPortal>
    </div>
  )
}

export default function DashboardV2ActivityChart({ ops, plans, loading }) {
  const { t } = useTranslation('dashboard')
  const [mode, setMode] = useState(MODE_OPS)

  const opsSeries = useMemo(() => buildOpsSeries(ops), [ops])
  const plansSeries = useMemo(() => buildPlansSeries(plans), [plans])

  const PURPOSES = ['Loading', 'Unloading']

  const opsSeriesKeys = ['Planned', 'AtBerth', 'Sailed']
  const opsSeriesLabels = { Planned: t('v2ChartOpsPlanned'), AtBerth: t('v2ChartOpsAtBerth'), Sailed: t('v2ChartOpsSailed') }
  const opsColors = { Planned: STATUS_COLORS.Planned, AtBerth: STATUS_COLORS.AtBerth, Sailed: STATUS_COLORS.Sailed }

  const plansSeriesLabels = { Draft: t('v2ChartPlanDraft'), Submitted: t('v2ChartPlanSubmitted'), Approved: t('v2ChartPlanApproved'), Rejected: t('v2ChartPlanRejected') }
  const plansColors = { Draft: STATUS_COLORS.Draft, Submitted: STATUS_COLORS.Submitted, Approved: STATUS_COLORS.Approved, Rejected: STATUS_COLORS.Rejected }

  const opsTotal = useMemo(() => {
    let n = 0
    for (const p of PURPOSES) {
      for (const k of opsSeriesKeys) n += opsSeries[p][k]
    }
    return n
  }, [opsSeries])

  const plansTotal = useMemo(() => {
    let n = 0
    for (const p of PURPOSES) {
      for (const k of PLAN_STATUSES) n += plansSeries[p][k]
    }
    return n
  }, [plansSeries])

  const isEmpty = mode === MODE_OPS ? opsTotal === 0 : plansTotal === 0

  return (
    <section className="card v2-chart">
      <div className="v2-chart__head">
        <h2 className="card__title">{t('v2ChartTitle')}</h2>
        <div className="v2-chart__toggle" role="group" aria-label={t('v2ChartTitle')}>
          <button
            type="button"
            className={`v2-chart__toggle-btn${mode === MODE_OPS ? ' is-active' : ''}`}
            onClick={() => setMode(MODE_OPS)}
          >
            {t('v2ChartToggleOps')}
          </button>
          <button
            type="button"
            className={`v2-chart__toggle-btn${mode === MODE_PLANS ? ' is-active' : ''}`}
            onClick={() => setMode(MODE_PLANS)}
          >
            {t('v2ChartTogglePlans')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="v2-chart__loading">{t('loadingEllipsis')}</div>
      ) : isEmpty ? (
        <div className="v2-chart__empty">
          {mode === MODE_OPS ? t('v2ChartEmptyOps') : t('v2ChartEmptyPlans')}
        </div>
      ) : (
        <div className="v2-chart__body">
          {PURPOSES.map((purpose) => {
            const seriesData = mode === MODE_OPS ? opsSeries[purpose] : plansSeries[purpose]
            const seriesKeys = mode === MODE_OPS ? opsSeriesKeys : PLAN_STATUSES
            const seriesLabels = mode === MODE_OPS ? opsSeriesLabels : plansSeriesLabels
            const seriesColors = mode === MODE_OPS ? opsColors : plansColors
            const groupTotal = seriesKeys.reduce((s, k) => s + (seriesData[k] || 0), 0)

            return (
              <div key={purpose} className="v2-chart__group">
                <div className="v2-chart__group-label">{purpose === 'Loading' ? t('purposeLoading') : t('purposeUnloading')}</div>
                <div className="v2-chart__bars">
                  {seriesKeys.map((key) => (
                    <div key={key} className="v2-chart__bar-col">
                      <div className="v2-chart__bar-track">
                        <div
                          className="v2-chart__bar-fill"
                          style={{
                            background: seriesColors[key],
                            height: groupTotal > 0 ? `${Math.round(((seriesData[key] || 0) / groupTotal) * 100)}%` : '0%',
                          }}
                          title={`${seriesLabels[key]}: ${seriesData[key] || 0}`}
                        />
                      </div>
                      <div className="v2-chart__bar-count">{seriesData[key] || 0}</div>
                      <div className="v2-chart__bar-key">{seriesLabels[key]}</div>
                    </div>
                  ))}
                </div>
                <div className="v2-chart__group-total">{t('v2ChartTotal')}: {groupTotal}</div>
              </div>
            )
          })}
        </div>
      )}

      {!loading && !isEmpty && (
        <div className="v2-chart__legend">
          {(mode === MODE_OPS ? opsSeriesKeys : PLAN_STATUSES).map((key) => {
            const colors = mode === MODE_OPS ? opsColors : plansColors
            const labels = mode === MODE_OPS ? opsSeriesLabels : plansSeriesLabels
            return (
              <span key={key} className="v2-chart__legend-item">
                <span className="v2-chart__legend-dot" style={{ background: colors[key] }} />
                {labels[key]}
              </span>
            )
          })}
        </div>
      )}
    </section>
  )
}
