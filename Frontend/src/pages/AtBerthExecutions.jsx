import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { fetchAllocationOverview } from '../api/allocation'
import { setOperationShiftingOut } from '../api/operations'
import { term } from '../i18n/term'
import SiDetailModal from '../components/SiDetailModal'
import SiDocumentModal from '../components/SiDocumentModal'
import VesselInfoModal, { VesselNameButton } from '../components/VesselInfoModal'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import { atBerthExecutionOpenPath } from '../utils/atBerthOpenPath'
import { renderCommodityQtyCell } from '../utils/siCargoTableDisplay'
import EtcBreachBadge from '../components/EtcBreachBadge'
import { getEtcBreach } from '../utils/etcBreach'
import '../styles/etc-breach.css'
import '../styles/allocation.css'
import '../styles/modal.css'
import { MAX_REMARK_CHARS } from '../constants/inputLimits'

/** Summary cards only — Ready to Sail / Signed off are tracked under Clearance, not here. */
const AT_BERTH_SUMMARY_PHASES = ['Pre-Checking', 'Operational', 'Post-Checking']
const PHASE_EMOJI = {
  'Pre-Checking': '📋',
  Operational: '⚙️',
  'Post-Checking': '✅',
}

const PURPOSES = [{ key: 'Loading' }, { key: 'Unloading' }]

const FILTER_OPTIONS = [{ value: 'All' }, { value: 'Loading' }, { value: 'Unloading' }]

/** Same rule as Allocation "Incoming vessel & berthing plan" status filter. */
function getBerthingPlanStatus(row) {
  if (row?.shiftingOut) return 'incoming'
  const hasTb = Boolean(row?.tbDateTime)
  const opStatus = String(row?.status || '').toUpperCase()
  if (
    hasTb ||
    opStatus === 'DOCKED' ||
    opStatus === 'IN_PROGRESS' ||
    opStatus === 'POST_OPS' ||
    opStatus === 'SIGNOFF_REQUESTED' ||
    opStatus === 'SIGNOFF_APPROVED'
  ) {
    return 'berthed'
  }
  return 'incoming'
}

function statusToPhase(status) {
  const s = String(status || '')
  if (s === 'IN_PROGRESS') return 'Operational'
  if (s === 'POST_OPS') return 'Post-Checking'
  if (s === 'SIGNOFF_REQUESTED') return 'Ready to Sail'
  if (s === 'SIGNOFF_APPROVED') return 'Signed off'
  return 'Pre-Checking'
}

/** Buckets for summary cards (excludes sign-off states — those belong to Clearance). */
function phaseForAtBerthSummaryCard(status) {
  const s = String(status || '')
  if (s === 'SIGNOFF_REQUESTED' || s === 'SIGNOFF_APPROVED') return null
  if (s === 'IN_PROGRESS') return 'Operational'
  if (s === 'POST_OPS') return 'Post-Checking'
  return 'Pre-Checking'
}

function parseDateMs(val) {
  if (!val) return null
  const t = new Date(val).getTime()
  return Number.isNaN(t) ? null : t
}

/** Group key: shared shipment plan, or one row per operation when no plan. */
function atBerthGroupKey(row) {
  const pid = Number(row?.shipmentPlanId)
  if (Number.isFinite(pid) && pid > 0) return `p-${pid}`
  return `o-${row?.operationId ?? row?.id ?? 'unknown'}`
}

function minDateMs(rows, pick) {
  let best = null
  for (const r of rows) {
    const ms = parseDateMs(pick(r))
    if (ms == null) continue
    best = best == null ? ms : Math.min(best, ms)
  }
  return best
}

function buildAtBerthGroups(sortedRows, t, nowMs = Date.now()) {
  const order = []
  const map = new Map()
  for (const r of sortedRows) {
    const key = atBerthGroupKey(r)
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key).push(r)
  }
  return order.map((key) => {
    const bucket = map.get(key)
    const children = [...bucket].sort((a, b) => {
      const ta = parseDateMs(a.tbDateTime) ?? 0
      const tb = parseDateMs(b.tbDateTime) ?? 0
      if (ta !== tb) return ta - tb
      return (Number(a.operationId) || 0) - (Number(b.operationId) || 0)
    })
    const shiftRow = children[0]
    const purposes = new Set(children.map((c) => c.purpose).filter(Boolean))
    const totalQtyValues = new Set(children.map((c) => c.totalQtyDisplay).filter(Boolean))
    const statuses = new Set(children.map((c) => c.status).filter(Boolean))
    const phases = new Set(children.map((c) => statusToPhase(c.status)))
    const minTaMs = minDateMs(children, (x) => x.taDateTime)
    const minTbMs = minDateMs(children, (x) => x.tbDateTime)
    const minTaIso = minTaMs != null ? new Date(minTaMs).toISOString() : null
    const minTbIso = minTbMs != null ? new Date(minTbMs).toISOString() : null
    const childBreaches = children.map((c) => getEtcBreach(c, nowMs)).filter(Boolean)
    const maxBreach =
      childBreaches.length > 0
        ? childBreaches.reduce((best, b) => (b.overMs > best.overMs ? b : best), childBreaches[0])
        : null
    const etcSource = shiftRow.estimatedCompletionDateTime || shiftRow.estimationOfCompletion
    return {
      key,
      children,
      shiftRow,
      siCount: children.length,
      vesselName: shiftRow.vesselName || '—',
      planReference: shiftRow.planReference || null,
      jetty: shiftRow.jetty || '—',
      purposeDisplay:
        purposes.size === 0 ? (
          '—'
        ) : purposes.size === 1 ? (
          <span className="loading-list__badge loading-list__badge--purpose" data-purpose={[...purposes][0]}>
            {[...purposes][0]}
          </span>
        ) : (
          t('groupMixed')
        ),
      totalQtyDisplay:
        totalQtyValues.size === 0
          ? '—'
          : totalQtyValues.size === 1
            ? [...totalQtyValues][0] || '—'
            : t('groupMixed'),
      phaseDisplay: phases.size <= 1 ? [...phases][0] || '—' : t('groupMixed'),
      statusDisplay: statuses.size <= 1 ? [...statuses][0] || '—' : t('groupMixed'),
      taDisplay: formatDateTimeDisplay(minTaIso),
      tbDisplay: formatDateTimeDisplay(minTbIso),
      etcDisplay: formatDateTimeDisplay(etcSource),
      maxBreach,
      shiftingOut: Boolean(shiftRow.shiftingOut),
    }
  })
}

