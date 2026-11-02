/**
 * Management Dashboard — Berth Productivity & Departure Readiness.
 * Audience: COO & Business Unit heads. Focus: Loading/Unloading during At-Berth
 * and Ready-to-Sail. The four top cards count one commodity shipment per product
 * on a sailed call (sailed-off date is Cast Off, delta vs the previous
 * equivalent period). Cargo throughput sums logged moved tons per commodity.
 * Waterfall, jetty hours, and departure readiness stay one
 * row per vessel call. Pipeline/aging cards are always a live "now" snapshot.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  fetchOperations,
  fetchOperationalActivities,
  fetchActivityTimeline,
  fetchManagementCargoRates,
} from '../api/operations'
import WidgetDetailModal from '../components/WidgetDetailModal'
import FlowPill from '../components/FlowPill'
import ProductDetailModal from '../components/dashboard/ProductDetailModal'
import ThroughputCargoEntries from '../components/dashboard/ThroughputCargoEntries'
import ModalTimeDetail from '../components/dashboard/ModalTimeDetail'
import { computeFlow, dedupSailedRows, voyageFlowRate } from '../utils/managementDashboardFlow'
import { computeCommodityFlow, sliceMovedQty } from '../utils/managementDashboardCommodityFlow'
import { cargoMovementEntriesForSlice } from '../utils/cargoMovementEntries'
import { mergeCargoRatesIntoRow } from '../utils/managementDashboardCargoRate'
import { aggregateByProduct, productSliceFlowRate, voyagesForProduct } from '../utils/managementDashboardProduct'
import {
  cargoDoneToSailDisplayHours,
  cargoDoneToSailFromTimeline,
  idleHoursAtBerth,
} from '../utils/managementDashboardCargoDone'
import {
  cargoOperationWindowStartAt,
  computeBerthToStartCargoHours,
} from '../utils/managementDashboardMetricEvidence.js'
import ManagementProductTable from '../components/dashboard/ManagementProductTable'
import VoyageDrilldownTable from '../components/dashboard/VoyageDrilldownTable'
import '../styles/management-dashboard.css'
import '../styles/modal.css'

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'd30', label: 'Last 30 days' },
  { key: 'ytd', label: 'YTD' },
  { key: 'all', label: 'All data' },
]

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const ms = (v) => (v ? new Date(v).getTime() : null)
const H = 3600000
const hrs = (a, b) => {
  const x = ms(a), y = ms(b)
  return x != null && y != null && y >= x ? +((y - x) / H).toFixed(1) : null
}
const fmt = (n, d = 0) => (n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d }))
const fmtDate = (v) => (v ? String(v).slice(0, 10) : '—')
const effPct = (r) => (r.berth && r.opsH != null ? (r.opsH / r.berth) * 100 : null)

const DAY = 24 * H

/**
 * Resolve the flow window. `opts` carries the month ('YYYY-MM') or custom
 * range ('YYYY-MM-DD' from/to) inputs; prev is the equivalent preceding window.
 */
function periodWindow(key, opts = {}, now = new Date()) {
  const end = now.getTime()
  if (key === 'today') {
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    return { start: s, end, prev: { start: s - DAY, end: s }, label: 'Today', prevLabel: 'yesterday' }
  }
  if (key === 'd30') {
    const s = end - 30 * DAY
    return { start: s, end, prev: { start: s - 30 * DAY, end: s }, label: 'Last 30 days', prevLabel: 'prev 30 days' }
  }
  if (key === 'ytd') {
    const s = new Date(now.getFullYear(), 0, 1).getTime()
    const py = new Date(now.getFullYear() - 1, 0, 1).getTime()
    return { start: s, end, prev: { start: py, end: py + (end - s) }, label: 'YTD', prevLabel: 'same period last year' }
  }
  if (key === 'monthPick' && opts.month) {
    const [y, m] = opts.month.split('-').map(Number)
    if (y && m) {
      const s = new Date(y, m - 1, 1).getTime()
      const e = new Date(y, m, 1).getTime()
      const ps = new Date(y, m - 2, 1).getTime()
      return {
        start: s, end: e, prev: { start: ps, end: s },
        label: `${MONTH_NAMES[m - 1]} ${y}`, prevLabel: 'prev month',
      }
    }
  }
  if (key === 'custom' && opts.from && opts.to) {
    const s = new Date(`${opts.from}T00:00:00`).getTime()
    const e = new Date(`${opts.to}T00:00:00`).getTime() + DAY
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
      const len = e - s
      return {
        start: s, end: e, prev: { start: s - len, end: s },
        label: `${opts.from} → ${opts.to}`, prevLabel: 'preceding equal window',
      }
    }
  }
  return { start: null, end: null, prev: null, label: 'All data', prevLabel: null }
}

const TIMELINE_FETCH_CONCURRENCY = 8

/** @template T @template R @param {T[]} items @param {number} limit @param {(item: T) => Promise<R>} fn */
async function mapPool(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  if (!items.length) return []
  const workers = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}

