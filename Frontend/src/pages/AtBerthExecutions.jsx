import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { fetchAllocationOverview } from '../api/allocation'
import { setOperationShiftingOut } from '../api/operations'
import { term } from '../i18n/term'
import SiDetailModal from '../components/SiDetailModal'
import SiDocumentModal from '../components/SiDocumentModal'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import { atBerthExecutionOpenPath } from '../utils/atBerthOpenPath'
import '../styles/allocation.css'
import '../styles/modal.css'

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

const AT_BERTH_COLUMNS = [
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
    key: 'commodity',
    label: 'Commodity',
    getValue: (r) => r.commodity || '—',
    getSortValue: (r) => (r.commodity || '').toLowerCase(),
    getFilterValue: (r) => r.commodity,
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

function AtBerthDetailPanel({ r, onOpenSiDetail }) {
  const { t } = useTranslation('atBerth')
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
        <dd>{formatDateTimeDisplay(r.estimatedCompletionDateTime || r.estimationOfCompletion)}</dd>
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
  const filterKeys = AT_BERTH_COLUMNS.map((c) => c.key)
  const [filters, setFilters] = useState(() => Object.fromEntries(filterKeys.map((k) => [k, ''])))
  const [sortState, setSortState] = useState({ key: 'vesselName', dir: 'asc' })
  const [expandedId, setExpandedId] = useState(null)
  const [expandedMobileId, setExpandedMobileId] = useState(null)
  const [siDetailId, setSiDetailId] = useState(null)
  const [siDocumentModalId, setSiDocumentModalId] = useState(null)

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
          commodity: 'colCommodity',
          purpose: 'colPurpose',
          jetty: 'colJetty',
          ta: 'colTa',
          tb: 'colTb',
          phaseLabel: 'colPhase',
          status: 'colStatus',
        })[key] || '',
        { defaultValue: fallback }
      ),
    [t]
  )

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
    const row = shiftModal?.row
    const opId = row?.operationId
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
      const vesselLabel = row.vesselName || row.shippingInstruction || t('colVessel')
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

  const handleShiftOutToggle = useCallback(
    async (row, e) => {
      e?.stopPropagation?.()
      const opId = row?.operationId
      if (!opId) return
      if (!row.shiftingOut) {
        setErr(null)
        setShiftModal({ row })
        setShiftRemarkDraft(String(row.remark ?? row.remarks ?? ''))
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
    [load, t]
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

  const byPurpose = purposeFilter === 'All' ? rows : rows.filter((v) => v.purpose === purposeFilter)
  const updateFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }))
  const handleSort = (key) => setSortState((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))

  const filteredVessels = byPurpose.filter((r) => {
    return filterKeys.every((key) => {
      const f = (filters[key] || '').trim().toLowerCase()
      if (!f) return true
      const col = AT_BERTH_COLUMNS.find((c) => c.key === key)
      const raw = col?.getFilterValue ? col.getFilterValue(r) : r[key]
      return String(raw ?? '').toLowerCase().includes(f)
    })
  })

  const sortedVessels = [...filteredVessels].sort((a, b) => {
    const col = AT_BERTH_COLUMNS.find((c) => c.key === sortState.key)
    if (!col) return 0
    const va = col.getSortValue(a)
    const vb = col.getSortValue(b)
    let cmp
    if (typeof va === 'number' && typeof vb === 'number') {
      cmp = va - vb
    } else {
      cmp = String(va).localeCompare(String(vb), undefined, { numeric: true })
    }
    return sortState.dir === 'asc' ? cmp : -cmp
  })

  const tableColSpan = AT_BERTH_COLUMNS.length + 2

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
          </div>
        </div>
        {loading ? (
          <p className="text-steel">{t('loading')}</p>
        ) : rows.length === 0 ? (
          <p className="text-steel">{t('emptyNoOps')}</p>
        ) : sortedVessels.length === 0 ? (
          <p className="text-steel">{t('emptyNoFilterMatch')}</p>
        ) : (
          <>
          <div className="table-wrap allocation-table-desktop">
            <table className="data-table allocation-table">
              <thead>
                <tr>
                  <th className="allocation-table__expand-col" aria-label={t('expandRow')} />
                  <th className="allocation-table__action-col">{t('action')}</th>
                  {AT_BERTH_COLUMNS.map((col) => (
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
                  {AT_BERTH_COLUMNS.map((col) => (
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
                {sortedVessels.map((r) => (
                  <Fragment key={r.id}>
                    <tr
                      className={`allocation-table__row ${expandedId === r.id ? 'allocation-table__row--expanded' : ''}`}
                      onClick={() => setExpandedId((id) => (id === r.id ? null : r.id))}
                    >
                      <td className="allocation-table__expand-col">
                        <span className="allocation-table__expand-icon" aria-hidden>
                          {expandedId === r.id ? '▼' : '▶'}
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
                          onClick={(e) => handleShiftOutToggle(r, e)}
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
                      {AT_BERTH_COLUMNS.map((col) => (
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
                          ) : (
                            col.getValue(r)
                          )}
                        </td>
                      ))}
                    </tr>
                    {expandedId === r.id && (
                      <tr className="allocation-table__detail-row">
                        <td colSpan={tableColSpan} className="allocation-table__detail-cell">
                          <AtBerthDetailPanel r={r} onOpenSiDetail={openSiDetailModal} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="allocation-mobile-cards" aria-label="At-berth vessel cards">
            {sortedVessels.map((r) => (
              <article key={`at-berth-mobile-${r.id}`} className="allocation-mobile-card">
                <header className="allocation-mobile-card__header">
                  <strong>{r.vesselName || '—'}</strong>
                  <span className="text-steel">{statusToPhase(r.status)}</span>
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
                  <dt>{t('colPurpose')}</dt>
                  <dd>{r.purpose || '—'}</dd>
                  <dt>{t('colJetty')}</dt>
                  <dd>{r.jetty || '—'}</dd>
                  <dt>{t('colTa')}</dt>
                  <dd>{formatDateTimeDisplay(r.taDateTime)}</dd>
                  <dt>{t('colTb')}</dt>
                  <dd>{formatDateTimeDisplay(r.tbDateTime)}</dd>
                  <dt>{t('colStatus')}</dt>
                  <dd>{r.status || '—'}</dd>
                </dl>
                <div className="allocation-mobile-card__actions">
                  <button
                    type="button"
                    className="btn btn--small btn--ghost"
                    onClick={() => setExpandedMobileId((id) => (id === r.id ? null : r.id))}
                  >
                    {expandedMobileId === r.id ? t('hideDetail', { defaultValue: 'Hide full detail' }) : t('fullDetail', { defaultValue: 'Full detail' })}
                  </button>
                  <Link to={atBerthExecutionOpenPath(r)} className="btn btn--small btn--primary">
                    {t('open')}
                  </Link>
                  {r.operationId != null && (
                    <button
                      type="button"
                      className="btn btn--small btn--secondary"
                      onClick={(e) => handleShiftOutToggle(r, e)}
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
                {expandedMobileId === r.id ? (
                  <div className="allocation-mobile-card__detail">
                    <AtBerthDetailPanel r={r} onOpenSiDetail={openSiDetailModal} />
                  </div>
                ) : null}
              </article>
            ))}
          </div>
          </>
        )}
      </section>

      {shiftModal?.row ? (
        <div className="modal-overlay" onClick={closeShiftModal} aria-hidden="true">
          <div
            className="modal"
            onClick={(ev) => ev.stopPropagation()}
            role="dialog"
            aria-labelledby="shift-out-modal-title"
            aria-modal="true"
          >
            <h2 id="shift-out-modal-title" className="modal__title">
              {t('shiftOutTitle', { name: shiftModal.row.vesselName || shiftModal.row.shippingInstruction || t('colVessel') })}
            </h2>
            <p className="text-steel" style={{ marginBottom: '0.75rem', fontSize: '0.9rem' }}>
              {t('shiftOutIntro')}
            </p>
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
                disabled={Boolean(shiftSavingByOpId[shiftModal.row.operationId])}
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
                disabled={Boolean(shiftSavingByOpId[shiftModal.row.operationId])}
              >
                {shiftSavingByOpId[shiftModal.row.operationId] ? t('saving') : t('confirmShiftOut')}
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
      />
    </div>
  )
}