function createAtBerthColumns(nowMs) {
  return [
  {
    key: 'vesselName',
    label: 'Vessel',
    getValue: (r) => <strong>{r.vesselName || '—'}</strong>,
    getSortValue: (r) => (r.vesselName || '').toLowerCase(),
    getFilterValue: (r) => r.vesselName,
  },
  {
    key: 'jettyOperationCode',
    label: 'Jetty Operation ID',
    getValue: (r) => r.jettyOperationCode || '—',
    getSortValue: (r) => (r.jettyOperationCode || '').toLowerCase(),
    getFilterValue: (r) => r.jettyOperationCode,
  },
  {
    key: 'shippingInstruction',
    label: 'SI',
    getValue: (r) => r.shippingInstruction || '—',
    getSortValue: (r) => (r.shippingInstruction || '').toLowerCase(),
    getFilterValue: (r) => r.shippingInstruction,
  },
  {
    key: 'commodityQty',
    label: 'Commodity Qty',
    getValue: (r) => r.totalQtyDisplay || '—',
    getSortValue: (r) => (r.totalQtyDisplay || '').toLowerCase(),
    getFilterValue: (r) => r.totalQtyDisplay || '',
  },
  {
    key: 'purpose',
    label: 'Purpose',
    getValue: (r) => (
      <span className="loading-list__badge loading-list__badge--purpose" data-purpose={r.purpose}>
        {r.purpose || '—'}
      </span>
    ),
    getSortValue: (r) => (r.purpose || '').toLowerCase(),
    getFilterValue: (r) => r.purpose,
  },
  {
    key: 'jetty',
    label: 'Jetty',
    getValue: (r) => r.jetty || '—',
    getSortValue: (r) => (r.jetty || '').toLowerCase(),
    getFilterValue: (r) => r.jetty,
  },
  {
    key: 'ta',
    label: 'TA',
    getValue: (r) => formatDateTimeDisplay(r.taDateTime),
    getSortValue: (r) => parseDateMs(r.taDateTime) ?? 0,
    getFilterValue: (r) => `${r.taDateTime || ''} ${formatDateTimeDisplay(r.taDateTime)}`,
  },
  {
    key: 'tb',
    label: 'TB',
    getValue: (r) => formatDateTimeDisplay(r.tbDateTime),
    getSortValue: (r) => parseDateMs(r.tbDateTime) ?? 0,
    getFilterValue: (r) => `${r.tbDateTime || ''} ${formatDateTimeDisplay(r.tbDateTime)}`,
  },
  {
    key: 'etc',
    label: 'ETC',
    getValue: (r) => {
      const breach = getEtcBreach(r, nowMs)
      return (
        <span className="at-berth-etc-cell">
          {formatDateTimeDisplay(r.estimatedCompletionDateTime || r.estimationOfCompletion)}
          {breach ? (
            <span className="at-berth-etc-cell__badge">
              <EtcBreachBadge overMs={breach.overMs} etcMs={breach.etcMs} size="sm" />
            </span>
          ) : null}
        </span>
      )
    },
    getSortValue: (r) => getEtcBreach(r, nowMs)?.overMs ?? 0,
    getFilterValue: (r) =>
      `${r.estimatedCompletionDateTime || r.estimationOfCompletion || ''} ${formatDateTimeDisplay(r.estimatedCompletionDateTime || r.estimationOfCompletion)}`,
  },
  {
    key: 'phaseLabel',
    label: 'Phase',
    getValue: (r) => statusToPhase(r.status),
    getSortValue: (r) => statusToPhase(r.status).toLowerCase(),
    getFilterValue: (r) => statusToPhase(r.status),
  },
  {
    key: 'status',
    label: 'Status',
    getValue: (r) => r.status || '—',
    getSortValue: (r) => (r.status || '').toLowerCase(),
    getFilterValue: (r) => r.status,
  },
]
}

