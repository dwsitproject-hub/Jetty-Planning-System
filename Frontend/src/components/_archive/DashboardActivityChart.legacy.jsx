/** Legacy dashboard activity chart (retired). Active UI: `pages/DashboardV2.jsx` at `/`. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import {
  allocationQueueVesselCallKey,
  isPlannedBerthingQueueRow,
  isQueueRowBerthing,
  normalizeQueuePurpose,
} from '../../utils/_archive/dashboardQueueClassification.legacy'

const MODE_OPS = 'operations'
const MODE_SI = 'si'

const BAR_MAX_PX = 120

/** @param {unknown} row */
function queueVesselLabel(row) {
  const n = row?.vesselName
  if (n != null && String(n).trim() !== '') return String(n).trim()
  const id = row?.vesselId
  if (id != null && String(id).trim() !== '') return String(id).trim()
  return '—'
}

/** @param {unknown} s */
function siVesselLabel(s) {
  const n = s?.vesselName
  if (n != null && String(n).trim() !== '') return String(n).trim()
  const id = s?.vesselId
  if (id != null && String(id).trim() !== '') return String(id).trim()
  return '—'
}

/**
 * Integer ticks from 0 to yMax inclusive, step chosen for ~4–5 intervals.
 * @param {number} dataMax
 */
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

function buildOperationsSeries(queue) {
  const counts = {
    Loading: { planned: 0, berthing: 0 },
    Unloading: { planned: 0, berthing: 0 },
  }
  const vessels = {
    Loading: { planned: [], berthing: [] },
    Unloading: { planned: [], berthing: [] },
  }
  const list = Array.isArray(queue) ? queue : []
  const seenPlanned = new Set()
  const seenBerthing = new Set()
  for (const row of list) {
    const purpose = normalizeQueuePurpose(row?.purpose)
    if (!purpose) continue
    const label = queueVesselLabel(row)
    const dedupeKey = `${purpose}:${allocationQueueVesselCallKey(row)}`
    if (isPlannedBerthingQueueRow(row)) {
      if (seenPlanned.has(dedupeKey)) continue
      seenPlanned.add(dedupeKey)
      counts[purpose].planned += 1
      vessels[purpose].planned.push(label)
    } else if (isQueueRowBerthing(row)) {
      if (seenBerthing.has(dedupeKey)) continue
      seenBerthing.add(dedupeKey)
      counts[purpose].berthing += 1
      vessels[purpose].berthing.push(label)
    }
  }
  const purposes = ['Loading', 'Unloading']
  const dataMax = Math.max(
    0,
    ...purposes.flatMap((p) => [counts[p].planned, counts[p].berthing])
  )
  const { yMax, ticks } = computeYTicks(Math.max(1, dataMax))
  return { counts, vessels, purposes, dataMax, yMax, ticks }
}

function buildSiSeries(sis) {
  const list = Array.isArray(sis) ? sis : []
  const counts = { Approved: 0, Submitted: 0, Draft: 0 }
  const vessels = { Approved: [], Submitted: [], Draft: [] }
  for (const s of list) {
    const st = s?.status
    const label = siVesselLabel(s)
    if (st === 'Approved') {
      counts.Approved += 1
      vessels.Approved.push(label)
    } else if (st === 'Submitted') {
      counts.Submitted += 1
      vessels.Submitted.push(label)
    } else if (st === 'Draft') {
      counts.Draft += 1
      vessels.Draft.push(label)
    }
  }
  const total = counts.Approved + counts.Submitted + counts.Draft
  const dataMax = Math.max(0, ...['Approved', 'Submitted', 'Draft'].map((key) => counts[key]))
  const { yMax, ticks } = computeYTicks(Math.max(1, dataMax))
  return { counts, vessels, total, dataMax, yMax, ticks }
}

/** @param {number} count @param {number} yMax */
function barHeightPx(count, yMax) {
  if (count <= 0 || yMax <= 0) return 0
  const h = (count / yMax) * BAR_MAX_PX
  return count > 0 ? Math.max(h, 4) : 0
}

