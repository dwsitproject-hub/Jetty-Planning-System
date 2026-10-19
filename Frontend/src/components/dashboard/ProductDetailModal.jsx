/**
 * By-product drill-down: Chart vs Detailed data (voyage table).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import WeeklyLineChart, { ChartBlockTitle } from '../WeeklyLineChart.jsx'
import {
  buildProductTimeSeries,
  formatBucketTooltipTitle,
  granularityForWindow,
  granularityLabel,
  bucketMetricLoggedCount,
  voyagesInSailedOffBucket,
} from '../../utils/managementDashboardProductSeries.js'
import {
  fmtMgmtDurationDays,
  mgmtHoursAsDays,
  PRODUCT_COLUMN_TOOLTIPS,
} from './ManagementProductTable.jsx'
import ProductVoyageDetailTable, {
  chartMetricToVoyageColumn,
  sortVoyageRowsByProductQty,
} from './ProductVoyageDetailTable.jsx'
import '../../styles/modal.css'
import '../../styles/management-dashboard.css'
import '../../styles/dashboard.css'

function fmtNum(n, d = 0) {
  return n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d })
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

export const CHART_METRICS = [
  {
    key: 'avgWait',
    title: 'Avg wait',
    tooltip: PRODUCT_COLUMN_TOOLTIPS.avgWait,
    yTitle: 'Days',
    pick: (b) => b.avgWait,
    formatValue: (v) => fmtMgmtDurationDays(v),
    chartValue: (v) => mgmtHoursAsDays(v),
    formatPointLabel: (v) =>
      v == null || !Number.isFinite(v) ? null : `${fmtNum(v, 1)} d`,
  },
  {
    key: 'avgPre',
    title: 'Berth → start cargo',
    tooltip: PRODUCT_COLUMN_TOOLTIPS.berthToStart,
    yTitle: 'Days',
    pick: (b) => b.avgPre,
    formatValue: (v) => fmtMgmtDurationDays(v),
    chartValue: (v) => mgmtHoursAsDays(v),
    formatPointLabel: (v) =>
      v == null || !Number.isFinite(v) ? null : `${fmtNum(v, 1)} d`,
  },
  {
    key: 'avgRate',
    title: 'Avg flow',
    tooltip: PRODUCT_COLUMN_TOOLTIPS.avgFlow,
    yTitle: 'MT/h',
    pick: (b) => b.avgRate,
    formatValue: (v) => (v == null ? '—' : `${fmtNum(v, 1)} MT/h`),
    formatPointLabel: (v) =>
      v == null || !Number.isFinite(v) ? null : fmtNum(v, 1),
  },
  {
    key: 'avgCargoDoneToSail',
    title: 'Cargo done → sailed off',
    tooltip: PRODUCT_COLUMN_TOOLTIPS.cargoDoneToSail,
    yTitle: 'Days',
    pick: (b) => b.avgCargoDoneToSail,
    formatValue: (v) => fmtMgmtDurationDays(v),
    chartValue: (v) => mgmtHoursAsDays(v),
    formatPointLabel: (v) =>
      v == null || !Number.isFinite(v) ? null : `${fmtNum(v, 1)} d`,
  },
]

const DEFAULT_METRIC_KEY = 'avgWait'

export default function ProductDetailModal({ detail, onClose }) {
  const [view, setView] = useState('chart')
  const [activeMetricKey, setActiveMetricKey] = useState(DEFAULT_METRIC_KEY)
  const [bucketDrill, setBucketDrill] = useState(null)

  const productRow = detail?.productRow
  const voyages = detail?.voyages || []
  const win = detail?.win
  const flowFooter = detail?.flowFooter
  const opDetailsById = detail?.opDetailsById ?? null
  const timelinesByOpId = detail?.timelinesByOpId ?? null

  useEffect(() => {
    setView(detail?.initialView === 'table' ? 'table' : 'chart')
    setActiveMetricKey(detail?.focusMetricKey || DEFAULT_METRIC_KEY)
    setBucketDrill(null)
  }, [
    detail?.productRow?.key,
    detail?.productRow?.purpose,
    detail?.initialView,
    detail?.focusMetricKey,
  ])

  useEffect(() => {
    if (view === 'table') setBucketDrill(null)
  }, [view])

  const makeBucketClickHandler = useCallback(
    (metricKey) => (i) => {
      setBucketDrill((prev) =>
        prev?.index === i && prev?.metricKey === metricKey ? null : { index: i, metricKey }
      )
    },
    []
  )

  const tableRows = useMemo(
    () => (productRow ? sortVoyageRowsByProductQty(voyages, productRow.key) : []),
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

  const bucketDrillRows = useMemo(() => {
    const idx = bucketDrill?.index
    if (idx == null || !productRow || !series[idx]) return []
    const inBucket = voyagesInSailedOffBucket(voyages, series[idx], granularity)
    return sortVoyageRowsByProductQty(inBucket, productRow.key)
  }, [bucketDrill?.index, productRow, series, voyages, granularity])

  const weekLabels = useMemo(() => series.map((b) => b.shortLabel), [series])

  const lineColor =
    productRow?.purpose === 'Unloading' ? LINE_COLOR_DISCH : LINE_COLOR_LOAD

  const chartRangeSub = useMemo(
    () => [detail?.periodLabel, granularityLabel(granularity)].filter(Boolean).join(' · '),
    [detail?.periodLabel, granularity]
  )

  const weekTooltipItems = useCallback(
    (m, i) => {
      const b = series[i]
      const raw = m.pick(b)
      const total = b.voyageCount ?? 0
      const logged = bucketMetricLoggedCount(b, m.key)
      const items = [
        { primary: m.title, secondary: m.formatValue(raw) },
        { primary: 'Voyages in bucket (sailed off)', secondary: String(total) },
      ]
      if (total > 0) {
        items.push({
          primary: 'With data for this metric',
          secondary: logged === total ? String(logged) : `${logged} of ${total}`,
        })
      }
      items.push({ primary: 'Click for voyage list', secondary: null })
      return items
    },
    [series]
  )

  const onMetricSwitch = useCallback((key) => {
    setActiveMetricKey(key)
    setBucketDrill(null)
  }, [])

  if (!detail || !productRow) return null

  const directionLabel = productRow.purpose === 'Unloading' ? 'Incoming' : 'Outgoing'
  const purposeChipClass =
    productRow.purpose === 'Unloading' ? 'mgmt-chip--disch' : 'mgmt-chip--load'
  const purposeChipLabel = productRow.purpose === 'Unloading' ? 'Unloading' : 'Loading'
  const c = productRow.coverage || {}
  const preNote =
    c.total && c.preLogged != null
      ? `${c.preLogged} of ${c.total} voyages with TB and cargo operation start logged`
      : null
  const subtitle = [
    detail.periodLabel ? detail.periodLabel : null,
    `${productRow.shipments} voyages · ${fmtNum(Math.round(productRow.throughputMt))} MT`,
    preNote,
  ]
    .filter(Boolean)
    .join(' · ')

  const activeMetric =
    CHART_METRICS.find((m) => m.key === activeMetricKey) ?? CHART_METRICS[0]

  const selectedBucket =
    bucketDrill?.index != null ? series[bucketDrill.index] : null
  const drillMetric = bucketDrill?.metricKey
    ? CHART_METRICS.find((m) => m.key === bucketDrill.metricKey)
    : null
  const highlightColumn = drillMetric
    ? chartMetricToVoyageColumn(drillMetric.key)
    : null

  const chartActiveDrill =
    bucketDrill?.metricKey === activeMetric.key && bucketDrill?.index != null

  const drillBucketCoverage =
    selectedBucket && drillMetric
      ? {
          total: selectedBucket.voyageCount ?? bucketDrillRows.length,
          logged: bucketMetricLoggedCount(selectedBucket, drillMetric.key),
        }
      : null

  const values = series.map((b) => {
    const raw = activeMetric.pick(b)
    return activeMetric.chartValue ? activeMetric.chartValue(raw) : raw
  })
  const hasChartData = values.some((v) => v != null && Number.isFinite(v))

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
            <span className="mgmt-modal-summary__val">{fmtMgmtDurationDays(productRow.avgWait)}</span>
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
            <div
              className="mgmt-seg mgmt-product-metric-seg"
              role="group"
              aria-label="Chart metric"
            >
              {CHART_METRICS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={activeMetricKey === m.key ? 'on' : ''}
                  onClick={() => onMetricSwitch(m.key)}
                >
                  {m.title}
                </button>
              ))}
            </div>
            <p className="text-steel mgmt-sub mgmt-product-chart-gran">{chartRangeSub}</p>
            {singleBucketHint}
            <div
              className={`mgmt-product-single-chart v2-weekly__block${chartActiveDrill ? ' mgmt-product-chart-block--drill-source' : ''}`}
            >
              <ChartBlockTitle info={activeMetric.tooltip}>{activeMetric.title}</ChartBlockTitle>
              {!hasChartData ? (
                <p className="text-steel mgmt-sub">No logged data in this period</p>
              ) : (
                <WeeklyLineChart
                  weekLabels={weekLabels}
                  yTitle={activeMetric.yTitle}
                  xAxisTitle={granularity === 'week' ? 'Week' : 'Month'}
                  showXAxisTitle={false}
                  nullGap
                  showPointLabels
                  formatPointLabel={activeMetric.formatPointLabel}
                  onBucketClick={makeBucketClickHandler(activeMetric.key)}
                  ariaLabel={`${activeMetric.title}. ${chartRangeSub}`}
                  weekTooltip={{
                    subtitle: `${activeMetric.title} · ${chartRangeSub}`,
                    placement: 'left',
                    titleForWeek: (i) => formatBucketTooltipTitle(series[i]),
                    itemsForWeek: (i) => weekTooltipItems(activeMetric, i),
                  }}
                  series={[
                    {
                      key: activeMetric.key,
                      color: lineColor,
                      values,
                      pointTitle: (i) =>
                        `${formatBucketTooltipTitle(series[i])}: ${activeMetric.formatValue(activeMetric.pick(series[i]))} · ${series[i].voyageCount} voyages`,
                    },
                  ]}
                />
              )}
            </div>

            {selectedBucket && drillMetric ? (
              <div className="mgmt-product-bucket-drill" data-drill-metric={drillMetric.key}>
                <div className="mgmt-product-bucket-drill__head">
                  <div>
                    <h3 className="mgmt-product-bucket-drill__title">
                      {formatBucketTooltipTitle(selectedBucket)}
                    </h3>
                    <p className="text-steel mgmt-sub mgmt-product-bucket-drill__sub">
                      <span className="mgmt-product-bucket-drill__metric-pill">{drillMetric.title}</span>
                      {' · '}
                      {bucketDrillRows.length} voyage{bucketDrillRows.length === 1 ? '' : 's'} · sailed off
                      bucket
                      {drillBucketCoverage && drillBucketCoverage.total > 0 ? (
                        <>
                          {' · '}
                          {drillBucketCoverage.logged === drillBucketCoverage.total
                            ? `${drillBucketCoverage.logged} with data for chart`
                            : `${drillBucketCoverage.logged} of ${drillBucketCoverage.total} with data for chart`}
                        </>
                      ) : null}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="mgmt-product-bucket-drill__clear"
                    onClick={() => setBucketDrill(null)}
                  >
                    Show all period voyages
                  </button>
                </div>
                <ProductVoyageDetailTable
                  rows={bucketDrillRows}
                  productKey={productRow.key}
                  highlightColumn={highlightColumn}
                  emptyMessage="No voyages in this bucket."
                  opDetailsById={opDetailsById}
                  timelinesByOpId={timelinesByOpId}
                />
              </div>
            ) : null}
          </div>
        ) : (
          <ProductVoyageDetailTable
            rows={tableRows}
            productKey={productRow.key}
            opDetailsById={opDetailsById}
            timelinesByOpId={timelinesByOpId}
          />
        )}

        {flowFooter ? <div className="mgmt-modal-foot">{flowFooter}</div> : null}
      </div>
    </div>
  )
}