/** Normalize an API operation row into the shape the dashboard computes on. */
function toRow(o, detail, timelineEvents) {
  const tb = o.tbAt || o.dockingStartTime
  const acts = detail?.acts || []
  const ops = acts.filter((a) => a.milestoneKey === 'cargo_operations' && a.startAt)
  let opsH = null
  if (ops.length) {
    const st = Math.min(...ops.map((a) => ms(a.startAt)))
    const en = Math.max(...ops.map((a) => ms(a.endAt || a.startAt)))
    opsH = +(((en - st) / H).toFixed(1))
  }
  const berth = hrs(tb, o.castOffAt)
  const cargoOpsStartAt = cargoOperationWindowStartAt({ acts })
  let pre = computeBerthToStartCargoHours(tb, cargoOpsStartAt, berth)
  let wait = hrs(o.ta, tb)
  if (wait != null && wait > 8760) wait = null // cap at 1 year — defense against corrupt TA
  const opsDoneOrCo = ms(o.operationsCompletedAt || o.castOffAt)
  return {
    id: o.id, code: o.jettyOperationCode, vessel: o.vesselName, purpose: o.purpose,
    status: o.status, jetty: o.jettyName,
    commodity: o.commodityShortDisplay || o.commodityDisplay || o.commodity,
    totalQtyDisplay: o.totalQtyDisplay || null,
    cargoBreakdownSummary: Array.isArray(o.cargoBreakdownSummary) ? o.cargoBreakdownSummary : [],
    qty: Number(o.cargoSiQty) || 0, pct: o.completionPercent,
    eta: o.eta, ta: o.ta, tb, etc: o.estimatedCompletionTime, opsDone: o.operationsCompletedAt,
    castOff: o.castOffAt, sailedAt: o.sailedAt ?? null, norA: !!o.norAcceptedAt,
    created: o.createdAt,
    wait, berth, pre, opsH,
    cargoDoneToSailH:
      o.status === 'SAILED'
        ? cargoDoneToSailFromTimeline(timelineEvents, o.castOffAt)
        : null,
    late: opsDoneOrCo && ms(o.estimatedCompletionTime) ? +(((opsDoneOrCo - ms(o.estimatedCompletionTime)) / H).toFixed(1)) : null,
    actsCount: acts.length,
  }
}

function Delta({ cur, prev, lowerIsBetter = false, unit = '' }) {
  if (cur == null || prev == null || prev === 0) return <span className="mgmt-delta mgmt-delta--na">vs prev: —</span>
  const pct = ((cur - prev) / Math.abs(prev)) * 100
  const good = lowerIsBetter ? pct < 0 : pct > 0
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '■'
  return (
    <span className={`mgmt-delta ${good ? 'mgmt-delta--good' : 'mgmt-delta--bad'}`}>
      {arrow} {Math.abs(pct).toFixed(0)}%{unit} vs prev
    </span>
  )
}

