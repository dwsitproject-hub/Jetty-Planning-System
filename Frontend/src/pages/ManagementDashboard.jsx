/**
 * Management Dashboard — Berth Productivity & Departure Readiness.
 * Audience: COO & Business Unit heads. Focus: Loading/Unloading during At-Berth
 * and Ready-to-Sail. Flow KPIs bucket sailed voyages by cast-off date within the
 * selected period (with delta vs the previous equivalent period); pipeline/aging
 * cards are always a live "now" snapshot.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { fetchOperations, fetchSubProcesses, fetchOperationalActivities } from '../api/operations'
import WidgetDetailModal from '../components/WidgetDetailModal'
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
const idleAtBerth = (r) =>
  r.berth != null ? Math.max(r.berth - (r.pre || 0) - (r.opsH || 0) - (r.post || 0), 0) : null
const postH = (r) => (r.post != null && (r.berth == null || r.post <= r.berth) ? r.post : null)

const median = (a) => {
  const s = a.filter((x) => x != null).sort((x, y) => x - y)
  if (!s.length) return null
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

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

/** Normalize an API operation row into the shape the dashboard computes on. */
function toRow(o, detail) {
  const tb = o.tbAt || o.dockingStartTime
  const subs = detail?.subs || []
  const acts = detail?.acts || []
  const phase = (p) => {
    const s = subs.filter((x) => x.phase === p && (x.startAt || x.occurredAt))
    if (!s.length) return null
    const st = Math.min(...s.map((x) => ms(x.startAt || x.occurredAt)).filter(Boolean))
    const en = Math.max(...s.map((x) => ms(x.endAt || x.startAt || x.occurredAt)).filter(Boolean))
    return +(((en - st) / H).toFixed(1))
  }
  const ops = acts.filter((a) => a.milestoneKey === 'cargo_operations' && a.startAt)
  let opsH = null
  if (ops.length) {
    const st = Math.min(...ops.map((a) => ms(a.startAt)))
    const en = Math.max(...ops.map((a) => ms(a.endAt || a.startAt)))
    opsH = +(((en - st) / H).toFixed(1))
  }
  const berth = hrs(tb, o.castOffAt)
  let pre = phase('Pre-Checking')
  if (pre != null && berth != null && pre > berth) pre = null // guard timestamp outliers
  const post = phase('Post-Checking')
  const opsDoneOrCo = ms(o.operationsCompletedAt || o.castOffAt)
  return {
    id: o.id, code: o.jettyOperationCode, vessel: o.vesselName, purpose: o.purpose,
    status: o.status, jetty: o.jettyName,
    commodity: o.commodityShortDisplay || o.commodityDisplay || o.commodity,
    qty: Number(o.cargoSiQty) || 0, pct: o.completionPercent,
    eta: o.eta, ta: o.ta, tb, etc: o.estimatedCompletionTime, opsDone: o.operationsCompletedAt,
    castOff: o.castOffAt, norA: !!o.norAcceptedAt,
    created: o.createdAt,
    wait: hrs(o.ta, tb), berth, pre, post, opsH,
    sign2co: hrs(o.operationsCompletedAt, o.castOffAt),
    late: opsDoneOrCo && ms(o.estimatedCompletionTime) ? +(((opsDoneOrCo - ms(o.estimatedCompletionTime)) / H).toFixed(1)) : null,
    actsCount: acts.length,
  }
}