function BarHit({
  count,
  yMax,
  tipKey,
  seriesLabel,
  contextLabel,
  pctLabel,
  names,
  barClass,
  onShowTip,
  onHideTip,
  tipActive,
  ariaVessels,
  ariaNone,
}) {
  const h = barHeightPx(count, yMax)
  const show = count > 0

  const onEnter = useCallback(
    (e) => {
      if (!show) return
      onShowTip(e.currentTarget, {
        tipKey,
        count,
        seriesLabel,
        contextLabel,
        pctLabel,
        names,
      })
    },
    [show, tipKey, count, seriesLabel, contextLabel, pctLabel, names, onShowTip]
  )

  if (!show) {
    return (
      <div className="dashboard-activity-chart__bar-col-inner">
        <div
          className={`dashboard-activity-chart__bar ${barClass} dashboard-activity-chart__bar--empty`}
          style={{ height: 0 }}
          aria-hidden
        />
      </div>
    )
  }

  return (
    <div className="dashboard-activity-chart__bar-col-inner">
      <button
        type="button"
        className={`dashboard-activity-chart__bar-hit${tipActive ? ' is-active' : ''}`}
        onMouseEnter={onEnter}
        onMouseLeave={onHideTip}
        onFocus={onEnter}
        onBlur={onHideTip}
        aria-label={`${seriesLabel}, ${contextLabel}: ${count}. ${pctLabel}. ${ariaVessels} ${names.join(', ') || ariaNone}.`}
      >
        <div
          className={`dashboard-activity-chart__bar ${barClass}`}
          style={{ height: `${h}px` }}
        />
      </button>
    </div>
  )
}