function AtBerthDetailPanel({ r, onOpenSiDetail, nowMs = Date.now() }) {
  const { t } = useTranslation('atBerth')
  const breach = getEtcBreach(r, nowMs)
  const purposeDisplay =
    r.purpose ||
    (r.loadDischarge === 'LOAD' ? 'Loading' : r.loadDischarge === 'DISCH' ? 'Unloading' : r.loadDischarge) ||
    '—'

  return (
    <div className="allocation-detail">
      <h4 className="allocation-detail__title">{t('detailTitle')}</h4>
      <dl className="allocation-detail__grid">
        <dt>{t('dtVesselName')}</dt>
        <dd>{r.vesselName || '—'}</dd>
        <dt>{t('dtJettyOperationId')}</dt>
        <dd>
          {r.shippingInstructionId && onOpenSiDetail ? (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                onOpenSiDetail(r.shippingInstructionId)
              }}
              aria-label={t('openSiDetailFromJettyOp')}
            >
              {r.jettyOperationCode || '—'}
            </a>
          ) : (
            r.jettyOperationCode || '—'
          )}
        </dd>
        <dt>{t('dtShippingInstruction')}</dt>
        <dd>{r.shippingInstruction || '—'}</dd>
        <dt>{t('dtNoPkk')}</dt>
        <dd>{r.noPkk ?? '—'}</dd>
        <dt>{t('dtPriority')}</dt>
        <dd>{r.priority || '—'}</dd>
        <dt>{t('dtNumberOfPalka')}</dt>
        <dd>{r.numberOfPalka ?? '—'}</dd>
        <dt>{t('dtPurpose')}</dt>
        <dd>{purposeDisplay}</dd>
        <dt>{t('dtShipper')}</dt>
        <dd>{r.shipper || '—'}</dd>
        <dt>{t('dtAgent')}</dt>
        <dd>{r.agent || '—'}</dd>
        <dt>{t('dtSurveyor')}</dt>
        <dd>{r.surveyor || '—'}</dd>
        <dt>{t('dtJetty')}</dt>
        <dd>{r.jetty || '—'}</dd>
        <dt>{t('dtEta')}</dt>
        <dd>{formatDateTimeDisplay(r.etaDateTime || r.eta)}</dd>
        <dt>{t('dtTa')}</dt>
        <dd>{formatDateTimeDisplay(r.taDateTime)}</dd>
        <dt>{t('dtEtb')}</dt>
        <dd>{formatDateTimeDisplay(r.etbDateTime || r.etb)}</dd>
        <dt>{t('dtTb')}</dt>
        <dd>{formatDateTimeDisplay(r.tbDateTime)}</dd>
        <dt>{t('dtEstimatedCompletion')}</dt>
        <dd className={breach ? 'allocation-detail__dd--etc-breach' : undefined}>
          {formatDateTimeDisplay(r.estimatedCompletionDateTime || r.estimationOfCompletion)}
          {breach ? (
            <EtcBreachBadge overMs={breach.overMs} etcMs={breach.etcMs} size="sm" />
          ) : null}
        </dd>
        <dt>{t('dtRemark')}</dt>
        <dd>{r.remark || r.remarks || '—'}</dd>
      </dl>
    </div>
  )
}