const dedup = (rs) => {
  const seen = new Set()
  return rs.filter((r) => {
    const k = `${r.vessel}|${r.tb}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function computeFlow(rows) {
  const sailed = rows.filter((r) => r.status === 'SAILED' && r.castOff)
  const dd = dedup(sailed)
  const thr = sailed.reduce((s, r) => s + r.qty, 0)
  const withBoth = dd.filter((r) => r.berth && r.opsH != null)
  return {
    voyages: dd.length,
    throughput: thr,
    berth: median(dd.map((r) => r.berth)),
    wait: median(dd.map((r) => r.wait)),
    eff: withBoth.length
      ? (withBoth.reduce((s, r) => s + r.opsH, 0) / withBoth.reduce((s, r) => s + r.berth, 0)) * 100
      : null,
    onTime: dd.filter((r) => r.late != null).length
      ? (dd.filter((r) => r.late != null && r.late <= 0).length / dd.filter((r) => r.late != null).length) * 100
      : null,
    late: median(dd.map((r) => r.late)),
    sailedRows: dd,
    allSailed: sailed,
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

function lateLabel(late) {
  if (late == null) return '—'
  if (late <= 0) return 'on time'
  return `+${fmt(late / 24, 1)}d`
}

export default function ManagementDashboard() {
  const [ops, setOps] = useState([])
  const [details, setDetails] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [period, setPeriod] = useState('d30')
  const [monthPick, setMonthPick] = useState('') // 'YYYY-MM' — selecting one switches period to 'monthPick'
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('') // both set → period 'custom'
  const [purpose, setPurpose] = useState('All')
  const [openRow, setOpenRow] = useState(null)
  const [activeModal, setActiveModal] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const list = await fetchOperations()
        if (cancelled) return
        const arr = Array.isArray(list) ? list : []
        setOps(arr)
        // fetch phase detail for sailed + live ops (bounded)
        const ids = arr.filter((o) => o.status !== 'PENDING').map((o) => o.id).slice(0, 60)
        const pairs = await Promise.all(
          ids.map(async (id) => {
            const [subs, oa] = await Promise.all([
              fetchSubProcesses(id).catch(() => []),
              fetchOperationalActivities(id).catch(() => ({ entries: [] })),
            ])
            return [id, { subs: subs || [], acts: (oa && oa.entries) || [] }]
          })
        )
        if (!cancelled) setDetails(Object.fromEntries(pairs))
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
    if (!activeModal) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setActiveModal(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeModal])

  const closeModal = useCallback(() => setActiveModal(null), [])

  const rows = useMemo(() => ops.map((o) => toRow(o, details[o.id])), [ops, details])
  const filtered = useMemo(
    () => rows.filter((r) => purpose === 'All' || r.purpose === purpose),
    [rows, purpose]
  )

  const win = useMemo(
    () => periodWindow(period, { month: monthPick, from: rangeFrom, to: rangeTo }),
    [period, monthPick, rangeFrom, rangeTo]
  )
  const inWin = (r, w) => !w || w.start == null || (ms(r.castOff) >= w.start && ms(r.castOff) < w.end)
  const cur = useMemo(() => computeFlow(filtered.filter((r) => inWin(r, win))), [filtered, win])
  const prev = useMemo(
    () => (win.prev ? computeFlow(filtered.filter((r) => inWin(r, win.prev))) : null),
    [filtered, win]
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
    const post = Math.min(avg((r) => r.post), berth || 0)
    const idle = Math.max(berth - pre - opsH - post, 0)
    const segs = [
      { n: 'Anchorage wait (TA→TB)', v: wait, cls: 'wf-wait', getVal: (r) => r.wait },
      { n: 'Pre-checking', v: pre, cls: 'wf-pre', getVal: (r) => r.pre },
      { n: 'Cargo operations', v: opsH, cls: purpose === 'Loading' ? 'wf-load' : purpose === 'Unloading' ? 'wf-disch' : 'wf-ops', getVal: (r) => r.opsH },
      { n: 'Idle / delays at berth', v: idle, cls: 'wf-idle', getVal: idleAtBerth },
      { n: 'Post-checking & sign-off', v: post, cls: 'wf-post', getVal: postH },
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
      .filter((r) => r.opsH)
      .forEach((r) => {
        const k = `${r.vessel}|${r.tb}`
        if (seen[k]) seen[k].q += r.qty
        else {
          seen[k] = {
            _key: k, v: r.vessel, p: r.purpose, q: r.qty, ops: r.opsH,
            jetty: r.jetty, castOff: r.castOff, tb: r.tb,
          }
          rates.push(seen[k])
        }
      })
    rates.forEach((x) => (x.rate = x.ops ? x.q / x.ops : null))
    rates.sort((a, b) => (b.rate || 0) - (a.rate || 0))
    return { jetty, rates, dd }
  }, [cur])

  // Rows relevant to the selected period: sailed within it, or alongside at its end
  const inScope = useMemo(() => {
    const { E } = snap
    return filtered
      .filter((r) => (r.castOff && inWin(r, win)) || atBerthAt(r, E))
      .map((r) => ({ ...r, sailedInPeriod: !!(r.castOff && inWin(r, win)) }))
  }, [filtered, win, snap])

  const tableRows = useMemo(
    () => [...inScope].sort((a, b) => (b.berth || 0) - (a.berth || 0)),
    [inScope]
  )

  const periodLabel = win.label
  const snapLabel = snap.isLive
    ? 'now'
    : new Date(snap.E - 1).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  const flowFooter = `Based on sailed voyages with cast-off in ${periodLabel}`
  const snapFooter = snap.isLive
    ? 'Live pipeline snapshot as of now'
    : `Pipeline reconstructed as of ${snapLabel}`

  const openKpiDetail = useCallback((key) => {
    switch (key) {
      case 'throughput':
        setActiveModal({
          title: 'Cargo throughput',
          subtitle: `${cur.voyages} voyages · ${fmt(Math.round(cur.throughput))} MT total`,
          footer: flowFooter,
          stats: [
            { label: 'Total MT', value: fmt(Math.round(cur.throughput)) },
            { label: 'Voyages', value: String(cur.voyages) },
          ],
          columns: [
            { label: 'Vessel', cell: (r) => r.vessel },
            { label: 'Jetty', cell: (r) => r.jetty || '—' },
            { label: 'Commodity', cell: (r) => r.commodity || '—' },
            { label: 'Qty (MT)', cell: (r) => fmt(r.qty), align: 'right' },
            { label: 'Cast-off', cell: (r) => fmtDate(r.castOff) },
          ],
          rows: [...cur.allSailed].sort((a, b) => b.qty - a.qty),
        })
        break
      case 'berth': {
        const rows = cur.sailedRows.filter((r) => r.berth != null).sort((a, b) => b.berth - a.berth)
        setActiveModal({
          title: 'Median berth time',
          subtitle: `${rows.length} voyages · median ${fmt(cur.berth, 1)} h`,
          footer: flowFooter,
          stats: [
            { label: 'Median', value: `${fmt(cur.berth, 1)} h` },
            { label: 'Voyages', value: String(rows.length) },
          ],
          columns: [
            { label: 'Vessel', cell: (r) => r.vessel },
            { label: 'Jetty', cell: (r) => r.jetty || '—' },
            { label: 'Berth h', cell: (r) => fmt(r.berth, 1), align: 'right' },
            { label: 'Ops h', cell: (r) => fmt(r.opsH, 1), align: 'right' },
            { label: 'Effective %', cell: (r) => (effPct(r) == null ? '—' : `${fmt(effPct(r), 0)}%`), align: 'right' },
            { label: 'Cast-off', cell: (r) => fmtDate(r.castOff) },
          ],
          rows,
        })
        break
      }
      case 'wait': {
        const rows = cur.sailedRows.filter((r) => r.wait != null).sort((a, b) => b.wait - a.wait)
        setActiveModal({
          title: 'Median wait to berth',
          subtitle: `${rows.length} voyages · median ${fmt(cur.wait, 1)} h`,
          footer: flowFooter,
          stats: [
            { label: 'Median', value: `${fmt(cur.wait, 1)} h` },
            { label: 'Voyages', value: String(rows.length) },
          ],
          columns: [
            { label: 'Vessel', cell: (r) => r.vessel },
            { label: 'Jetty', cell: (r) => r.jetty || '—' },
            { label: 'Wait h', cell: (r) => fmt(r.wait, 1), align: 'right' },
            { label: 'TB', cell: (r) => fmtDate(r.tb) },
            { label: 'Cast-off', cell: (r) => fmtDate(r.castOff) },
          ],
          rows,
        })
        break
      }
      case 'eff': {
        const rows = cur.sailedRows
          .filter((r) => r.berth && r.opsH != null)
          .sort((a, b) => (effPct(a) || 0) - (effPct(b) || 0))
        const excluded = cur.sailedRows.length - rows.length
        setActiveModal({
          title: 'Effective ops ratio',
          subtitle: `${rows.length} of ${cur.sailedRows.length} voyages included${excluded ? ` (${excluded} missing cargo-ops window)` : ''}`,
          footer: flowFooter,
          stats: [
            { label: 'Ratio', value: cur.eff == null ? '—' : `${fmt(cur.eff, 0)}%` },
            { label: 'Included', value: String(rows.length) },
          ],
          columns: [
            { label: 'Vessel', cell: (r) => r.vessel },
            { label: 'Berth h', cell: (r) => fmt(r.berth, 1), align: 'right' },
            { label: 'Ops h', cell: (r) => fmt(r.opsH, 1), align: 'right' },
            { label: 'Effective %', cell: (r) => `${fmt(effPct(r), 0)}%`, align: 'right' },
            { label: 'Cast-off', cell: (r) => fmtDate(r.castOff) },
          ],
          rows,
        })
        break
      }
      case 'onTime': {
        const withLate = cur.sailedRows.filter((r) => r.late != null)
        const onTimeN = withLate.filter((r) => r.late <= 0).length
        setActiveModal({
          title: 'On-time vs ETC',
          subtitle: `${onTimeN} of ${withLate.length} voyages on time · ${cur.onTime == null ? '—' : `${fmt(cur.onTime, 0)}%`}`,
          footer: flowFooter,
          stats: [
            { label: 'On-time %', value: cur.onTime == null ? '—' : `${fmt(cur.onTime, 0)}%` },
            { label: 'With ETC', value: String(withLate.length) },
          ],
          columns: [
            { label: 'Vessel', cell: (r) => r.vessel },
            { label: 'ETC', cell: (r) => fmtDate(r.etc) },
            { label: 'Ops done', cell: (r) => fmtDate(r.opsDone) },
            { label: 'vs ETC', cell: (r) => lateLabel(r.late) },
            { label: 'Lateness (h)', cell: (r) => fmt(r.late, 1), align: 'right' },
          ],
          rows: withLate.sort((a, b) => (b.late || 0) - (a.late || 0)),
        })
        break
      }
      case 'late': {
        const withLate = cur.sailedRows.filter((r) => r.late != null)
        setActiveModal({
          title: 'Median lateness',
          subtitle: `${withLate.length} voyages with ETC · median ${cur.late == null ? '—' : `${fmt(cur.late / 24, 1)} days`}`,
          footer: flowFooter,
          stats: [
            { label: 'Median', value: cur.late == null ? '—' : `${fmt(cur.late / 24, 1)} days` },
            { label: 'Voyages', value: String(withLate.length) },
          ],
          columns: [
            { label: 'Vessel', cell: (r) => r.vessel },
            { label: 'Lateness (days)', cell: (r) => fmt(r.late / 24, 1), align: 'right' },
            { label: 'ETC', cell: (r) => fmtDate(r.etc) },
            { label: 'Ops done', cell: (r) => fmtDate(r.opsDone) },
            { label: 'Cast-off', cell: (r) => fmtDate(r.castOff) },
          ],
          rows: withLate.sort((a, b) => (b.late || 0) - (a.late || 0)),
        })
        break
      }
      default:
        break
    }
  }, [cur, flowFooter])

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
        { label: 'Cast-off', cell: (r) => fmtDate(r.castOff) },
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
      keyDateLabel = 'Cast-off'
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
        { label: 'Cast-off', cell: (r) => fmtDate(r.castOff) },
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
        { label: 'Cast-off', cell: () => fmtDate(entry.castOff) },
      ],
      rows: [entry],
    })
  }, [flowFooter])

  const kpiTiles = [
    { key: 'throughput', l: 'Cargo throughput', v: fmt(Math.round(cur.throughput)), u: 'MT', n: `${cur.voyages} voyages sailed`, d: <Delta cur={cur.throughput} prev={prev?.throughput} /> },
    { key: 'berth', l: 'Median berth time', v: fmt(cur.berth, 1), u: 'h', n: 'TB → cast-off', d: <Delta cur={cur.berth} prev={prev?.berth} lowerIsBetter /> },
    { key: 'wait', l: 'Median wait to berth', v: fmt(cur.wait, 1), u: 'h', n: 'TA → TB', d: <Delta cur={cur.wait} prev={prev?.wait} lowerIsBetter /> },
    { key: 'eff', l: 'Effective ops ratio', v: cur.eff == null ? '—' : `${fmt(cur.eff, 0)}%`, u: '', n: 'cargo-ops ÷ berth hours', d: <Delta cur={cur.eff} prev={prev?.eff} />, cls: cur.eff != null && cur.eff < 40 ? 'mgmt-kpi--bad' : '' },
    { key: 'onTime', l: 'On-time vs ETC', v: cur.onTime == null ? '—' : `${fmt(cur.onTime, 0)}%`, u: '', n: 'ops done ≤ estimate', d: <Delta cur={cur.onTime} prev={prev?.onTime} />, cls: cur.onTime === 0 ? 'mgmt-kpi--bad' : '' },
    { key: 'late', l: 'Median lateness', v: cur.late == null ? '—' : fmt(cur.late / 24, 1), u: 'days', n: 'beyond Est. Completion', d: <Delta cur={cur.late} prev={prev?.late} lowerIsBetter />, cls: 'mgmt-kpi--bad' },
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
            Berth productivity &amp; departure readiness · flow KPIs bucketed by <b>cast-off date</b> ({periodLabel}) · pipeline as of <b>{snapLabel}</b>
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
                <div className="mgmt-kpi__note">{t.n}</div>
                {t.d}
              </div>
            ))}
          </div>

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
            <h2 className="card__title">Voyage drill-down</h2>
            <p className="text-steel mgmt-sub">
              Sailed voyages in period + vessels alongside as of {snapLabel} · click a row for its milestone anatomy
            </p>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr>
                  <th>Vessel</th><th>Purpose</th><th>Jetty</th><th>Commodity</th>
                  <th className="mgmt-r">Qty (MT)</th><th className="mgmt-r">Wait h</th><th className="mgmt-r">Berth h</th>
                  <th className="mgmt-r">Ops h</th><th className="mgmt-r">Effective</th><th className="mgmt-r">vs ETC</th><th>Status</th>
                </tr></thead>
                <tbody>
                  {tableRows.map((r) => {
                    const eff = r.berth && r.opsH != null ? (r.opsH / r.berth) * 100 : null
                    const open = openRow === r.id
                    return (
                      <FragmentRow key={r.id} r={r} eff={eff} open={open} onToggle={() => setOpenRow(open ? null : r.id)} />
                    )
                  })}
                </tbody>
              </table>
            </div>
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
              <p className="text-steel mgmt-sub">Moved qty ÷ cargo-operations window · green = Loading, blue = Unloading · click a row for details</p>
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
        </>
      )}
    </div>
  )
}

function FragmentRow({ r, eff, open, onToggle }) {
  const lateChip =
    r.late == null ? <span className="mgmt-chip mgmt-chip--ghost">—</span>
    : r.late <= 0 ? <span className="mgmt-chip mgmt-chip--ok">on time</span>
    : r.late < 72 ? <span className="mgmt-chip mgmt-chip--warn">+{fmt(r.late / 24, 1)}d</span>
    : <span className="mgmt-chip mgmt-chip--late">+{fmt(r.late / 24, 1)}d</span>
  const stLabel = r.status === 'SAILED'
    ? 'At berth' // sailed after the selected period — was still alongside at its end
    : { DOCKED: 'Docked', IN_PROGRESS: 'In progress', SIGNOFF_REQUESTED: 'Sign-off req.', SIGNOFF_APPROVED: 'Ready to sail' }[r.status] || r.status
  const stChip = r.sailedInPeriod
    ? <span className="mgmt-chip mgmt-chip--ghost">Sailed</span>
    : <span className={`mgmt-chip ${r.purpose === 'Loading' ? 'mgmt-chip--load' : 'mgmt-chip--disch'}`}>{stLabel}</span>
  const bars = []
  if (r.wait != null) bars.push(['Anchorage wait', r.wait, 'wf-wait'])
  if (r.pre != null) bars.push(['Pre-checking', r.pre, 'wf-pre'])
  if (r.opsH != null) bars.push(['Cargo operations', r.opsH, r.purpose === 'Loading' ? 'wf-load' : 'wf-disch'])
  if (r.berth != null) bars.push(['Idle at berth', Math.max(r.berth - (r.pre || 0) - (r.opsH || 0) - (r.post || 0), 0), 'wf-idle'])
  if (r.post != null && (r.berth == null || r.post <= r.berth)) bars.push(['Post-checking', r.post, 'wf-post'])
  const mx = Math.max(...bars.map((b) => b[1]), 1)
  const dt = (v) => (v ? String(v).slice(5, 16).replace('T', ' ') : '—')
  return (
    <>
      <tr className="mgmt-vrow" onClick={onToggle}>
        <td><b>{r.vessel}</b><br /><span className="text-steel" style={{ fontSize: 11 }}>{r.code}</span></td>
        <td><span className={`mgmt-chip ${r.purpose === 'Loading' ? 'mgmt-chip--load' : 'mgmt-chip--disch'}`}>{r.purpose === 'Loading' ? 'LOAD' : 'DISCH'}</span></td>
        <td>{r.jetty || '—'}</td><td>{r.commodity || '—'}</td>
        <td className="mgmt-r">{fmt(r.qty)}</td><td className="mgmt-r">{fmt(r.wait, 1)}</td>
        <td className="mgmt-r">{fmt(r.berth, 1)}</td><td className="mgmt-r">{fmt(r.opsH, 1)}</td>
        <td className="mgmt-r">{eff == null ? '—' : (
          <div className="mgmt-mini" title={`Effective ${fmt(eff, 0)}%`}>
            <i className={eff < 30 ? 'mgmt-mini--bad' : eff < 60 ? 'mgmt-mini--warn' : 'mgmt-mini--ok'} style={{ width: `${Math.min(eff, 100)}%` }} />
          </div>
        )}</td>
        <td className="mgmt-r">{lateChip}</td><td>{stChip}</td>
      </tr>
      {open ? (
        <tr className="mgmt-detail"><td colSpan={11}>
          <div className="text-steel" style={{ marginBottom: 6 }}>
            <b>Milestones</b> — ETA {dt(r.eta)} · TA {dt(r.ta)} · TB {dt(r.tb)} · Est. completion {dt(r.etc)} · Ops done {dt(r.opsDone)} · Cast-off {dt(r.castOff)}
            {r.norA ? '' : <b style={{ color: 'var(--color-danger,#B3261E)' }}> · NOR not accepted</b>}
            {r.sign2co ? <b style={{ color: 'var(--color-danger,#B3261E)' }}> · sign-off→cast-off {fmt(r.sign2co / 24, 1)} d</b> : ''}
          </div>
          {bars.map((b) => (
            <div key={b[0]} className="mgmt-tlrow">
              <span className="text-steel">{b[0]}</span>
              <div className="mgmt-tltrack"><div className={`mgmt-tlseg ${b[2]}`} style={{ width: `${Math.max((b[1] / mx) * 100, 1)}%` }} /></div>
              <span className="mgmt-tlval">{fmt(b[1], 1)} h</span>
            </div>
          ))}
          <div className="mgmt-hint">{r.actsCount ? `${r.actsCount} at-berth activity entries captured` : 'No at-berth activity logged yet'}</div>
        </td></tr>
      ) : null}
    </>
  )
}