function TooltipLayer({ tip, onClose, emptyBucketText }) {
  useEffect(() => {
    if (!tip) return undefined
    const onScroll = () => onClose()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [tip, onClose])

  if (!tip) return null

  const { left, top, flip } = tip
  const names = tip.names || []

  return createPortal(
    <div
      className={`dashboard-activity-chart__tooltip${flip ? ' dashboard-activity-chart__tooltip--flip' : ''}`}
      style={{ left, top }}
      role="tooltip"
    >
      <div className="dashboard-activity-chart__tooltip-inner">
        <div className="dashboard-activity-chart__tooltip-value">{tip.count}</div>
        <div className="dashboard-activity-chart__tooltip-series">{tip.seriesLabel}</div>
        <div className="dashboard-activity-chart__tooltip-context">{tip.contextLabel}</div>
        <div className="dashboard-activity-chart__tooltip-pct">{tip.pctLabel}</div>
        {names.length > 0 ? (
          <ul className="dashboard-activity-chart__tooltip-names">
            {names.map((n, i) => (
              <li key={`${n}-${i}`}>{n}</li>
            ))}
          </ul>
        ) : (
          <p className="dashboard-activity-chart__tooltip-empty">{emptyBucketText}</p>
        )}
      </div>
    </div>,
    document.body
  )
}

/**
 * @param {{ queue: unknown[], sis: unknown[], loading?: boolean }} props
 */
export default function DashboardActivityChart({ queue, sis, loading = false }) {
  const { t } = useTranslation('dashboard')
  const [mode, setMode] = useState(MODE_OPS)
  const [tip, setTip] = useState(null)

  const seriesPlanned = useMemo(() => ({ key: 'planned', label: t('legendPlannedBerthing') }), [t])
  const seriesBerth = useMemo(() => ({ key: 'berthing', label: t('legendBerthing') }), [t])
  const siOrder = useMemo(
    () => [
      { key: 'Approved', label: t('legendApproved') },
      { key: 'Submitted', label: t('legendSubmitted') },
      { key: 'Draft', label: t('legendDraft') },
    ],
    [t]
  )

  const opsData = useMemo(() => buildOperationsSeries(queue), [queue])
  const siData = useMemo(() => buildSiSeries(sis), [sis])

  const hideTip = useCallback(() => setTip(null), [])

  useEffect(() => {
    hideTip()
  }, [mode, queue, sis, hideTip])

  const showTip = useCallback((el, payload) => {
    const r = el.getBoundingClientRect()
    const gap = 10
    const estW = 260
    let left = r.left - gap - estW
    let flip = false
    if (left < 12) {
      left = r.right + gap
      flip = true
    }
    const top = r.top + r.height / 2
    setTip({ ...payload, left, top, flip })
  }, [])

  const purposeLabel = useCallback(
    (p) => (p === 'Loading' ? t('purposeLoading') : t('purposeUnloading')),
    [t]
  )

  const opsSummary = useMemo(() => {
    const { counts, purposes } = opsData
    const parts = []
    for (const p of purposes) {
      const pl = counts[p].planned
      const br = counts[p].berthing
      const tot = pl + br
      parts.push(
        t('opsSummaryParts', {
          purpose: purposeLabel(p),
          planned: pl,
          berthing: br,
          total: tot,
        })
      )
    }
    return parts.join('. ')
  }, [opsData, t, purposeLabel])

  const siSummary = useMemo(() => {
    const { counts, total } = siData
    if (total === 0) return t('siSummaryEmpty')
    return siOrder.map(({ key, label }) => `${label} ${counts[key]}`).join(', ')
  }, [siData, siOrder, t])

  const opsEmpty = opsData.purposes.every(
    (p) => opsData.counts[p].planned + opsData.counts[p].berthing === 0
  )

  const yAxisGapClass = 'dashboard-activity-chart__y-gap'
  const yScaleClass = 'dashboard-activity-chart__y-scale'

  return (
    <div className="card dashboard-activity-chart">
      <TooltipLayer tip={tip} onClose={hideTip} emptyBucketText={t('chartTooltipNoNames')} />

      <div className="dashboard-activity-chart__head">
        <h2 className="card__title">{t('chartPortActivity')}</h2>
        <div className="dashboard-activity-chart__toggle" role="group" aria-label={t('chartPortActivity')}>
          <button
            type="button"
            className={`dashboard-activity-chart__toggle-btn${mode === MODE_OPS ? ' is-active' : ''}`}
            onClick={() => setMode(MODE_OPS)}
          >
            {t('chartToggleOps')}
          </button>
          <button
            type="button"
            className={`dashboard-activity-chart__toggle-btn${mode === MODE_SI ? ' is-active' : ''}`}
            onClick={() => setMode(MODE_SI)}
          >
            {t('chartToggleSi')}
          </button>
        </div>
      </div>

      {mode === MODE_SI ? (
        <p className="dashboard-activity-chart__hint text-steel">{t('chartHintSi')}</p>
      ) : null}

      {loading ? (
        <p className="text-steel">{t('loadingEllipsis')}</p>
      ) : mode === MODE_OPS ? (
        <div
          className="dashboard-activity-chart__body"
          role="img"
          aria-label={t('chartAriaOps', { summary: opsSummary })}
        >
          <div className="dashboard-activity-chart__legend dashboard-activity-chart__legend--ops" aria-hidden>
            {opsData.purposes.map((purpose) => (
              <div key={purpose} className="dashboard-activity-chart__legend-purpose">
                <span className="dashboard-activity-chart__legend-purpose-label">{purposeLabel(purpose)}</span>
                <span className="dashboard-activity-chart__legend-item">
                  <span
                    className={`dashboard-activity-chart__swatch dashboard-activity-chart__swatch--ops-planned-${purpose === 'Loading' ? 'loading' : 'unloading'}`}
                  />{' '}
                  {seriesPlanned.label}
                </span>
                <span className="dashboard-activity-chart__legend-item">
                  <span
                    className={`dashboard-activity-chart__swatch dashboard-activity-chart__swatch--ops-berth-${purpose === 'Loading' ? 'loading' : 'unloading'}`}
                  />{' '}
                  {seriesBerth.label}
                </span>
              </div>
            ))}
          </div>

          {opsEmpty ? (
            <p className="text-steel dashboard-activity-chart__empty">
              {t('chartEmptyOps')}
            </p>
          ) : (
            <div className="dashboard-activity-chart__plot">
              <div className="dashboard-activity-chart__y-col">
                <div className={yAxisGapClass} aria-hidden />
                <div className={yScaleClass} style={{ height: BAR_MAX_PX }}>
                  {opsData.ticks.map((v) => (
                    <span
                      key={v}
                      className={`dashboard-activity-chart__y-label${
                        v === 0 ? ' dashboard-activity-chart__y-label--zero' : ''
                      }${v === opsData.yMax && opsData.yMax > 0 ? ' dashboard-activity-chart__y-label--max' : ''}`}
                      style={{ bottom: `${(v / opsData.yMax) * 100}%` }}
                    >
                      {v}
                    </span>
                  ))}
                </div>
                <div className={`${yAxisGapClass} ${yAxisGapClass}--meta`} aria-hidden />
              </div>

              <div className="dashboard-activity-chart__plot-main">
                <div className="dashboard-activity-chart__titles-row">
                  {opsData.purposes.map((purpose) => (
                    <div key={purpose} className="dashboard-activity-chart__title-cell">
                      {purposeLabel(purpose)}
                    </div>
                  ))}
                </div>

                <div className="dashboard-activity-chart__grid-wrap" style={{ height: BAR_MAX_PX }}>
                  {opsData.ticks.map((tickVal) => (
                    <div
                      key={`grid-${tickVal}`}
                      className="dashboard-activity-chart__grid-line"
                      style={{ bottom: `${(tickVal / opsData.yMax) * 100}%` }}
                    />
                  ))}
                  <div className="dashboard-activity-chart__bars-row">
                    {opsData.purposes.map((purpose) => {
                      const { planned, berthing } = opsData.counts[purpose]
                      const subtotal = planned + berthing
                      const pctPlanned = subtotal > 0 ? Math.round((planned / subtotal) * 100) : 0
                      const pctBerth = subtotal > 0 ? Math.round((berthing / subtotal) * 100) : 0
                      const namesPl = opsData.vessels[purpose].planned
                      const namesBr = opsData.vessels[purpose].berthing
                      const pl = purposeLabel(purpose)
                      return (
                        <div key={purpose} className="dashboard-activity-chart__bar-group">
                          <div className="dashboard-activity-chart__bars">
                            <div className="dashboard-activity-chart__bar-col">
                              <BarHit
                                count={planned}
                                yMax={opsData.yMax}
                                tipKey={`ops-${purpose}-planned`}
                                seriesLabel={seriesPlanned.label}
                                contextLabel={pl}
                                pctLabel={t('pctOfPurpose', { pct: pctPlanned, purpose: pl })}
                                names={namesPl}
                                barClass={`dashboard-activity-chart__bar--ops-planned-${purpose === 'Loading' ? 'loading' : 'unloading'}`}
                                onShowTip={showTip}
                                onHideTip={hideTip}
                                tipActive={tip?.tipKey === `ops-${purpose}-planned`}
                                ariaVessels={t('chartTooltipVessels')}
                                ariaNone={t('chartTooltipNone')}
                              />
                            </div>
                            <div className="dashboard-activity-chart__bar-col">
                              <BarHit
                                count={berthing}
                                yMax={opsData.yMax}
                                tipKey={`ops-${purpose}-berthing`}
                                seriesLabel={seriesBerth.label}
                                contextLabel={pl}
                                pctLabel={t('pctOfPurpose', { pct: pctBerth, purpose: pl })}
                                names={namesBr}
                                barClass={`dashboard-activity-chart__bar--ops-berth-${purpose === 'Loading' ? 'loading' : 'unloading'}`}
                                onShowTip={showTip}
                                onHideTip={hideTip}
                                tipActive={tip?.tipKey === `ops-${purpose}-berthing`}
                                ariaVessels={t('chartTooltipVessels')}
                                ariaNone={t('chartTooltipNone')}
                              />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="dashboard-activity-chart__meta-row">
                  {opsData.purposes.map((purpose) => {
                    const { planned, berthing } = opsData.counts[purpose]
                    const subtotal = planned + berthing
                    const pctPlanned = subtotal > 0 ? Math.round((planned / subtotal) * 100) : 0
                    const pctBerth = subtotal > 0 ? Math.round((berthing / subtotal) * 100) : 0
                    return (
                      <div key={purpose} className="dashboard-activity-chart__meta-cell">
                        <div className="dashboard-activity-chart__bar-meta dashboard-activity-chart__bar-meta--pair">
                          <span>
                            <span className="dashboard-activity-chart__bar-count">{planned}</span>
                            <span className="dashboard-activity-chart__bar-pct"> {pctPlanned}%</span>
                          </span>
                          <span>
                            <span className="dashboard-activity-chart__bar-count">{berthing}</span>
                            <span className="dashboard-activity-chart__bar-pct"> {pctBerth}%</span>
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div
          className="dashboard-activity-chart__body dashboard-activity-chart__body--si"
          role="img"
          aria-label={t('chartAriaSi', { summary: siSummary })}
        >
          <div className="dashboard-activity-chart__legend dashboard-activity-chart__legend--si" aria-hidden>
            {siOrder.map(({ key, label }, i) => (
              <span key={key} className="dashboard-activity-chart__legend-item">
                <span className={`dashboard-activity-chart__swatch dashboard-activity-chart__swatch--si-${i}`} />{' '}
                {label}
              </span>
            ))}
          </div>

          {siData.total === 0 ? (
            <p className="text-steel dashboard-activity-chart__empty">{t('chartEmptySi')}</p>
          ) : (
            <div className="dashboard-activity-chart__plot">
              <div className="dashboard-activity-chart__y-col">
                <div className={yAxisGapClass} aria-hidden />
                <div className={yScaleClass} style={{ height: BAR_MAX_PX }}>
                  {siData.ticks.map((v) => (
                    <span
                      key={v}
                      className={`dashboard-activity-chart__y-label${
                        v === 0 ? ' dashboard-activity-chart__y-label--zero' : ''
                      }${v === siData.yMax && siData.yMax > 0 ? ' dashboard-activity-chart__y-label--max' : ''}`}
                      style={{ bottom: `${(v / siData.yMax) * 100}%` }}
                    >
                      {v}
                    </span>
                  ))}
                </div>
                <div className={`${yAxisGapClass} ${yAxisGapClass}--meta`} aria-hidden />
              </div>

              <div className="dashboard-activity-chart__plot-main">
                <div className="dashboard-activity-chart__titles-row dashboard-activity-chart__titles-row--si">
                  {siOrder.map(({ key, label }) => (
                    <div key={key} className="dashboard-activity-chart__title-cell">
                      {label}
                    </div>
                  ))}
                </div>

                <div className="dashboard-activity-chart__grid-wrap" style={{ height: BAR_MAX_PX }}>
                  {siData.ticks.map((tickVal) => (
                    <div
                      key={`grid-si-${tickVal}`}
                      className="dashboard-activity-chart__grid-line"
                      style={{ bottom: `${(tickVal / siData.yMax) * 100}%` }}
                    />
                  ))}
                  <div className="dashboard-activity-chart__bars-row dashboard-activity-chart__bars-row--si">
                    {siOrder.map(({ key, label }, i) => {
                      const n = siData.counts[key]
                      const pct = siData.total > 0 ? Math.round((n / siData.total) * 100) : 0
                      return (
                        <div key={key} className="dashboard-activity-chart__bar-group">
                          <div className="dashboard-activity-chart__bars dashboard-activity-chart__bars--single">
                            <div className="dashboard-activity-chart__bar-col">
                              <BarHit
                                count={n}
                                yMax={siData.yMax}
                                tipKey={`si-${key}`}
                                seriesLabel={label}
                                contextLabel={t('chartSiContext')}
                                pctLabel={t('siPctOfPort', { pct })}
                                names={siData.vessels[key]}
                                barClass={`dashboard-activity-chart__bar--si-${i}`}
                                onShowTip={showTip}
                                onHideTip={hideTip}
                                tipActive={tip?.tipKey === `si-${key}`}
                                ariaVessels={t('chartTooltipVessels')}
                                ariaNone={t('chartTooltipNone')}
                              />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="dashboard-activity-chart__meta-row dashboard-activity-chart__meta-row--si">
                  {siOrder.map(({ key }) => {
                    const n = siData.counts[key]
                    const pct = siData.total > 0 ? Math.round((n / siData.total) * 100) : 0
                    return (
                      <div key={key} className="dashboard-activity-chart__meta-cell">
                        <div className="dashboard-activity-chart__bar-meta">
                          <span className="dashboard-activity-chart__bar-count">{n}</span>
                          <span className="dashboard-activity-chart__bar-pct">{pct}%</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
