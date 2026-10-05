/**
 * By-product drill-down: Chart vs Detailed data (voyage table).
 */
import { useEffect, useMemo, useState } from 'react'
import WeeklyLineChart, { ChartBlockTitle } from '../WeeklyLineChart.jsx'
import { productQtyOnVoyage } from '../../utils/managementDashboardProduct.js'
import {
  buildProductTimeSeries,
  formatBucketTooltipTitle,
  granularityForWindow,
  granularityLabel,
} from '../../utils/managementDashboardProductSeries.js'
import { fmtMgmtDurationHours, PRODUCT_COLUMN_TOOLTIPS } from './ManagementProductTable.jsx'
import '../../styles/modal.css'
import '../../styles/management-dashboard.css'
import '../../styles/dashboard.css'

function fmtNum(n, d = 0) {
  return n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d })
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function chartWindow(win, voyages) {
  if (win?.start != null && win?.end != null) return { start: win.start, end: win.end }
  const times = (voyages || [])
    .map((v) => (v.castOff ? new Date(v.castOff).getTime() : NaN))
    .filter(Number.isFinite)
  if (!times.length) {
    const end = Date.now()
    return { start: end - 86400000, end }
  }
  return { start: Math.min(...times), end: Math.max(...times) + 86400000 }
}

const LINE_COLOR_LOAD = 'var(--v2-chart-sailed)'
const LINE_COLOR_DISCH = 'var(--v2-chart-atberth)'