export default function ManagementDashboard() {
  const [ops, setOps] = useState([])
  const [details, setDetails] = useState({})
  const [timelinesByOpId, setTimelinesByOpId] = useState({})
  const timelinesRef = useRef(timelinesByOpId)
  timelinesRef.current = timelinesByOpId
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [period, setPeriod] = useState('d30')
  const [monthPick, setMonthPick] = useState('') // 'YYYY-MM' — selecting one switches period to 'monthPick'
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('') // both set → period 'custom'
  const [purpose, setPurpose] = useState('All')
  const [activeModal, setActiveModal] = useState(null)
  const [productDetail, setProductDetail] = useState(null)
  const [cargoRatesByOpId, setCargoRatesByOpId] = useState({})

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      setCargoRatesByOpId({})
      try {
        const list = await fetchOperations()
        if (cancelled) return
        const arr = Array.isArray(list) ? list : []
        setOps(arr)
        const sailedForRates = arr.filter((o) => o.status === 'SAILED').map((o) => o.id)
        if (sailedForRates.length) {
          const mergedRates = {}
          const CHUNK = 50
          for (let i = 0; i < sailedForRates.length; i += CHUNK) {
            const chunk = sailedForRates.slice(i, i + CHUNK)
            const rateRes = await fetchManagementCargoRates(chunk).catch(() => ({ rates: {} }))
            if (cancelled) return
            Object.assign(mergedRates, rateRes?.rates || {})
          }
          if (!cancelled) setCargoRatesByOpId(mergedRates)
        }
        // fetch phase detail for sailed + live ops (bounded)
        const ids = arr.filter((o) => o.status !== 'PENDING').map((o) => o.id).slice(0, 60)
        const pairs = await Promise.all(
          ids.map(async (id) => {
            const oa = await fetchOperationalActivities(id).catch(() => ({ entries: [] }))
            return [id, { acts: (oa && oa.entries) || [] }]
          })
        )
        const sailedIds = arr.filter((o) => o.status === 'SAILED').map((o) => o.id)
        const timelinePairs = await mapPool(sailedIds, TIMELINE_FETCH_CONCURRENCY, async (id) => {
          const res = await fetchActivityTimeline(id).catch(() => ({ events: [] }))
          return [id, (res && res.events) || []]
        })
        if (!cancelled) {
          setDetails(Object.fromEntries(pairs))
          setTimelinesByOpId(Object.fromEntries(timelinePairs))
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load operations')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!activeModal && !productDetail) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setActiveModal(null)
        setProductDetail(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeModal, productDetail])

  const closeModal = useCallback(() => setActiveModal(null), [])
  const closeProductDetail = useCallback(() => setProductDetail(null), [])

  const rows = useMemo(
    () =>
      ops.map((o) =>
        mergeCargoRatesIntoRow(toRow(o, details[o.id], timelinesByOpId[o.id]), cargoRatesByOpId)
      ),
    [ops, details, timelinesByOpId, cargoRatesByOpId]
  )
  const filtered = useMemo(
    () => rows.filter((r) => purpose === 'All' || r.purpose === purpose),
    [rows, purpose]
  )

  const win = useMemo(
    () => periodWindow(period, { month: monthPick, from: rangeFrom, to: rangeTo }),
    [period, monthPick, rangeFrom, rangeTo]
  )
  /** Sailed off (Clearance Sailed at) in period — cohort for flow KPIs and By commodity */
  const inWinSailedOff = (r, w) =>
    !w || w.start == null || (ms(r.castOff) >= w.start && ms(r.castOff) < w.end)

  const cur = useMemo(() => computeFlow(filtered.filter((r) => inWinSailedOff(r, win))), [filtered, win])

  const productSailedRows = useMemo(() => {
    const sailed = filtered.filter(
      (r) => r.status === 'SAILED' && r.castOff && inWinSailedOff(r, win)
    )
    return dedupSailedRows(sailed)
  }, [filtered, win])

  const prevProductSailedRows = useMemo(() => {
    if (!win.prev) return []
    const sailed = filtered.filter(
      (r) => r.status === 'SAILED' && r.castOff && inWinSailedOff(r, win.prev)
    )
    return dedupSailedRows(sailed)
  }, [filtered, win])

  const commodityCur = useMemo(
    () => computeCommodityFlow(productSailedRows),
    [productSailedRows]
  )
  const commodityPrev = useMemo(
    () => (win.prev ? computeCommodityFlow(prevProductSailedRows) : null),
    [win, prevProductSailedRows]
  )

  // Snapshot instant: the end of the selected period, capped at now. Windows
  // that include the present behave as a live snapshot.
  const snap = useMemo(() => {
    const nowTs = Date.now()
    // win.end is captured slightly before this runs — treat ends within a
    // minute of now (or in the future) as a live snapshot.
    const isLive = win.end == null || nowTs - win.end < 60000
    return { E: isLive ? nowTs : win.end, isLive }
  }, [win])

  // Vessel state reconstructed as of the snapshot instant (obeys the period)
  const atBerthAt = (r, E) => r.tb && ms(r.tb) <= E && (!r.castOff || ms(r.castOff) > E)
  const live = useMemo(() => {
    const { E } = snap
    const atBerth = filtered.filter((r) => atBerthAt(r, E))
    const aged = atBerth
      .map((r) => ({ ...r, ageDays: +(((E - ms(r.tb)) / DAY).toFixed(1)) }))
      .sort((a, b) => b.ageDays - a.ageDays)
    const scheduledRows = filtered.filter(
      (r) => (!r.created || ms(r.created) <= E) && (!r.ta || ms(r.ta) > E) && (!r.tb || ms(r.tb) > E)
    )
    const opsDoneRows = filtered.filter(
      (r) => r.opsDone && ms(r.opsDone) <= E && (!r.castOff || ms(r.castOff) > E)
    )
    return {
      scheduled: scheduledRows.length,
      scheduledRows,
      atBerth: atBerth.length,
      atBerthRows: atBerth,
      opsDoneNotSailed: opsDoneRows.length,
      opsDoneRows,
      aged,
    }
  }, [filtered, snap])

  // waterfall on current-window sailed voyages
  const wf = useMemo(() => {
    const dd = cur.sailedRows.filter((r) => r.berth)
    const avg = (f) => {
      const a = dd.map(f).filter((x) => x != null)
      return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0
    }
    const wait = avg((r) => r.wait)
    const berth = avg((r) => r.berth)
    const pre = avg((r) => r.pre)
    const opsH = avg((r) => r.opsH)
    const idle = avg(idleHoursAtBerth)
    const cargoDone = avg(cargoDoneToSailDisplayHours)
    const segs = [
      { n: 'Anchorage wait (TA→TB)', v: wait, cls: 'wf-wait', getVal: (r) => r.wait },
      { n: 'Berth → start cargo', v: pre, cls: 'wf-pre', getVal: (r) => r.pre },
      { n: 'Cargo operations', v: opsH, cls: purpose === 'Loading' ? 'wf-load' : purpose === 'Unloading' ? 'wf-disch' : 'wf-ops', getVal: (r) => r.opsH },
      { n: 'Idle / delays at berth', v: idle, cls: 'wf-idle', getVal: idleHoursAtBerth },
      { n: 'Cargo done → sailed off', v: cargoDone, cls: 'wf-post', getVal: cargoDoneToSailDisplayHours },
    ]
    return { segs, total: segs.reduce((s, x) => s + x.v, 0), n: dd.length, opsShare: berth ? (opsH / (wait + berth)) * 100 : null, dd }
  }, [cur, purpose])

  const leagues = useMemo(() => {
    const dd = cur.sailedRows.filter((r) => r.berth)
    const byJ = {}
    dd.forEach((r) => {
      const j = r.jetty || '—'
      byJ[j] = byJ[j] || { h: 0, n: 0 }
      byJ[j].h += r.berth
      byJ[j].n++
    })
    const jetty = Object.entries(byJ).sort((a, b) => b[1].h - a[1].h)
    const seen = {}
    const rates = []
    cur.allSailed
      .filter((r) => voyageFlowRate(r) != null)
      .forEach((r) => {
        const k = `${r.vessel}|${r.tb}`
        const rate = voyageFlowRate(r)
        if (seen[k]) {
          seen[k].q += Number(r.voyageMovedQty) || 0
          seen[k].ops = Math.max(seen[k].ops || 0, r.voyageLoggedHours || 0)
          seen[k].rate = rate
        } else {
          seen[k] = {
            _key: k,
            v: r.vessel,
            p: r.purpose,
            q: Number(r.voyageMovedQty) || 0,
            ops: r.voyageLoggedHours,
            rate,
            jetty: r.jetty,
            sailedAt: r.castOff,
            tb: r.tb,
          }
          rates.push(seen[k])
        }
      })
    rates.sort((a, b) => (b.rate || 0) - (a.rate || 0))
    return { jetty, rates, dd }
  }, [cur])

  // Rows relevant to the selected period: sailed within it, or alongside at its end
  const inScope = useMemo(() => {
    const { E } = snap
    return filtered
      .filter((r) => (r.castOff && inWinSailedOff(r, win)) || atBerthAt(r, E))
      .map((r) => ({ ...r, sailedInPeriod: !!(r.castOff && inWinSailedOff(r, win)) }))
  }, [filtered, win, snap])

  const tableRows = useMemo(
    () => [...inScope].sort((a, b) => (b.berth || 0) - (a.berth || 0)),
    [inScope]
  )

  const periodLabel = win.label
  const snapLabel = snap.isLive
    ? 'now'
    : new Date(snap.E - 1).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  const flowFooter = `Based on sailed voyages with sailed off in ${periodLabel}`
  const commodityFooter = `Based on commodity shipments with sailed off in ${periodLabel}`
  const productFlowFooter = flowFooter
  const productAgg = useMemo(
    () => aggregateByProduct(productSailedRows, { purposeFilter: purpose }),
    [productSailedRows, purpose]
  )
  const showProductIncoming = purpose !== 'Loading'
  const showProductOutgoing = purpose !== 'Unloading'
  const snapFooter = snap.isLive
    ? 'Live pipeline snapshot as of now'
    : `Pipeline reconstructed as of ${snapLabel}`

  const openKpiDetail = useCallback((key) => {
    const commodityCell = (r) => r.productLabel || r.commodity || '—'
    const purposeCell = (r) => (r.purpose ? <FlowPill purpose={r.purpose} size="sm" short /> : '—')
    const timeSort = (v) => (v ? new Date(v).getTime() : null)
    switch (key) {
      case 'throughput':
        setActiveModal({
          title: 'Cargo throughput',
          subtitle: `${commodityCur.shipments} commodity shipments · ${fmt(Math.round(commodityCur.throughput))} MT total`,
          stats: [
            { label: 'Total MT', value: fmt(Math.round(commodityCur.throughput)) },
            { label: 'Loading', value: `${fmt(Math.round(commodityCur.loading.throughput))} MT` },
            { label: 'Unloading', value: `${fmt(Math.round(commodityCur.unloading.throughput))} MT` },
            { label: 'Shipments', value: String(commodityCur.shipments) },
          ],
          sortable: true,
          defaultSort: { key: 'moved', dir: 'desc' },
          expandColumn: 'vessel',
          renderDetail: (r) => (
            <ThroughputCargoEntries entries={cargoMovementEntriesForSlice(timelinesRef.current[r.id], r)} />
          ),
          columns: [
            { key: 'vessel', label: 'Vessel', sortValue: (r) => r.vessel || '', cell: (r) => r.vessel },
            {
              key: 'purpose',
              label: 'Purpose',
              sortValue: (r) => r.purpose || '',
              cell: purposeCell,
            },
            { key: 'jetty', label: 'Jetty', sortValue: (r) => r.jetty || '', cell: (r) => r.jetty || '—' },
            { key: 'commodity', label: 'Commodity', sortValue: (r) => commodityCell(r), cell: commodityCell },
            {
              key: 'moved',
              label: 'Moved (MT)',
              align: 'right',
              sortValue: (r) => sliceMovedQty(r),
              cell: (r) => fmt(sliceMovedQty(r)),
            },
            {
              key: 'sailed',
              label: 'Sailed off',
              sortValue: (r) => (r.castOff ? new Date(r.castOff).getTime() : null),
              cell: (r) => fmtDate(r.castOff),
            },
          ],
          rows: commodityCur.slices,
          footer: `${commodityFooter} · logged cargo movement`,
        })
        break
      case 'berth': {
        const rows = commodityCur.slices.filter((r) => r.berth != null)
        setActiveModal({
          title: 'Median berth time',
          subtitle: `${rows.length} commodity shipments · median ${fmt(commodityCur.berth, 1)} h`,
          footer: commodityFooter,
          sortable: true,
          defaultSort: { key: 'berth', dir: 'desc' },
          expandColumn: 'vessel',
          renderDetail: (r) => (
            <ModalTimeDetail fields={[{ label: 'TB', value: r.tb }, { label: 'Cast off', value: r.castOff }]} />
          ),
          stats: [
            { label: 'Median', value: `${fmt(commodityCur.berth, 1)} h` },
            { label: 'Loading', value: `${fmt(commodityCur.loading.berth, 1)} h` },
            { label: 'Unloading', value: `${fmt(commodityCur.unloading.berth, 1)} h` },
            { label: 'Shipments', value: String(rows.length) },
          ],
          columns: [
            { key: 'vessel', label: 'Vessel', sortValue: (r) => r.vessel || '', cell: (r) => r.vessel },
            { key: 'purpose', label: 'Purpose', sortValue: (r) => r.purpose || '', cell: purposeCell },
            { key: 'jetty', label: 'Jetty', sortValue: (r) => r.jetty || '', cell: (r) => r.jetty || '—' },
            { key: 'commodity', label: 'Commodity', sortValue: commodityCell, cell: commodityCell },
            { key: 'berth', label: 'Berth h', align: 'right', sortValue: (r) => r.berth, cell: (r) => fmt(r.berth, 1) },
            { key: 'ops', label: 'Ops h', align: 'right', sortValue: (r) => r.opsH, cell: (r) => fmt(r.opsH, 1) },
            {
              key: 'effective',
              label: 'Effective %',
              align: 'right',
              sortValue: (r) => effPct(r),
              cell: (r) => (effPct(r) == null ? '—' : `${fmt(effPct(r), 0)}%`),
            },
            { key: 'sailed', label: 'Sailed off', sortValue: (r) => timeSort(r.castOff), cell: (r) => fmtDate(r.castOff) },
          ],
          rows,
        })
        break
      }
      case 'wait': {
        const rows = commodityCur.slices.filter((r) => r.wait != null)
        setActiveModal({
          title: 'Average wait to berth',
          subtitle: `${rows.length} commodity shipments · average ${fmt(commodityCur.wait, 1)} h`,
          footer: commodityFooter,
          sortable: true,
          defaultSort: { key: 'wait', dir: 'desc' },
          expandColumn: 'vessel',
          renderDetail: (r) => (
            <ModalTimeDetail fields={[{ label: 'TA', value: r.ta }, { label: 'TB', value: r.tb }]} />
          ),
          stats: [
            { label: 'Average', value: `${fmt(commodityCur.wait, 1)} h` },
            { label: 'Loading', value: `${fmt(commodityCur.loading.wait, 1)} h` },
            { label: 'Unloading', value: `${fmt(commodityCur.unloading.wait, 1)} h` },
            { label: 'Shipments', value: String(rows.length) },
          ],
          columns: [
            { key: 'vessel', label: 'Vessel', sortValue: (r) => r.vessel || '', cell: (r) => r.vessel },
            { key: 'purpose', label: 'Purpose', sortValue: (r) => r.purpose || '', cell: purposeCell },
            { key: 'jetty', label: 'Jetty', sortValue: (r) => r.jetty || '', cell: (r) => r.jetty || '—' },
            { key: 'commodity', label: 'Commodity', sortValue: commodityCell, cell: commodityCell },
            { key: 'wait', label: 'Wait h', align: 'right', sortValue: (r) => r.wait, cell: (r) => fmt(r.wait, 1) },
            { key: 'tb', label: 'TB', sortValue: (r) => timeSort(r.tb), cell: (r) => fmtDate(r.tb) },
            { key: 'sailed', label: 'Sailed off', sortValue: (r) => timeSort(r.castOff), cell: (r) => fmtDate(r.castOff) },
          ],
          rows,
        })
        break
      }
      case 'rate': {
        const rows = commodityCur.slices
          .map((r) => ({ ...r, rate: productSliceFlowRate(r) }))
          .filter((r) => r.rate != null)
        setActiveModal({
          title: 'Average flow rate',
          subtitle: `${rows.length} commodity shipments · average ${fmt(commodityCur.rate, 1)} MT/h`,
          footer: `${commodityFooter} · moved qty ÷ logged cargo hours (ATG / manual / hybrid)`,
          sortable: true,
          defaultSort: { key: 'rate', dir: 'desc' },
          stats: [
            { label: 'Average', value: `${fmt(commodityCur.rate, 1)} MT/h` },
            { label: 'Loading', value: `${fmt(commodityCur.loading.rate, 1)} MT/h` },
            { label: 'Unloading', value: `${fmt(commodityCur.unloading.rate, 1)} MT/h` },
            { label: 'Shipments', value: String(rows.length) },
          ],
          columns: [
            { key: 'vessel', label: 'Vessel', sortValue: (r) => r.vessel || '', cell: (r) => r.vessel },
            { key: 'purpose', label: 'Purpose', sortValue: (r) => r.purpose || '', cell: purposeCell },
            { key: 'jetty', label: 'Jetty', sortValue: (r) => r.jetty || '', cell: (r) => r.jetty || '—' },
            { key: 'commodity', label: 'Commodity', sortValue: commodityCell, cell: commodityCell },
            {
              key: 'moved',
              label: 'Moved (MT)',
              align: 'right',
              sortValue: (r) => sliceMovedQty(r),
              cell: (r) => fmt(sliceMovedQty(r)),
            },
            {
              key: 'logged',
              label: 'Logged h',
              align: 'right',
              sortValue: (r) => (r.productLoggedHours != null ? Number(r.productLoggedHours) : null),
              cell: (r) => fmt(r.productLoggedHours, 1),
            },
            { key: 'rate', label: 'Rate', align: 'right', sortValue: (r) => r.rate, cell: (r) => `${fmt(r.rate, 0)} MT/h` },
            { key: 'sailed', label: 'Sailed off', sortValue: (r) => timeSort(r.castOff), cell: (r) => fmtDate(r.castOff) },
          ],
          rows,
        })
        break
      }
      default:
        break
    }
  }, [commodityCur, commodityFooter])

  const openProductDetail = useCallback(
    (productRow, context = { view: 'table' }) => {
      const voyages = voyagesForProduct(productSailedRows, productRow.key, productRow.purpose)
      const initialView = context.view === 'chart' ? 'chart' : 'table'
      setProductDetail({
        productRow,
        voyages,
        win: { start: win.start, end: win.end, label: win.label },
        periodLabel,
        flowFooter: productFlowFooter,
        initialView,
        focusMetricKey: context.metricKey ?? null,
        opDetailsById: details,
        timelinesByOpId,
      })
    },
    [productSailedRows, productFlowFooter, win, periodLabel, details, timelinesByOpId]
  )

  const openWfDetail = useCallback((seg) => {
    const rows = wf.dd
      .filter((r) => {
        const v = seg.getVal(r)
        return v != null && v > 0
      })
      .map((r) => ({ ...r, phaseH: seg.getVal(r) }))
      .sort((a, b) => b.phaseH - a.phaseH)
    setActiveModal({
      title: `${seg.n} — avg ${fmt(seg.v, 1)} h`,
      subtitle: `${rows.length} of ${wf.n} voyages with this phase logged`,
      footer: flowFooter,
      stats: [
        { label: 'Average', value: `${fmt(seg.v, 1)} h` },
        { label: 'Voyages', value: String(rows.length) },
      ],
      columns: [
        { label: 'Vessel', cell: (r) => r.vessel },
        { label: 'Phase h', cell: (r) => fmt(r.phaseH, 1), align: 'right' },
        { label: 'Berth h', cell: (r) => fmt(r.berth, 1), align: 'right' },
        { label: 'Wait h', cell: (r) => fmt(r.wait, 1), align: 'right' },
        { label: 'Sailed off', cell: (r) => fmtDate(r.castOff) },
      ],
      rows,
    })
  }, [wf, flowFooter])

  const openDrDetail = useCallback((stageKey, label, count) => {
    let rows = []
    let keyDateLabel = 'Key date'
    let keyDateCell = () => '—'
    if (stageKey === 'scheduled') {
      rows = live.scheduledRows
      keyDateLabel = 'Created'
      keyDateCell = (r) => fmtDate(r.created)
    } else if (stageKey === 'atBerth') {
      rows = live.atBerthRows.map((r) => ({
        ...r,
        ageDays: +(((snap.E - ms(r.tb)) / DAY).toFixed(1)),
      })).sort((a, b) => b.ageDays - a.ageDays)
      keyDateLabel = 'TB'
      keyDateCell = (r) => fmtDate(r.tb)
    } else if (stageKey === 'opsDone') {
      rows = live.opsDoneRows
      keyDateLabel = 'Ops done'
      keyDateCell = (r) => fmtDate(r.opsDone)
    } else if (stageKey === 'sailed') {
      rows = [...cur.sailedRows].sort((a, b) => ms(b.castOff) - ms(a.castOff))
      keyDateLabel = 'Sailed off'
      keyDateCell = (r) => fmtDate(r.castOff)
    }
    const statusCell = (r) => {
      if (stageKey === 'sailed') return 'Sailed'
      if (r.status === 'SAILED') return 'At berth'
      return { DOCKED: 'Docked', IN_PROGRESS: 'In progress', SIGNOFF_REQUESTED: 'Sign-off req.', SIGNOFF_APPROVED: 'Ready to sail' }[r.status] || r.status
    }
    setActiveModal({
      title: `${label} — ${count} vessels`,
      subtitle: snapFooter,
      footer: snapFooter,
      stats: [{ label: 'Count', value: String(count) }],
      columns: [
        { label: 'Vessel', cell: (r) => r.vessel },
        { label: 'Jetty', cell: (r) => r.jetty || '—' },
        { label: 'Purpose', cell: (r) => r.purpose || '—' },
        { label: 'Status', cell: statusCell },
        ...(stageKey === 'atBerth' ? [{ label: 'Age (days)', cell: (r) => fmt(r.ageDays, 1), align: 'right' }] : []),
        { label: keyDateLabel, cell: keyDateCell },
      ],
      rows,
    })
  }, [live, cur, snap, snapFooter])

  const openJettyDetail = useCallback((jettyName, stats) => {
    const rows = leagues.dd
      .filter((r) => (r.jetty || '—') === jettyName)
      .sort((a, b) => b.berth - a.berth)
    setActiveModal({
      title: `${jettyName} — ${fmt(stats.h, 0)} h`,
      subtitle: `${stats.n} voyages · ${fmt(stats.h, 0)} berth-hours total`,
      footer: flowFooter,
      stats: [
        { label: 'Total hours', value: `${fmt(stats.h, 0)} h` },
        { label: 'Voyages', value: String(stats.n) },
      ],
      columns: [
        { label: 'Vessel', cell: (r) => r.vessel },
        { label: 'Berth h', cell: (r) => fmt(r.berth, 1), align: 'right' },
        { label: 'Ops h', cell: (r) => fmt(r.opsH, 1), align: 'right' },
        { label: 'Qty (MT)', cell: (r) => fmt(r.qty), align: 'right' },
        { label: 'Sailed off', cell: (r) => fmtDate(r.castOff) },
      ],
      rows,
    })
  }, [leagues, flowFooter])

  const openRateDetail = useCallback((entry) => {
    setActiveModal({
      title: `${entry.v} — ${fmt(entry.rate, 0)} MT/h`,
      subtitle: `${fmt(entry.q)} MT in ${fmt(entry.ops, 1)} h cargo-operations window`,
      footer: flowFooter,
      stats: [
        { label: 'Rate', value: `${fmt(entry.rate, 0)} MT/h` },
        { label: 'Qty', value: `${fmt(entry.q)} MT` },
        { label: 'Ops window', value: `${fmt(entry.ops, 1)} h` },
      ],
      columns: [
        { label: 'Vessel', cell: () => entry.v },
        { label: 'Purpose', cell: () => entry.p || '—' },
        { label: 'Qty (MT)', cell: () => fmt(entry.q), align: 'right' },
        { label: 'Ops h', cell: () => fmt(entry.ops, 1), align: 'right' },
        { label: 'Rate', cell: () => `${fmt(entry.rate, 0)} MT/h`, align: 'right' },
        { label: 'Sailed off', cell: () => fmtDate(entry.sailedAt) },
      ],
      rows: [entry],
    })
  }, [flowFooter])

  const kpiTiles = [
    {
      key: 'throughput',
      l: 'Cargo throughput',
      v: fmt(Math.round(commodityCur.throughput)),
      u: 'MT',
      split: [
        { k: 'Loading', v: fmt(Math.round(commodityCur.loading.throughput)), u: 'MT' },
        { k: 'Unloading', v: fmt(Math.round(commodityCur.unloading.throughput)), u: 'MT' },
      ],
      n: `${commodityCur.shipments} commodity shipments`,
      d: <Delta cur={commodityCur.throughput} prev={commodityPrev?.throughput} />,
    },
    {
      key: 'berth',
      l: 'Median berth time',
      v: fmt(commodityCur.berth, 1),
      u: 'h',
      split: [
        { k: 'Loading', v: fmt(commodityCur.loading.berth, 1), u: 'h' },
        { k: 'Unloading', v: fmt(commodityCur.unloading.berth, 1), u: 'h' },
      ],
      n: 'TB → cast-off',
      d: <Delta cur={commodityCur.berth} prev={commodityPrev?.berth} lowerIsBetter />,
    },
    {
      key: 'wait',
      l: 'Average wait to berth',
      v: fmt(commodityCur.wait, 1),
      u: 'h',
      split: [
        { k: 'Loading', v: fmt(commodityCur.loading.wait, 1), u: 'h' },
        { k: 'Unloading', v: fmt(commodityCur.unloading.wait, 1), u: 'h' },
      ],
      n: 'TA → TB',
      d: <Delta cur={commodityCur.wait} prev={commodityPrev?.wait} lowerIsBetter />,
    },
    {
      key: 'rate',
      l: 'Average flow rate',
      v: fmt(commodityCur.rate, 1),
      u: 'MT/h',
      split: [
        { k: 'Loading', v: fmt(commodityCur.loading.rate, 1), u: 'MT/h' },
        { k: 'Unloading', v: fmt(commodityCur.unloading.rate, 1), u: 'MT/h' },
      ],
      n: 'moved ÷ logged cargo hours',
      d: <Delta cur={commodityCur.rate} prev={commodityPrev?.rate} />,
    },
  ]

  const drStages = [
    { key: 'scheduled', label: 'Scheduled (no TA)', count: live.scheduled },
    { key: 'atBerth', label: 'At berth', count: live.atBerth },
    { key: 'opsDone', label: 'Ops complete, not sailed', count: live.opsDoneNotSailed },
    { key: 'sailed', label: `Sailed (${periodLabel})`, count: cur.voyages },
  ]

  return (
    <div className="allocation-page mgmt">
      <div className="mgmt-mast">
        <div>
          <h1 className="page-title" style={{ marginBottom: 2 }}>Management Dashboard</h1>
          <p className="allocation-page__intro" style={{ margin: 0 }}>
            Berth productivity &amp; departure readiness · flow KPIs bucketed by <b>sailed off date</b> ({periodLabel}) · pipeline as of <b>{snapLabel}</b>
          </p>
        </div>
        <div className="mgmt-filters">
          <div className="mgmt-seg" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <button key={p.key} className={period === p.key ? 'on' : ''} onClick={() => setPeriod(p.key)}>{p.label}</button>
            ))}
          </div>
          <div className={`mgmt-pick ${period === 'monthPick' ? 'on' : ''}`}>
            <label>Month</label>
            <input
              type="month"
              value={monthPick}
              onChange={(e) => {
                setMonthPick(e.target.value)
                if (e.target.value) setPeriod('monthPick')
              }}
            />
          </div>
          <div className={`mgmt-pick ${period === 'custom' ? 'on' : ''}`}>
            <label>Range</label>
            <input
              type="date"
              value={rangeFrom}
              max={rangeTo || undefined}
              onChange={(e) => {
                setRangeFrom(e.target.value)
                if (e.target.value && rangeTo) setPeriod('custom')
              }}
            />
            <span className="mgmt-pick__sep">→</span>
            <input
              type="date"
              value={rangeTo}
              min={rangeFrom || undefined}
              onChange={(e) => {
                setRangeTo(e.target.value)
                if (rangeFrom && e.target.value) setPeriod('custom')
              }}
            />
          </div>
          <div className="mgmt-seg" role="group" aria-label="Purpose">
            {['All', 'Loading', 'Unloading'].map((p) => (
              <button key={p} className={purpose === p ? 'on' : ''} onClick={() => setPurpose(p)}>{p}</button>
            ))}
          </div>
        </div>
      </div>

      {error ? <p className="allocation-page__intro" role="alert" style={{ color: 'var(--color-danger,#c00)' }}>{error}</p> : null}
      {loading ? <p className="text-steel">Loading operations…</p> : (
        <>
          <div className="mgmt-kpis">
            {kpiTiles.map((t) => (
              <div
                key={t.key}
                className={`card mgmt-kpi mgmt-kpi--clickable ${t.cls || ''}`}
                role="button"
                tabIndex={0}
                onClick={() => openKpiDetail(t.key)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openKpiDetail(t.key) } }}
                aria-label={`${t.l} — click for details`}
              >
                <div className="mgmt-kpi__lbl">{t.l}</div>
                <div className="mgmt-kpi__val">{t.v} <span className="mgmt-kpi__unit">{t.u}</span></div>
                {t.split ? (
                  <div className="mgmt-kpi__split">
                    {t.split.map((s) => (
                      <span key={s.k} className={`mgmt-kpi__split-item mgmt-kpi__split-item--${s.k.toLowerCase()}`}>
                        <span className="mgmt-kpi__split-k">{s.k}</span>
                        <span className="mgmt-kpi__split-v">{s.v === '—' ? '—' : `${s.v} ${s.u}`}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="mgmt-kpi__note">{t.n}</div>
                {t.d}
              </div>
            ))}
          </div>

          <section className="card mgmt-sec">
            <h2 className="card__title">By commodity</h2>
            <ManagementProductTable
              incoming={productAgg.incoming}
              outgoing={productAgg.outgoing}
              showIncoming={showProductIncoming}
              showOutgoing={showProductOutgoing}
              onProductOpen={openProductDetail}
            />
          </section>

          <div className="mgmt-two">
            <section className="card">
              <h2 className="card__title">Where the berth hours go</h2>
              <p className="text-steel mgmt-sub">Average sailed voyage in period ({wf.n} voyages) — anchorage wait, then time alongside · click a segment for details</p>
              {wf.total > 0 ? (
                <>
                  <div className="mgmt-wf">
                    {wf.segs.map((s) => (
                      <span
                        key={s.n}
                        className={s.cls}
                        style={{ width: `${Math.max((s.v / wf.total) * 100, 1.2)}%` }}
                        title={`${s.n}: ${fmt(s.v, 1)} h (${fmt((s.v / wf.total) * 100, 0)}%)`}
                        role="button"
                        tabIndex={0}
                        onClick={() => openWfDetail(s)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWfDetail(s) } }}
                        aria-label={`${s.n} — click for voyage breakdown`}
                      />
                    ))}
                  </div>
                  <div className="mgmt-legend">
                    {wf.segs.map((s) => (
                      <span
                        key={s.n}
                        role="button"
                        tabIndex={0}
                        onClick={() => openWfDetail(s)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWfDetail(s) } }}
                      >
                        <i className={`mgmt-sw ${s.cls}`} />{s.n} · <b>{fmt(s.v, 1)} h</b>
                      </span>
                    ))}
                  </div>
                  <p className="mgmt-hint">
                    Average port stay <b>{fmt(wf.total, 0)} h ({fmt(wf.total / 24, 1)} days)</b> — cargo work is <b>{fmt(wf.opsShare, 0)}%</b> of it.
                  </p>
                </>
              ) : <p className="text-steel">No sailed voyages in this period.</p>}
            </section>

            <section className="card">
              <h2 className="card__title">Departure readiness — {snapLabel}</h2>
              <p className="text-steel mgmt-sub">
                {snap.isLive ? 'Live pipeline snapshot' : 'Pipeline reconstructed as of the end of the selected period'} · click a row for vessel list
              </p>
              {drStages.map(({ key, label, count }) => (
                <div
                  key={key}
                  className="mgmt-frow mgmt-frow--clickable"
                  role="button"
                  tabIndex={0}
                  onClick={() => openDrDetail(key, label, count)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrDetail(key, label, count) } }}
                >
                  <span>{label}</span>
                  <div><div className="mgmt-fbar" style={{ width: `${Math.max((count / Math.max(live.scheduled, live.atBerth, cur.voyages, 1)) * 100, 3)}%` }} /></div>
                  <span className="mgmt-fnum">{count}</span>
                </div>
              ))}
              {live.aged[0] ? (
                <p className="mgmt-hint">
                  Longest alongside: <b>{live.aged[0].vessel}</b> — <b>{live.aged[0].ageDays} days</b> at {live.aged[0].jetty}
                  {live.aged[0].norA ? '' : ', NOR not accepted'}{live.aged[0].opsH == null ? ', cargo ops not started' : ''}.
                </p>
              ) : null}
            </section>
          </div>

          <section className="card mgmt-sec">
            <h2 className="card__title">By Voyage</h2>
            <p className="text-steel mgmt-sub">
              Sailed voyages in period + vessels alongside as of {snapLabel} · click a metric for its calculation
            </p>
            <VoyageDrilldownTable
              rows={tableRows}
              opDetailsById={details}
              timelinesByOpId={timelinesByOpId}
              showIncoming={showProductIncoming}
              showOutgoing={showProductOutgoing}
            />
          </section>

          <div className="mgmt-two mgmt-sec">
            <section className="card">
              <h2 className="card__title">Jetty berth-hours consumed</h2>
              <p className="text-steel mgmt-sub">Sailed voyages in period — asset pressure · click a row for voyage list</p>
              {leagues.jetty.length ? leagues.jetty.map(([j, x]) => {
                const mx = leagues.jetty[0][1].h || 1
                return (
                  <div
                    key={j}
                    className="mgmt-lrow mgmt-lrow--clickable"
                    role="button"
                    tabIndex={0}
                    onClick={() => openJettyDetail(j, x)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openJettyDetail(j, x) } }}
                  >
                    <span>{j} <span className="text-steel">· {x.n} voy</span></span>
                    <div><div className="mgmt-lbar mgmt-lbar--brand" style={{ width: `${(x.h / mx) * 100}%` }} title={`${j}: ${fmt(x.h, 0)} h`} /></div>
                    <span className="mgmt-lval">{fmt(x.h, 0)} h</span>
                  </div>
                )
              }) : <p className="text-steel">No data in period.</p>}
            </section>
            <section className="card">
              <h2 className="card__title">Achieved cargo rate (MT/hour)</h2>
              <p className="text-steel mgmt-sub">Moved qty ÷ logged cargo hours (Ops Live) · green = Loading, blue = Unloading · click a row for details</p>
              {leagues.rates.length ? leagues.rates.map((x) => {
                const mx = leagues.rates[0].rate || 1
                return (
                  <div
                    key={x._key}
                    className="mgmt-lrow mgmt-lrow--clickable"
                    role="button"
                    tabIndex={0}
                    onClick={() => openRateDetail(x)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRateDetail(x) } }}
                  >
                    <span>{x.v}</span>
                    <div><div className={`mgmt-lbar ${x.p === 'Loading' ? 'wf-load' : 'wf-disch'}`} style={{ width: `${Math.max((x.rate / mx) * 100, 1.5)}%` }} title={`${x.v}: ${fmt(x.q)} MT in ${fmt(x.ops, 1)} h`} /></div>
                    <span className="mgmt-lval">{fmt(x.rate, 0)} MT/h</span>
                  </div>
                )
              }) : <p className="text-steel">No cargo-operation windows logged in period.</p>}
            </section>
          </div>

          <WidgetDetailModal modal={activeModal} onClose={closeModal} />
          <ProductDetailModal detail={productDetail} onClose={closeProductDetail} />
        </>
      )}
    </div>
  )
}