export default function AtBerthExecutions() {
  const { t } = useTranslation('atBerth')
  const { t: tPages } = useTranslation('pages')
  const labelByPurpose = useMemo(
    () => ({
      Loading: t('purposeLoading'),
      Unloading: t('purposeUnloading'),
    }),
    [t]
  )
  const [queue, setQueue] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [purposeFilter, setPurposeFilter] = useState('All')
  const [overdueOnlyFilter, setOverdueOnlyFilter] = useState(false)
  const [breachNowMs, setBreachNowMs] = useState(() => Date.now())
  const atBerthColumns = useMemo(() => createAtBerthColumns(breachNowMs), [breachNowMs])
  const filterKeys = atBerthColumns.map((c) => c.key)
  const [filters, setFilters] = useState(() =>
    Object.fromEntries(createAtBerthColumns().map((c) => [c.key, '']))
  )
  const [sortState, setSortState] = useState({ key: 'vesselName', dir: 'asc' })
  const [expandedGroupKey, setExpandedGroupKey] = useState(null)
  const [expandedDetailRowId, setExpandedDetailRowId] = useState(null)
  const [expandedMobileGroupKey, setExpandedMobileGroupKey] = useState(null)
  const [expandedMobileDetailId, setExpandedMobileDetailId] = useState(null)
  const [siDetailId, setSiDetailId] = useState(null)
  const [siDocumentModalId, setSiDocumentModalId] = useState(null)
  const [vesselInfoPlanId, setVesselInfoPlanId] = useState(null)

  const openSiDocumentModal = useCallback((id) => {
    setSiDetailId(null)
    setSiDocumentModalId(id)
  }, [])
  const openSiDetailModal = useCallback((id) => {
    setSiDocumentModalId(null)
    setSiDetailId(id)
  }, [])
  const [shiftSavingByOpId, setShiftSavingByOpId] = useState({})
  const [shiftModal, setShiftModal] = useState(null)
  const [shiftRemarkDraft, setShiftRemarkDraft] = useState('')
  const [shiftOutToastMessage, setShiftOutToastMessage] = useState(null)
  const colLabel = useCallback(
    (key, fallback) =>
      t(
        ({
          vesselName: 'colVessel',
          jettyOperationCode: 'colJettyOperationId',
          shippingInstruction: 'colSi',
          commodityQty: 'colCommodityQty',
          purpose: 'colPurpose',
          jetty: 'colJetty',
          ta: 'colTa',
          tb: 'colTb',
          etc: 'colEtc',
          phaseLabel: 'colPhase',
          status: 'colStatus',
        })[key] || '',
        { defaultValue: fallback }
      ),
    [t]
  )

  useEffect(() => {
    const id = setInterval(() => setBreachNowMs(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!shiftOutToastMessage) return undefined
    const t = window.setTimeout(() => setShiftOutToastMessage(null), 7500)
    return () => clearTimeout(t)
  }, [shiftOutToastMessage])

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const data = await fetchAllocationOverview()
      setQueue(Array.isArray(data?.queue) ? data.queue : [])
    } catch (e) {
      setErr(e?.message || t('loading'))
      setQueue([])
    } finally {
      setLoading(false)
    }
  }, [t])

  const closeShiftModal = useCallback(() => {
    setShiftModal(null)
    setShiftRemarkDraft('')
  }, [])

  const confirmShiftOut = useCallback(async () => {
    const shiftRow = shiftModal?.shiftRow
    const opId = shiftRow?.operationId
    if (!opId) return
    const trimmed = shiftRemarkDraft.trim()
    if (!trimmed) {
      setErr(t('errRemarkRequired'))
      return
    }
    setErr(null)
    setShiftSavingByOpId((m) => ({ ...m, [opId]: true }))
    try {
      await setOperationShiftingOut(opId, true, trimmed, { activityLogPage: 'at-berth' })
      const vesselLabel = shiftRow.vesselName || shiftRow.shippingInstruction || t('colVessel')
      setShiftOutToastMessage(
        t('shiftOutToast', { vessel: vesselLabel })
      )
      closeShiftModal()
      await load()
    } catch (err) {
      setErr(err?.message || t('confirmShiftOut'))
    } finally {
      setShiftSavingByOpId((m) => ({ ...m, [opId]: false }))
    }
  }, [shiftModal, shiftRemarkDraft, load, closeShiftModal, t])

  const openShiftOutModal = useCallback((shiftRow, children) => {
    setErr(null)
    setShiftModal({ shiftRow, children: children ?? [shiftRow] })
    setShiftRemarkDraft(String(shiftRow.remark ?? shiftRow.remarks ?? ''))
  }, [])

  const handleShiftOutClick = useCallback(
    async (shiftRow, children, e) => {
      e?.stopPropagation?.()
      const opId = shiftRow?.operationId
      if (!opId) return
      if (!shiftRow.shiftingOut) {
        openShiftOutModal(shiftRow, children)
        return
      }
      setShiftSavingByOpId((m) => ({ ...m, [opId]: true }))
      try {
        await setOperationShiftingOut(opId, false)
        await load()
      } catch (err) {
        setErr(err?.message || t('confirmShiftOut'))
      } finally {
        setShiftSavingByOpId((m) => ({ ...m, [opId]: false }))
      }
    },
    [load, t, openShiftOutModal]
  )

  useEffect(() => {
    load()
  }, [load])

  /** Same queue rows as Allocation; only berthed vessels with an operation. */
  const rows = useMemo(() => {
    return queue.filter((r) => r.operationId != null && getBerthingPlanStatus(r) === 'berthed')
  }, [queue])

  const emptyCounts = () =>
    AT_BERTH_SUMMARY_PHASES.reduce((acc, ph) => {
      acc[ph] = 0
      return acc
    }, {})
  const counts = {
    Loading: emptyCounts(),
    Unloading: emptyCounts(),
  }
  rows.forEach((v) => {
    const phase = phaseForAtBerthSummaryCard(v.status)
    if (phase && counts[v.purpose]) counts[v.purpose][phase] += 1
  })

  const overdueByPurposePhase = useMemo(() => {
    const out = {
      Loading: AT_BERTH_SUMMARY_PHASES.reduce((acc, ph) => ({ ...acc, [ph]: 0 }), {}),
      Unloading: AT_BERTH_SUMMARY_PHASES.reduce((acc, ph) => ({ ...acc, [ph]: 0 }), {}),
    }
    for (const r of rows) {
      if (!getEtcBreach(r, breachNowMs)) continue
      const phase = phaseForAtBerthSummaryCard(r.status)
      if (phase && out[r.purpose]) out[r.purpose][phase] += 1
    }
    return out
  }, [rows, breachNowMs])

  const byPurpose = purposeFilter === 'All' ? rows : rows.filter((v) => v.purpose === purposeFilter)
  const updateFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }))
  const handleSort = (key) => setSortState((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))

  const filteredVessels = byPurpose.filter((r) => {
    if (overdueOnlyFilter && !getEtcBreach(r, breachNowMs)) return false
    return filterKeys.every((key) => {
      const f = (filters[key] || '').trim().toLowerCase()
      if (!f) return true
      const col = atBerthColumns.find((c) => c.key === key)
      const raw = col?.getFilterValue ? col.getFilterValue(r) : r[key]
      return String(raw ?? '').toLowerCase().includes(f)
    })
  })

  const sortedVessels = [...filteredVessels].sort((a, b) => {
    const col = atBerthColumns.find((c) => c.key === sortState.key)
    if (!col) return 0
    const va = col.getSortValue(a)
    const vb = col.getSortValue(b)
    let cmp
    if (typeof va === 'number' && typeof vb === 'number') {
      cmp = va - vb
    } else {
      cmp = String(va).localeCompare(String(vb), undefined, { numeric: true })
    }
    if (cmp !== 0) return sortState.dir === 'asc' ? cmp : -cmp
    const pa = Number(a.shipmentPlanId) || 0
    const pb = Number(b.shipmentPlanId) || 0
    if (pa !== pb) return pa - pb
    const ta = parseDateMs(a.tbDateTime) ?? 0
    const tb = parseDateMs(b.tbDateTime) ?? 0
    return ta - tb
  })

  const vesselGroups = useMemo(
    () => buildAtBerthGroups(sortedVessels, t, breachNowMs),
    [sortedVessels, t, breachNowMs]
  )

  useEffect(() => {
    setExpandedDetailRowId(null)
  }, [expandedGroupKey])

  const tableColSpan = atBerthColumns.length + 2

  return (
    <div className="allocation-page at-berth-page">
      {shiftOutToastMessage ? (
        <div
          className="toast toast--success"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="toast__icon" aria-hidden>
            ✓
          </span>
          <p className="toast__message">{shiftOutToastMessage}</p>
          <button
            type="button"
            className="toast__close"
            onClick={() => setShiftOutToastMessage(null)}
            aria-label={t('dismissNotification')}
          >
            ×
          </button>
        </div>
      ) : null}
      <h1 className="page-title">{tPages('atBerth')}</h1>
      {err && <p style={{ color: '#c00' }}>{err}</p>}

      <section className="at-berth-summary" aria-label={t('summaryAria')}>
        <div className="at-berth-summary__groups">
          {PURPOSES.map(({ key: purpose }) => (
            <div key={purpose} className="at-berth-summary__group">
              <h3 className="at-berth-summary__group-title">{labelByPurpose[purpose] || purpose}</h3>
              <div className="at-berth-summary__grid">
                {AT_BERTH_SUMMARY_PHASES.map((phase) => (
                  <div
                    key={phase}
                    className={`at-berth-card at-berth-card--${purpose.toLowerCase()}`}
                  >
                    <h4 className="at-berth-card__title">
                      {PHASE_EMOJI[phase]} {t(`phase${phase.replace('-', '')}`)}
                    </h4>
                    <p className="at-berth-card__count" aria-label={`${labelByPurpose[purpose] || purpose} ${t(`phase${phase.replace('-', '')}`)} count`}>
                      {counts[purpose][phase]}
                      {phase === 'Operational' && overdueByPurposePhase[purpose][phase] > 0 ? (
                        <span className="at-berth-summary-card__overdue-chip">
                          {t('overdueCount', { count: overdueByPurposePhase[purpose][phase] })}
                        </span>
                      ) : null}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card at-berth-list-section">
        <div className="at-berth-list-section__header">
          <h2 className="card__title">{t('vesselsTitle')}</h2>
          <div className="allocation-tabs at-berth-filter" role="tablist">
            {FILTER_OPTIONS.map(({ value }) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={purposeFilter === value}
                className={`allocation-tabs__tab ${purposeFilter === value ? 'allocation-tabs__tab--active' : ''}`}
                onClick={() => setPurposeFilter(value)}
              >
                {value === 'All' ? t('filterAll') : labelByPurpose[value] || value}
              </button>
            ))}
            <label className="allocation-plan-status-filter__option at-berth-overdue-filter">
              <input
                type="checkbox"
                checked={overdueOnlyFilter}
                onChange={(e) => setOverdueOnlyFilter(e.target.checked)}
              />
              {t('filterOverdueOnly')}
            </label>
          </div>
        </div>
        {loading ? (
          <p className="text-steel">{t('loading')}</p>
        ) : rows.length === 0 ? (
          <p className="text-steel">{t('emptyNoOps')}</p>
        ) : vesselGroups.length === 0 ? (
          <p className="text-steel">{t('emptyNoFilterMatch')}</p>
        ) : (
          <>
          <div className="table-wrap allocation-table-desktop">
            <table className="data-table allocation-table">
              <thead>
                <tr>
                  <th className="allocation-table__expand-col" aria-label={t('expandRow')} />
                  <th className="allocation-table__action-col">{t('action')}</th>
                  {atBerthColumns.map((col) => (
                    <th key={col.key} className="allocation-table__th">
                      <button
                        type="button"
                        className="allocation-table__sort"
                        onClick={() => handleSort(col.key)}
                        title={t('sortBy', { label: colLabel(col.key, col.label) })}
                      >
                        {colLabel(col.key, col.label)}
                        <span className="allocation-table__sort-icon">
                          {sortState.key === col.key ? (sortState.dir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
                <tr className="allocation-table__filter-row">
                  <th className="allocation-table__expand-col" />
                  <th className="allocation-table__action-col" />
                  {atBerthColumns.map((col) => (
                    <th key={col.key}>
                      <input
                        type="text"
                        className="allocation-table__filter"
                        placeholder={t('filterPlaceholder', { label: colLabel(col.key, col.label) })}
                        value={filters[col.key]}
                        onChange={(e) => updateFilter(col.key, e.target.value)}
                        aria-label={t('filterBy', { label: colLabel(col.key, col.label) })}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vesselGroups.map((g) => {
                  const opId = g.shiftRow?.operationId
                  if (g.siCount <= 1) {
                    const r = g.shiftRow
                    const rowBreach = getEtcBreach(r, breachNowMs)
                    return (
                      <Fragment key={g.key}>
                        <tr
                          className={`allocation-table__row ${expandedDetailRowId === r.id ? 'allocation-table__row--expanded' : ''}${rowBreach ? ' allocation-table__row--etc-breach' : ''}`}
                          onClick={() => setExpandedDetailRowId((id) => (id === r.id ? null : r.id))}
                        >
                          <td className="allocation-table__expand-col">
                            <span className="allocation-table__expand-icon" aria-hidden>
                              {expandedDetailRowId === r.id ? '▼' : '▶'}
                            </span>
                          </td>
                          <td className="allocation-table__action-col" onClick={(e) => e.stopPropagation()}>
                            <Link to={atBerthExecutionOpenPath(r)} className="btn btn--small btn--primary">
                              {t('open')}
                            </Link>
                            {r.operationId != null && (
                              <button
                                type="button"
                                className="btn btn--small btn--secondary"
                                style={{ marginLeft: '0.5rem' }}
                                onClick={(e) => handleShiftOutClick(r, g.children, e)}
                                disabled={Boolean(shiftSavingByOpId[r.operationId])}
                                title={r.shiftingOut ? t('shiftOutTooltipUndo') : t('shiftOutTooltipDo')}
                              >
                                {shiftSavingByOpId[r.operationId]
                                  ? t('saving')
                                  : r.shiftingOut
                                    ? term('undoShiftingOut')
                                    : term('shiftingOut')}
                              </button>
                            )}
                          </td>
                          {atBerthColumns.map((col) => (
                            <td key={col.key}>
                              {col.key === 'jettyOperationCode' ? (
                                r.shippingInstructionId ? (
                                  <a
                                    href="#"
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      openSiDetailModal(r.shippingInstructionId)
                                    }}
                                    aria-label={t('openSiDetailFromJettyOp')}
                                  >
                                    {r.jettyOperationCode || '—'}
                                  </a>
                                ) : (
                                  r.jettyOperationCode || '—'
                                )
                              ) : col.key === 'shippingInstruction' ? (
                                r.shippingInstructionId ? (
                                  <a
                                    href="#"
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      openSiDocumentModal(r.shippingInstructionId)
                                    }}
                                    aria-label={t('openSiDocument')}
                                  >
                                    {r.shippingInstruction || '—'}
                                  </a>
                                ) : (
                                  r.shippingInstruction || '—'
                                )
                              ) : col.key === 'etc' ? (
                                <span className="at-berth-etc-cell">
                                  {formatDateTimeDisplay(r.estimatedCompletionDateTime || r.estimationOfCompletion)}
                                  {rowBreach ? (
                                    <span className="at-berth-etc-cell__badge">
                                      <Link
                                        to={atBerthExecutionOpenPath(r)}
                                        className="etc-breach-badge-hit"
                                        onClick={(e) => e.stopPropagation()}
                                        title={t('open')}
                                      >
                                        <EtcBreachBadge
                                          overMs={rowBreach.overMs}
                                          etcMs={rowBreach.etcMs}
                                          size="sm"
                                        />
                                      </Link>
                                    </span>
                                  ) : null}
                                </span>
                              ) : col.key === 'commodityQty' ? (
                                renderCommodityQtyCell(r)
                              ) : (
                                col.getValue(r)
                              )}
                            </td>
                          ))}
                        </tr>
                        {expandedDetailRowId === r.id && (
                          <tr className="allocation-table__detail-row">
                            <td colSpan={tableColSpan} className="allocation-table__detail-cell">
                              <AtBerthDetailPanel
                                r={r}
                                onOpenSiDetail={openSiDetailModal}
                                nowMs={breachNowMs}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  }
                  const expanded = expandedGroupKey === g.key
                  return (
                    <Fragment key={g.key}>
                      <tr
                        className={`allocation-table__row at-berth__group-header ${expanded ? 'allocation-table__row--expanded' : ''}${g.maxBreach ? ' allocation-table__row--etc-breach' : ''}`}
                        onClick={() => setExpandedGroupKey((prev) => (prev === g.key ? null : g.key))}
                      >
                        <td className="allocation-table__expand-col">
                          <span className="allocation-table__expand-icon" aria-hidden>
                            {expanded ? '▼' : '▶'}
                          </span>
                        </td>
                        <td className="allocation-table__action-col" onClick={(e) => e.stopPropagation()}>
                          {g.shiftRow.operationId != null && (
                            <button
                              type="button"
                              className="btn btn--small btn--secondary"
                              onClick={(e) => handleShiftOutClick(g.shiftRow, g.children, e)}
                              disabled={Boolean(shiftSavingByOpId[opId])}
                              title={g.shiftRow.shiftingOut ? t('shiftOutTooltipUndo') : t('shiftOutTooltipDo')}
                            >
                              {shiftSavingByOpId[opId]
                                ? t('saving')
                                : g.shiftRow.shiftingOut
                                  ? term('undoShiftingOut')
                                  : term('shiftingOut')}
                            </button>
                          )}
                        </td>
                        {atBerthColumns.map((col) => (
                          <td key={col.key}>
                            {col.key === 'vesselName' ? (
                              <div>
                                <VesselNameButton
                                  name={g.vesselName}
                                  onClick={
                                    g.shiftRow?.shipmentPlanId != null
                                      ? () => setVesselInfoPlanId(g.shiftRow.shipmentPlanId)
                                      : undefined
                                  }
                                  strong
                                />
                                {g.planReference ? (
                                  <span className="text-steel"> · {g.planReference}</span>
                                ) : null}
                              </div>
                            ) : col.key === 'jettyOperationCode' ? (
                              '—'
                            ) : col.key === 'shippingInstruction' ? (
                              t('groupSiCount', { count: g.siCount })
                            ) : col.key === 'commodityQty' ? (
                              <span className="si-cargo-qty-cell">{g.totalQtyDisplay}</span>
                            ) : col.key === 'purpose' ? (
                              g.purposeDisplay
                            ) : col.key === 'jetty' ? (
                              g.jetty
                            ) : col.key === 'ta' ? (
                              g.taDisplay
                            ) : col.key === 'tb' ? (
                              g.tbDisplay
                            ) : col.key === 'etc' ? (
                              <span className="at-berth-etc-cell">
                                {g.etcDisplay}
                                {g.maxBreach ? (
                                  <span className="at-berth-etc-cell__badge">
                                    <EtcBreachBadge
                                      overMs={g.maxBreach.overMs}
                                      etcMs={g.maxBreach.etcMs}
                                      size="sm"
                                    />
                                  </span>
                                ) : null}
                              </span>
                            ) : col.key === 'phaseLabel' ? (
                              g.phaseDisplay
                            ) : col.key === 'status' ? (
                              g.statusDisplay
                            ) : (
                              '—'
                            )}
                          </td>
                        ))}
                      </tr>
                      {expanded &&
                        g.children.map((r) => {
                          const childBreach = getEtcBreach(r, breachNowMs)
                          return (
                          <Fragment key={r.id}>
                            <tr
                              className={`allocation-table__row allocation-table__row--plan-child ${expandedDetailRowId === r.id ? 'allocation-table__row--expanded' : ''}${childBreach ? ' allocation-table__row--etc-breach' : ''}`}
                              onClick={() => setExpandedDetailRowId((id) => (id === r.id ? null : r.id))}
                            >
                              <td className="allocation-table__expand-col">
                                <span className="allocation-table__expand-icon" aria-hidden>
                                  {expandedDetailRowId === r.id ? '▼' : '▶'}
                                </span>
                              </td>
                              <td className="allocation-table__action-col" onClick={(e) => e.stopPropagation()}>
                                <Link to={atBerthExecutionOpenPath(r)} className="btn btn--small btn--primary">
                                  {t('open')}
                                </Link>
                              </td>
                              {atBerthColumns.map((col) => (
                                <td key={col.key}>
                                  {col.key === 'jettyOperationCode' ? (
                                    r.shippingInstructionId ? (
                                      <a
                                        href="#"
                                        onClick={(e) => {
                                          e.preventDefault()
                                          e.stopPropagation()
                                          openSiDetailModal(r.shippingInstructionId)
                                        }}
                                        aria-label={t('openSiDetailFromJettyOp')}
                                      >
                                        {r.jettyOperationCode || '—'}
                                      </a>
                                    ) : (
                                      r.jettyOperationCode || '—'
                                    )
                                  ) : col.key === 'shippingInstruction' ? (
                                    r.shippingInstructionId ? (
                                      <a
                                        href="#"
                                        onClick={(e) => {
                                          e.preventDefault()
                                          e.stopPropagation()
                                          openSiDocumentModal(r.shippingInstructionId)
                                        }}
                                        aria-label={t('openSiDocument')}
                                      >
                                        {r.shippingInstruction || '—'}
                                      </a>
                                    ) : (
                                      r.shippingInstruction || '—'
                                    )
                                  ) : col.key === 'etc' ? (
                                    <span className="at-berth-etc-cell">
                                      {formatDateTimeDisplay(r.estimatedCompletionDateTime || r.estimationOfCompletion)}
                                      {childBreach ? (
                                        <span className="at-berth-etc-cell__badge">
                                          <Link
                                            to={atBerthExecutionOpenPath(r)}
                                            className="etc-breach-badge-hit"
                                            onClick={(e) => e.stopPropagation()}
                                            title={t('open')}
                                          >
                                            <EtcBreachBadge
                                              overMs={childBreach.overMs}
                                              etcMs={childBreach.etcMs}
                                              size="sm"
                                            />
                                          </Link>
                                        </span>
                                      ) : null}
                                    </span>
                                  ) : col.key === 'commodityQty' ? (
                                    renderCommodityQtyCell(r)
                                  ) : (
                                    col.getValue(r)
                                  )}
                                </td>
                              ))}
                            </tr>
                            {expandedDetailRowId === r.id && (
                              <tr className="allocation-table__detail-row">
                                <td colSpan={tableColSpan} className="allocation-table__detail-cell">
                                  <AtBerthDetailPanel
                                    r={r}
                                    onOpenSiDetail={openSiDetailModal}
                                    nowMs={breachNowMs}
                                  />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                          )
                        })}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="allocation-mobile-cards" aria-label="At-berth vessel cards">
            {vesselGroups.map((g) => {
              if (g.siCount <= 1) {
                const r = g.shiftRow
                const mobileBreach = getEtcBreach(r, breachNowMs)
                return (
                  <article
                    key={g.key}
                    className={`allocation-mobile-card${mobileBreach ? ' allocation-mobile-card--etc-breach' : ''}`}
                  >
                    <header className="allocation-mobile-card__header">
                      <VesselNameButton
                        name={r.vesselName || '—'}
                        onClick={
                          r.shipmentPlanId != null ? () => setVesselInfoPlanId(r.shipmentPlanId) : undefined
                        }
                        strong
                      />
                      <span className="allocation-mobile-card__header-meta">
                        {mobileBreach ? (
                          <Link to={atBerthExecutionOpenPath(r)} className="etc-breach-badge-hit">
                            <EtcBreachBadge overMs={mobileBreach.overMs} etcMs={mobileBreach.etcMs} size="md" />
                          </Link>
                        ) : null}
                        <span className="text-steel">{statusToPhase(r.status)}</span>
                      </span>
                    </header>
                    <dl className="allocation-mobile-card__grid">
                      <dt>{t('colJettyOperationId')}</dt>
                      <dd>
                        {r.shippingInstructionId ? (
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault()
                              openSiDetailModal(r.shippingInstructionId)
                            }}
                            aria-label={t('openSiDetailFromJettyOp')}
                          >
                            {r.jettyOperationCode || '—'}
                          </a>
                        ) : (
                          r.jettyOperationCode || '—'
                        )}
                      </dd>
                      <dt>{t('colSi')}</dt>
                      <dd>
                        {r.shippingInstructionId ? (
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault()
                              openSiDocumentModal(r.shippingInstructionId)
                            }}
                            aria-label={t('openSiDocument')}
                          >
                            {r.shippingInstruction || '—'}
                          </a>
                        ) : (
                          r.shippingInstruction || '—'
                        )}
                      </dd>
                      <dt>{t('colCommodityQty')}</dt>
                      <dd className="si-cargo-qty-cell">{r.totalQtyDisplay || '—'}</dd>
                      <dt>{t('colPurpose')}</dt>
                      <dd>{r.purpose || '—'}</dd>
                      <dt>{t('colJetty')}</dt>
                      <dd>{r.jetty || '—'}</dd>
                      <dt>{t('colTa')}</dt>
                      <dd>{formatDateTimeDisplay(r.taDateTime)}</dd>
                      <dt>{t('colTb')}</dt>
                      <dd>{formatDateTimeDisplay(r.tbDateTime)}</dd>
                      <dt>{t('colEtc')}</dt>
                      <dd>
                        {formatDateTimeDisplay(r.estimatedCompletionDateTime || r.estimationOfCompletion)}
                        {mobileBreach ? (
                          <span className="at-berth-etc-cell__badge">
                            <EtcBreachBadge overMs={mobileBreach.overMs} etcMs={mobileBreach.etcMs} size="sm" />
                          </span>
                        ) : null}
                      </dd>
                      <dt>{t('colStatus')}</dt>
                      <dd>{r.status || '—'}</dd>
                    </dl>
                    <div className="allocation-mobile-card__actions">
                      <button
                        type="button"
                        className="btn btn--small btn--ghost"
                        onClick={() => setExpandedMobileDetailId((id) => (id === r.id ? null : r.id))}
                      >
                        {expandedMobileDetailId === r.id ? t('hideDetail') : t('fullDetail')}
                      </button>
                      <Link to={atBerthExecutionOpenPath(r)} className="btn btn--small btn--primary">
                        {t('open')}
                      </Link>
                      {r.operationId != null && (
                        <button
                          type="button"
                          className="btn btn--small btn--secondary"
                          onClick={(e) => handleShiftOutClick(r, g.children, e)}
                          disabled={Boolean(shiftSavingByOpId[r.operationId])}
                        >
                          {shiftSavingByOpId[r.operationId]
                            ? t('saving')
                            : r.shiftingOut
                              ? term('undoShiftingOut')
                              : term('shiftingOut')}
                        </button>
                      )}
                    </div>
                    {expandedMobileDetailId === r.id ? (
                      <div className="allocation-mobile-card__detail">
                        <AtBerthDetailPanel
                          r={r}
                          onOpenSiDetail={openSiDetailModal}
                          nowMs={breachNowMs}
                        />
                      </div>
                    ) : null}
                  </article>
                )
              }
              const mobExpanded = expandedMobileGroupKey === g.key
              return (
                <article key={g.key} className="allocation-mobile-card allocation-mobile-card--plan">
                  <header className="allocation-mobile-card__header">
                    <div>
                      <strong>{g.vesselName}</strong>
                      {g.planReference ? <span className="text-steel"> · {g.planReference}</span> : null}
                    </div>
                    <span className="text-steel">{t('groupSiCount', { count: g.siCount })}</span>
                  </header>
                  <dl className="allocation-mobile-card__grid">
                    <dt>{t('colJetty')}</dt>
                    <dd>{g.jetty}</dd>
                    <dt>{t('colCommodityQty')}</dt>
                    <dd className="si-cargo-qty-cell">{g.totalQtyDisplay}</dd>
                    <dt>{t('colPhase')}</dt>
                    <dd>{g.phaseDisplay}</dd>
                    <dt>{t('colTa')}</dt>
                    <dd>{g.taDisplay}</dd>
                    <dt>{t('colTb')}</dt>
                    <dd>{g.tbDisplay}</dd>
                  </dl>
                  <div className="allocation-mobile-card__actions">
                    <button
                      type="button"
                      className="btn btn--small btn--ghost"
                      onClick={() =>
                        setExpandedMobileGroupKey((k) => {
                          const next = k === g.key ? null : g.key
                          if (next !== g.key) setExpandedMobileDetailId(null)
                          return next
                        })
                      }
                    >
                      {mobExpanded ? t('groupCollapse') : t('groupExpand')}
                    </button>
                    {g.shiftRow.operationId != null && (
                      <button
                        type="button"
                        className="btn btn--small btn--secondary"
                        onClick={(e) => handleShiftOutClick(g.shiftRow, g.children, e)}
                        disabled={Boolean(shiftSavingByOpId[g.shiftRow.operationId])}
                      >
                        {shiftSavingByOpId[g.shiftRow.operationId]
                          ? t('saving')
                          : g.shiftRow.shiftingOut
                            ? term('undoShiftingOut')
                            : term('shiftingOut')}
                      </button>
                    )}
                  </div>
                  {mobExpanded ? (
                    <div className="at-berth-mobile-group-children">
                      {g.children.map((r) => (
                        <div key={r.id} className="at-berth-mobile-child">
                          <div className="at-berth-mobile-child__head">
                            <span className="text-steel">{r.shippingInstruction || '—'}</span>
                            <span className="text-steel si-cargo-qty-cell">{r.totalQtyDisplay || '—'}</span>
                            <Link to={atBerthExecutionOpenPath(r)} className="btn btn--small btn--primary">
                              {t('open')}
                            </Link>
                          </div>
                          <div className="at-berth-mobile-child__actions allocation-mobile-card__actions">
                            <button
                              type="button"
                              className="btn btn--small btn--ghost"
                              onClick={() => setExpandedMobileDetailId((id) => (id === r.id ? null : r.id))}
                            >
                              {expandedMobileDetailId === r.id ? t('hideDetail') : t('fullDetail')}
                            </button>
                          </div>
                          {expandedMobileDetailId === r.id ? (
                            <div className="allocation-mobile-card__detail">
                              <AtBerthDetailPanel r={r} onOpenSiDetail={openSiDetailModal} />
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
          </>
        )}
      </section>

      {shiftModal?.shiftRow ? (
        <div className="modal-overlay" onClick={closeShiftModal} aria-hidden="true">
          <div
            className="modal"
            onClick={(ev) => ev.stopPropagation()}
            role="dialog"
            aria-labelledby="shift-out-modal-title"
            aria-modal="true"
          >
            <h2 id="shift-out-modal-title" className="modal__title">
              {t('shiftOutTitle', {
                name:
                  shiftModal.shiftRow.vesselName ||
                  shiftModal.shiftRow.shippingInstruction ||
                  t('colVessel'),
              })}
            </h2>
            <p className="text-steel" style={{ marginBottom: '0.75rem', fontSize: '0.9rem' }}>
              {t('shiftOutIntro')}
            </p>
            {shiftModal.children && shiftModal.children.length > 1 ? (
              <>
                <p className="text-steel" style={{ marginBottom: '0.35rem', fontSize: '0.85rem' }}>
                  {t('shiftOutAffectsIntro')}
                </p>
                <ul className="text-steel" style={{ margin: '0 0 0.75rem 1.1rem', fontSize: '0.85rem' }}>
                  {shiftModal.children.map((c) => (
                    <li key={c.id}>
                      {c.shippingInstruction || c.jettyOperationCode || c.id}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <div className="modal__section">
              <label htmlFor="shift-out-remark" className="modal__label">
                {t('remark')}
              </label>
              <textarea
                id="shift-out-remark"
                className="modal__textarea"
                rows={4}
                value={shiftRemarkDraft}
                onChange={(ev) => setShiftRemarkDraft(ev.target.value)}
                maxLength={MAX_REMARK_CHARS}
                disabled={Boolean(shiftSavingByOpId[shiftModal.shiftRow.operationId])}
              />
            </div>
            <div className="modal__actions" style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn--secondary" onClick={closeShiftModal}>
                {t('cancel')}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => confirmShiftOut()}
                disabled={Boolean(shiftSavingByOpId[shiftModal.shiftRow.operationId])}
              >
                {shiftSavingByOpId[shiftModal.shiftRow.operationId] ? t('saving') : t('confirmShiftOut')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <SiDetailModal
        isOpen={Boolean(siDetailId)}
        siId={siDetailId}
        onClose={() => setSiDetailId(null)}
      />
      <SiDocumentModal
        isOpen={Boolean(siDocumentModalId)}
        siId={siDocumentModalId}
        onClose={() => setSiDocumentModalId(null)}
        allowPreApprovalPreview
      />
      <VesselInfoModal
        planId={vesselInfoPlanId}
        isOpen={vesselInfoPlanId != null}
        onClose={() => setVesselInfoPlanId(null)}
        onSaved={() => load().catch(() => {})}
      />
    </div>
  )
}