export default function ProductDetailModal({ detail, onClose }) {
  const [view, setView] = useState('chart')

  useEffect(() => {
    setView('chart')
  }, [detail?.productRow?.key, detail?.productRow?.purpose])

  const productRow = detail?.productRow
  const voyages = detail?.voyages || []
  const win = detail?.win
  const flowFooter = detail?.flowFooter

  const tableRows = useMemo(
    () =>
      productRow
        ? [...voyages].sort(
            (a, b) =>
              (Number(productQtyOnVoyage(b, productRow.key)) || 0) -
              (Number(productQtyOnVoyage(a, productRow.key)) || 0)
          )
        : [],
    [voyages, productRow]
  )

  const granularity = useMemo(() => {
    const cw = chartWindow(win, voyages)
    return granularityForWindow(cw.start, cw.end)
  }, [win, voyages])

  const series = useMemo(() => {
    if (!productRow) return []
    const cw = chartWindow(win, voyages)
    return buildProductTimeSeries(voyages, productRow.key, {
      start: cw.start,
      end: cw.end,
      granularity,
    })
  }, [productRow, voyages, win, granularity])

  const weekLabels = useMemo(() => series.map((b) => b.shortLabel), [series])

  const lineColor =
    productRow?.purpose === 'Unloading' ? LINE_COLOR_DISCH : LINE_COLOR_LOAD

  const chartRangeSub = useMemo(
    () => [detail?.periodLabel, granularityLabel(granularity)].filter(Boolean).join(' · '),
    [detail?.periodLabel, granularity]
  )

  if (!detail || !productRow) return null

  const directionLabel = productRow.purpose === 'Unloading' ? 'Incoming' : 'Outgoing'
  const purposeChipClass =
    productRow.purpose === 'Unloading' ? 'mgmt-chip--disch' : 'mgmt-chip--load'
  const purposeChipLabel = productRow.purpose === 'Unloading' ? 'Unloading' : 'Loading'
  const c = productRow.coverage || {}
  const preNote =
    c.total && c.preLogged != null ? `${c.preLogged} of ${c.total} voyages with pre-check logged` : null
  const subtitle = [
    detail.periodLabel ? detail.periodLabel : null,
    `${productRow.shipments} voyages · ${fmtNum(Math.round(productRow.throughputMt))} MT`,
    preNote,
  ]
    .filter(Boolean)
    .join(' · ')

  const chartMetrics = [
    {
      key: 'avgWait',
      title: 'Avg wait',
      tooltip: PRODUCT_COLUMN_TOOLTIPS.avgWait,
      yTitle: 'Hours',
      pick: (b) => b.avgWait,
      formatValue: (v) => fmtMgmtDurationHours(v),
    },
    {
      key: 'avgPre',
      title: 'Berth → start cargo',
      tooltip: PRODUCT_COLUMN_TOOLTIPS.berthToStart,
      yTitle: 'Hours',
      pick: (b) => b.avgPre,
      formatValue: (v) => fmtMgmtDurationHours(v),
    },
    {
      key: 'avgRate',
      title: 'Avg flow',
      tooltip: PRODUCT_COLUMN_TOOLTIPS.avgFlow,
      yTitle: 'MT/h',
      pick: (b) => b.avgRate,
      formatValue: (v) => (v == null ? '—' : `${fmtNum(v, 1)} MT/h`),
    },
    {
      key: 'avgSign2Co',
      title: 'Ops complete → sail',
      tooltip: PRODUCT_COLUMN_TOOLTIPS.opsToSail,
      yTitle: 'Hours',
      pick: (b) => b.avgSign2Co,
      formatValue: (v) => fmtMgmtDurationHours(v),
    },
  ]

  const singleBucketHint =
    series.length <= 1 && view === 'chart' ? (
      <p className="text-steel mgmt-sub mgmt-product-chart-hint">
        Only one time bucket in this period — pick Last 30 days or longer to see a trend.
      </p>
    ) : null

  return (
    <div className="modal-overlay" onClick={onClose} aria-hidden="true">
      <div
        className="modal modal--wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="product-detail-modal-title"
        aria-modal="true"
      >
        <div className="mgmt-modal-header">
          <h2 id="product-detail-modal-title" className="modal__title mgmt-product-modal-title">
            <span>
              {productRow.label} — {directionLabel}
            </span>
            <span className={`mgmt-chip ${purposeChipClass}`}>{purposeChipLabel}</span>
          </h2>
          <button type="button" className="mgmt-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {subtitle ? <p className="text-steel mgmt-sub" style={{ marginTop: 0 }}>{subtitle}</p> : null}

        <div className="mgmt-seg mgmt-product-modal-seg" role="group" aria-label="Product detail view">
          <button type="button" className={view === 'chart' ? 'on' : ''} onClick={() => setView('chart')}>
            Chart
          </button>
          <button type="button" className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>
            Detailed data
          </button>
        </div>

        <div className="mgmt-modal-summary">
          <div className="mgmt-modal-summary__item">
            <span className="mgmt-modal-summary__lbl">Shipments</span>
            <span className="mgmt-modal-summary__val">{String(productRow.shipments)}</span>
          </div>
          <div className="mgmt-modal-summary__item">
            <span className="mgmt-modal-summary__lbl">Total MT</span>
            <span className="mgmt-modal-summary__val">{fmtNum(Math.round(productRow.throughputMt))}</span>
          </div>
          <div className="mgmt-modal-summary__item">
            <span className="mgmt-modal-summary__lbl">Avg wait</span>
            <span className="mgmt-modal-summary__val">{fmtMgmtDurationHours(productRow.avgWait)}</span>
          </div>
          <div className="mgmt-modal-summary__item">
            <span className="mgmt-modal-summary__lbl">Avg flow</span>
            <span className="mgmt-modal-summary__val">
              {productRow.avgRate == null ? '—' : `${fmtNum(productRow.avgRate, 1)} MT/h`}
            </span>
          </div>
        </div>

        {view === 'chart' ? (
          <div className="mgmt-product-weekly-wrap">
            <p className="text-steel mgmt-sub mgmt-product-chart-gran">{chartRangeSub}</p>
            {singleBucketHint}
            <div className="v2-weekly__body mgmt-product-weekly-trends">
              {chartMetrics.map((m) => {
                const values = series.map((b) => m.pick(b))
                const hasData = values.some((v) => v != null && Number.isFinite(v))
                return (
                  <div className="v2-weekly__block" key={m.key}>
                    <ChartBlockTitle info={m.tooltip}>{m.title}</ChartBlockTitle>
                    {!hasData ? (
                      <p className="text-steel mgmt-sub">No logged data in this period</p>
                    ) : (
                      <WeeklyLineChart
                        weekLabels={weekLabels}
                        yTitle={m.yTitle}
                        xAxisTitle={granularity === 'week' ? 'Week' : 'Month'}
                        showXAxisTitle={false}
                        nullGap
                        ariaLabel={`${m.title}. ${chartRangeSub}`}
                        weekTooltip={{
                          subtitle: `${m.title} · ${chartRangeSub}`,
                          placement: 'left',
                          titleForWeek: (i) => formatBucketTooltipTitle(series[i]),
                          itemsForWeek: (i) => {
                            const b = series[i]
                            const raw = m.pick(b)
                            return [
                              {
                                primary: m.title,
                                secondary: m.formatValue(raw),
                              },
                              {
                                primary: 'Voyages in bucket',
                                secondary: String(b.voyageCount ?? 0),
                              },
                            ]
                          },
                        }}
                        series={[
                          {
                            key: m.key,
                            color: lineColor,
                            values,
                            pointTitle: (i, val) =>
                              `${formatBucketTooltipTitle(series[i])}: ${m.formatValue(val)} · ${series[i].voyageCount} voyages`,
                          },
                        ]}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Vessel</th>
                  <th>Jetty</th>
                  <th className="mgmt-r">Qty (MT)</th>
                  <th className="mgmt-r">Wait h</th>
                  <th className="mgmt-r">Pre-check h</th>
                  <th className="mgmt-r">Ops h</th>
                  <th className="mgmt-r">Ops→Sail h</th>
                  <th>Cast-off</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.length ? (
                  tableRows.map((r, i) => (
                    <tr key={r.id ?? i}>
                      <td>{r.vessel}</td>
                      <td>{r.jetty || '—'}</td>
                      <td className="mgmt-r">
                        {fmtNum(productQtyOnVoyage(r, productRow.key) ?? r.qty)}
                      </td>
                      <td className="mgmt-r">{fmtNum(r.wait, 1)}</td>
                      <td className="mgmt-r">{fmtNum(r.pre, 1)}</td>
                      <td className="mgmt-r">{fmtNum(r.opsH, 1)}</td>
                      <td className="mgmt-r">{fmtNum(r.sign2co, 1)}</td>
                      <td>{fmtDate(r.castOff)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="text-steel">
                      No voyages in this view.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {flowFooter ? <div className="mgmt-modal-foot">{flowFooter}</div> : null}
      </div>
    </div>
  )
}
