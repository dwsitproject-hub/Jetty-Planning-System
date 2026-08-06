import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  fetchShipmentPlans,
  fetchShipmentPlan,
  submitShipmentPlan,
  deleteShipmentPlan,
} from '../api/shipmentPlans'
import { fetchSiLookups } from '../api/siLookups'
import { useRbac } from '../context/RbacContext'
import { useActivityLog } from '../context/ActivityLogContext'
import PurposeBadge, { resolvePurposeLabel } from '../components/PurposeBadge'
import SiDocumentModal from '../components/SiDocumentModal'
import VesselInfoModal, { VesselNameButton } from '../components/VesselInfoModal'
import ShipmentPlanCombinedFormModal from '../components/ShipmentPlanCombinedFormModal'
import { ShipmentPlanRowActions } from '../components/SiTableRowActions.jsx'
import {
  canOpenPreBerthCombinedEdit,
  preBerthCombinedSaveToastMessage,
} from '../utils/siPreBerthEdit'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import '../styles/shipping-instruction.css'
import '../styles/allocation.css'

function approvalBadgeClass(status) {
  const s = (status || 'draft').toLowerCase()
  return `si-status-badge si-status-badge--${s.replace(/\s+/g, '-')}`
}

const PLANS_LIST_PAGE_SIZE = 20

export default function ShipmentPlansList() {
  const { t } = useTranslation('shipmentPlan')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { logActivity } = useActivityLog()
  const { canView, canEdit, canApprove, canDelete } = useRbac()
  const [list, setList] = useState([])
  const [listLoading, setListLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const [lookups, setLookups] = useState(null)
  const [approvalFilter, setApprovalFilter] = useState('')
  const [purposeFilter, setPurposeFilter] = useState('')
  const [vesselQ, setVesselQ] = useState('')
  const [debouncedVesselQ, setDebouncedVesselQ] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [expandDetail, setExpandDetail] = useState({})
  const [expandLoading, setExpandLoading] = useState(false)

  const [combinedModal, setCombinedModal] = useState(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [tableFilters, setTableFilters] = useState({
    planRef: '',
    vessel: '',
    siRefs: '',
    commodityQty: '',
    purpose: '',
    approval: '',
    jetty: '',
    eta: '',
    externalReference: '',
    requestedBy: '',
  })
  const [plansListPage, setPlansListPage] = useState(1)
  const [siDocumentModalId, setSiDocumentModalId] = useState(null)
  const [vesselInfoPlanId, setVesselInfoPlanId] = useState(null)
  const openedPlanFromQueryRef = useRef(null)

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedVesselQ(vesselQ.trim()), 350)
    return () => window.clearTimeout(id)
  }, [vesselQ])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 5500)
    return () => window.clearTimeout(id)
  }, [toast])

  useEffect(() => {
    fetchSiLookups()
      .then((data) => setLookups(data))
      .catch(() => setLookups(null))
  }, [])

  const loadList = useCallback(async () => {
    setListLoading(true)
    try {
      const rows = await fetchShipmentPlans({
        approvalStatus: approvalFilter || undefined,
        q: debouncedVesselQ || undefined,
        purposeId: purposeFilter || undefined,
      })
      setList(Array.isArray(rows) ? rows : [])
    } catch (e) {
      setList([])
      setToast({ message: e?.message || t('listLoading'), variant: 'error' })
    } finally {
      setListLoading(false)
    }
  }, [approvalFilter, debouncedVesselQ, purposeFilter, t])

  useEffect(() => {
    if (!canView('shipment-plan')) return
    loadList()
  }, [loadList, canView])

  const summary = useMemo(() => {
    const total = list.length
    const pending = list.filter((r) => r.approvalStatus === 'Submitted').length
    const approved = list.filter((r) => r.approvalStatus === 'Approved').length
    const draft = list.filter((r) => r.approvalStatus === 'Draft' || r.approvalStatus === 'Rejected').length
    return { total, pending, approved, draft }
  }, [list])

  const filteredPlans = useMemo(() => {
    const f = tableFilters
    const inc = (hay, needle) =>
      !needle?.trim() || String(hay ?? '').toLowerCase().includes(needle.trim().toLowerCase())
    return list.filter((row) => {
      const planLabel = row.planReference || `Plan #${row.id}`
      if (!inc(planLabel, f.planRef)) return false
      if (!inc(row.vesselName, f.vessel)) return false
      const siStr = (row.shippingInstructions || []).map((s) => s.referenceNumber || `SI-${s.id}`).join(' ')
      if (!inc(siStr, f.siRefs)) return false
      const qtyStr = (row.shippingInstructions || []).map((s) => s.commodityQtyDisplay || '').join(' ')
      if (!inc(qtyStr, f.commodityQty)) return false
      const planPurposeStr = resolvePurposeLabel(row.purposeCode, null)
      if (!inc(planPurposeStr, f.purpose)) return false
      if (!inc(row.approvalStatus, f.approval)) return false
      if (!inc(row.jettyName || '—', f.jetty)) return false
      if (!inc(formatDateTimeDisplay(row.eta), f.eta)) return false
      if (!inc(row.externalReference, f.externalReference)) return false
      if (!inc(row.requestedBy, f.requestedBy)) return false
      return true
    })
  }, [list, tableFilters])

  useEffect(() => {
    setPlansListPage(1)
  }, [tableFilters, approvalFilter, purposeFilter, debouncedVesselQ])

  const plansListTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredPlans.length / PLANS_LIST_PAGE_SIZE)),
    [filteredPlans.length]
  )

  useEffect(() => {
    setPlansListPage((p) => Math.min(p, plansListTotalPages))
  }, [plansListTotalPages])

  const paginatedFilteredPlans = useMemo(() => {
    const start = (plansListPage - 1) * PLANS_LIST_PAGE_SIZE
    return filteredPlans.slice(start, start + PLANS_LIST_PAGE_SIZE)
  }, [filteredPlans, plansListPage])

  const plansPaginationRange = useMemo(() => {
    const total = filteredPlans.length
    if (total === 0) return { from: 0, to: 0 }
    const from = (plansListPage - 1) * PLANS_LIST_PAGE_SIZE + 1
    const to = Math.min(plansListPage * PLANS_LIST_PAGE_SIZE, total)
    return { from, to }
  }, [filteredPlans.length, plansListPage])

  const openCreateModal = () => setCombinedModal({ mode: 'create' })
  const openEditModal = (row) => setCombinedModal({ mode: 'edit', planRow: row })
  const openViewModal = (row) => setCombinedModal({ mode: 'view', planRow: row })
  const openPreBerthEditModal = (row) => setCombinedModal({ mode: 'preBerthEdit', planRow: row })

  const handleCombinedModalClose = () => {
    setCombinedModal(null)
    openedPlanFromQueryRef.current = null
  }

  const handleCombinedModalSaved = (result) => {
    if (result?.planReopened !== undefined) {
      setToast({
        message: preBerthCombinedSaveToastMessage(result, t),
        variant: result.planReopened ? 'warning' : 'success',
      })
    } else if (result?.toast) {
      setToast(result.toast)
    }
    loadList().catch(() => {})
  }

  /** Deep link from plan hub: `/shipment-plans?shipment_plan_id=<id>`. */
  useEffect(() => {
    const raw = searchParams.get('shipment_plan_id')
    if (!raw || !canView('shipment-plan')) return
    const n = parseInt(raw, 10)
    if (Number.isNaN(n)) {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          p.delete('shipment_plan_id')
          return p
        },
        { replace: true }
      )
      return
    }
    if (openedPlanFromQueryRef.current === n) return
    openedPlanFromQueryRef.current = n
    ;(async () => {
      try {
        const d = await fetchShipmentPlan(n)
        const row = {
          id: d.id,
          vesselName: d.vesselName,
          vesselLoaM: d.vesselLoaM,
          vesselGrossTonnage: d.vesselGrossTonnage,
          vesselDraft: d.vesselDraft,
          jettyId: d.jettyId,
          eta: d.eta,
          purposeId: d.purposeId,
          purposeCode: d.purposeCode,
          planReference: d.planReference,
          voyageNo: d.voyageNo,
          approvalStatus: d.approvalStatus,
          agentId: d.agentId,
        }
        if (d.approvalStatus !== 'Draft' && d.approvalStatus !== 'Rejected') {
          openedPlanFromQueryRef.current = null
          if (canOpenPreBerthCombinedEdit(d)) {
            setCombinedModal({ mode: 'preBerthEdit', planRow: row })
          }
          return
        }
        setCombinedModal({ mode: 'edit', planRow: row })
      } catch {
        openedPlanFromQueryRef.current = null
        setToast({ message: t('listLoading'), variant: 'error' })
      } finally {
        setSearchParams(
          (prev) => {
            const p = new URLSearchParams(prev)
            p.delete('shipment_plan_id')
            return p
          },
          { replace: true }
        )
      }
    })()
  }, [searchParams, setSearchParams, canView, t])

  if (!canView('shipment-plan')) {
    return (
      <div className="shipping-instruction-page shipping-instruction-page--plans">
        <p className="text-steel" style={{ padding: '1rem' }}>
          {t('noPermission')}
        </p>
      </div>
    )
  }

  return (
    <div className="shipping-instruction-page shipping-instruction-page--plans">
      {toast && (
        <div
          className={`si-toast si-toast--${toast.variant}`}
          role={toast.variant === 'error' ? 'alert' : 'status'}
          aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          <span className="si-toast__icon" aria-hidden>
            {toast.variant === 'error' ? '!' : toast.variant === 'warning' ? '!' : '✓'}
          </span>
          <p className="si-toast__message">{toast.message}</p>
          <button type="button" className="si-toast__close" onClick={() => setToast(null)} aria-label={t('dismissNotification')}>
            ×
          </button>
        </div>
      )}

      <header className="si-page-header">
        <div className="si-page-header__text">
          <h1 className="page-title">{t('pageTitle')}</h1>
          <p className="si-page-header__subtitle">{t('subtitle')}</p>
        </div>
        {canEdit('shipment-plan') && (
          <button type="button" className="btn btn--primary si-page-header__cta" onClick={openCreateModal}>
            {t('createNewPlan')}
          </button>
        )}
      </header>

      {listLoading && <p className="text-steel" style={{ padding: '0 1rem' }}>{t('listLoading')}</p>}

      <div className="si-summary-cards">
        <div className="si-summary-card">
          <span className="si-summary-card__icon" aria-hidden>🚢</span>
          <span className="si-summary-card__value">{summary.total.toLocaleString()}</span>
          <span className="si-summary-card__label">{t('totalPlans')}</span>
        </div>
        <div className="si-summary-card">
          <span className="si-summary-card__icon" aria-hidden>📋</span>
          <span className="si-summary-card__value">{summary.draft}</span>
          <span className="si-summary-card__label">{t('draftPlans')}</span>
        </div>
        <div className="si-summary-card">
          <span className="si-summary-card__icon" aria-hidden>🕐</span>
          <span className="si-summary-card__value">{summary.pending}</span>
          <span className="si-summary-card__label">{t('pendingPlanApproval')}</span>
        </div>
        <div className="si-summary-card">
          <span className="si-summary-card__icon si-summary-card__icon--check" aria-hidden>✓</span>
          <span className="si-summary-card__value">{summary.approved}</span>
          <span className="si-summary-card__label">{t('approvedPlans')}</span>
        </div>
      </div>

      <div className="si-toolbar si-toolbar--actions-only">
        <div className="si-toolbar__actions">
          <button
            type="button"
            className={`btn btn--secondary si-toolbar__btn ${filtersOpen ? 'si-toolbar__btn--active' : ''}`}
            onClick={() => setFiltersOpen((o) => !o)}
          >
            🔽 {t('filters')}
          </button>
        </div>
      </div>

      {filtersOpen && (
        <div className="si-filters-panel">
          <div className="si-filters-panel__row">
            <label className="si-filters-panel__label">{t('filterApproval')}</label>
            <select
              className="si-filters-panel__select"
              value={approvalFilter}
              onChange={(e) => setApprovalFilter(e.target.value)}
            >
              <option value="">{t('filterAll')}</option>
              <option value="Draft">Draft</option>
              <option value="Submitted">Submitted</option>
              <option value="Approved">Approved</option>
              <option value="Rejected">Rejected</option>
            </select>
          </div>
          <div className="si-filters-panel__row">
            <label className="si-filters-panel__label">{t('filterVessel')}</label>
            <input
              type="search"
              className="si-filters-panel__select"
              value={vesselQ}
              onChange={(e) => setVesselQ(e.target.value)}
              placeholder={t('filterVessel')}
            />
          </div>
          <div className="si-filters-panel__row">
            <label className="si-filters-panel__label">{t('filterPanelPurpose')}</label>
            <select
              className="si-filters-panel__select"
              value={purposeFilter}
              onChange={(e) => setPurposeFilter(e.target.value)}
              disabled={!lookups?.purposes?.length}
            >
              <option value="">{t('filterAll')}</option>
              {(lookups?.purposes || []).map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.label || p.code || `Purpose ${p.id}`}
                </option>
              ))}
            </select>
          </div>
          <div className="si-filters-panel__row si-filters-panel__row--reset">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                setApprovalFilter('')
                setPurposeFilter('')
                setVesselQ('')
              }}
            >
              {t('reset')}
            </button>
          </div>
        </div>
      )}

      <section className="card" style={{ marginTop: 'var(--spacing-3)' }}>
        <h2 className="card__title">{t('tableSectionTitle')}</h2>
        <div className="table-wrap shipping-instruction-table-desktop">
          <table className="data-table shipping-instruction-table">
            <thead>
              <tr>
                <th scope="col" className="si-table__col-actions shipping-instruction-table__th--actions">
                  {t('colActions')}
                </th>
                <th className="shipping-instruction-table__th">{t('colPlanRef')}</th>
                <th className="shipping-instruction-table__th">{t('colVessel')}</th>
                <th className="shipping-instruction-table__th">{t('colSiRefs')}</th>
                <th className="shipping-instruction-table__th">{t('colCommodityQty')}</th>
                <th className="shipping-instruction-table__th">{t('colPurpose')}</th>
                <th className="shipping-instruction-table__th">{t('colApproval')}</th>
                <th className="shipping-instruction-table__th">{t('colJetty')}</th>
                <th className="shipping-instruction-table__th">{t('colEta')}</th>
                <th className="shipping-instruction-table__th">{t('colExternalReference')}</th>
                <th className="shipping-instruction-table__th">{t('colRequestedBy')}</th>
              </tr>
              <tr className="shipping-instruction-table__filter-row">
                <th className="si-table__col-actions" aria-hidden />
                <th>
                  <input
                    type="text"
                    className="shipping-instruction-table__filter"
                    placeholder={t('filterPlaceholderShort')}
                    value={tableFilters.planRef}
                    onChange={(e) => setTableFilters((f) => ({ ...f, planRef: e.target.value }))}
                    aria-label={t('filterPlanRef')}
                  />
                </th>
                <th>
                  <input
                    type="text"
                    className="shipping-instruction-table__filter"
                    placeholder={t('filterPlaceholderShort')}
                    value={tableFilters.vessel}
                    onChange={(e) => setTableFilters((f) => ({ ...f, vessel: e.target.value }))}
                    aria-label={t('filterVessel')}
                  />
                </th>
                <th>
                  <input
                    type="text"
                    className="shipping-instruction-table__filter"
                    placeholder={t('filterPlaceholderShort')}
                    value={tableFilters.siRefs}
                    onChange={(e) => setTableFilters((f) => ({ ...f, siRefs: e.target.value }))}
                    aria-label={t('filterSiRefs')}
                  />
                </th>
                <th>
                  <input
                    type="text"
                    className="shipping-instruction-table__filter"
                    placeholder={t('filterPlaceholderShort')}
                    value={tableFilters.commodityQty}
                    onChange={(e) => setTableFilters((f) => ({ ...f, commodityQty: e.target.value }))}
                    aria-label={t('filterCommodityQty')}
                  />
                </th>
                <th>
                  <input
                    type="text"
                    className="shipping-instruction-table__filter"
                    placeholder={t('filterPlaceholderShort')}
                    value={tableFilters.purpose}
                    onChange={(e) => setTableFilters((f) => ({ ...f, purpose: e.target.value }))}
                    aria-label={t('filterPlanPurpose')}
                  />
                </th>
                <th>
                  <input
                    type="text"
                    className="shipping-instruction-table__filter"
                    placeholder={t('filterPlaceholderShort')}
                    value={tableFilters.approval}
                    onChange={(e) => setTableFilters((f) => ({ ...f, approval: e.target.value }))}
                    aria-label={t('filterApproval')}
                  />
                </th>
                <th>
                  <input
                    type="text"
                    className="shipping-instruction-table__filter"
                    placeholder={t('filterPlaceholderShort')}
                    value={tableFilters.jetty}
                    onChange={(e) => setTableFilters((f) => ({ ...f, jetty: e.target.value }))}
                    aria-label={t('filterJetty')}
                  />
                </th>
                <th>
                  <input
                    type="text"
                    className="shipping-instruction-table__filter"
                    placeholder={t('filterPlaceholderShort')}
                    value={tableFilters.eta}
                    onChange={(e) => setTableFilters((f) => ({ ...f, eta: e.target.value }))}
                    aria-label={t('filterEta')}
                  />
                </th>
                <th>
                  <input
                    type="text"
                    className="shipping-instruction-table__filter"
                    placeholder={t('filterPlaceholderShort')}
                    value={tableFilters.externalReference}
                    onChange={(e) => setTableFilters((f) => ({ ...f, externalReference: e.target.value }))}
                    aria-label={t('filterExternalReference')}
                  />
                </th>
                <th>
                  <input
                    type="text"
                    className="shipping-instruction-table__filter"
                    placeholder={t('filterPlaceholderShort')}
                    value={tableFilters.requestedBy}
                    onChange={(e) => setTableFilters((f) => ({ ...f, requestedBy: e.target.value }))}
                    aria-label={t('filterRequestedBy')}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {paginatedFilteredPlans.map((row) => (
                <tr key={row.id} className="shipping-instruction-table__row">
                  <td className="si-table__col-actions" onClick={(e) => e.stopPropagation()}>
                    <ShipmentPlanRowActions
                      plan={row}
                      canEdit={canEdit('shipment-plan')}
                      canApprove={canApprove('shipment-plan')}
                      canDelete={canDelete('shipment-plan')}
                      canView={canView('shipment-plan')}
                      onEdit={() => openEditModal(row)}
                      onEditPlanPreBerth={(planRow) => openPreBerthEditModal(planRow)}
                      onSubmit={async () => {
                        try {
                          await submitShipmentPlan(row.id)
                          setToast({ message: t('submitPlanSuccess'), variant: 'success' })
                          await loadList()
                        } catch (err) {
                          setToast({ message: err?.message || t('submitPlanFailed'), variant: 'error' })
                        }
                      }}
                      onOpenApproval={() => navigate(`/shipment-plans/approval/${row.id}`)}
                      onViewHub={() => openViewModal(row)}
                      onDelete={() => {
                        const label = row.planReference || `Plan #${row.id}`
                        if (!window.confirm(t('deletePlanConfirm', { label }))) return
                        void (async () => {
                          try {
                            await deleteShipmentPlan(row.id)
                            setToast({ message: t('deletePlanSuccess'), variant: 'success' })
                            await loadList()
                          } catch (err) {
                            setToast({ message: err?.message || t('deletePlanFailed'), variant: 'error' })
                          }
                        })()
                      }}
                    />
                  </td>
                  <td>{row.planReference || `Plan #${row.id}`}</td>
                  <td>
                    <VesselNameButton name={row.vesselName} onClick={() => setVesselInfoPlanId(row.id)} />
                  </td>
                  <td>
                    {(row.shippingInstructions || []).length ? (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.35rem',
                          alignItems: 'flex-start',
                        }}
                      >
                        {(row.shippingInstructions || []).map((si) => (
                          <a
                            key={si.id}
                            href="#"
                            className="link"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setSiDocumentModalId(si.id)
                            }}
                          >
                            {si.referenceNumber || `SI-${si.id}`}
                          </a>
                        ))}
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {(row.shippingInstructions || []).length ? (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.35rem',
                          alignItems: 'flex-start',
                        }}
                      >
                        {(row.shippingInstructions || []).map((si) => (
                          <span key={`qty-${si.id}`} className="si-cargo-qty-cell">
                            {si.commodityQtyDisplay || '—'}
                          </span>
                        ))}
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <PurposeBadge purpose={row.purposeCode} />
                  </td>
                  <td>
                    <span className={approvalBadgeClass(row.approvalStatus)}>{row.approvalStatus}</span>
                  </td>
                  <td>{row.jettyName || '—'}</td>
                  <td>{formatDateTimeDisplay(row.eta)}</td>
                  <td>{row.externalReference || '—'}</td>
                  <td>{row.requestedBy || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="allocation-mobile-cards shipping-instruction-mobile-cards" aria-label={t('tableSectionTitle')}>
          {paginatedFilteredPlans.map((row) => (
            <article key={`plan-mobile-${row.id}`} className="allocation-mobile-card">
              <header className="allocation-mobile-card__header">
                <strong>{row.planReference || `Plan #${row.id}`}</strong>
                <span className={approvalBadgeClass(row.approvalStatus)}>{row.approvalStatus}</span>
              </header>
              <dl className="allocation-mobile-card__grid">
                <dt>{t('colVessel')}</dt>
                <dd>{row.vesselName || '—'}</dd>
                <dt>{t('colPurpose')}</dt>
                <dd><PurposeBadge purpose={row.purposeCode} /></dd>
                <dt>{t('colJetty')}</dt>
                <dd>{row.jettyName || '—'}</dd>
                <dt>{t('colEta')}</dt>
                <dd>{formatDateTimeDisplay(row.eta)}</dd>
                <dt>{t('colSiRefs')}</dt>
                <dd>
                  {(row.shippingInstructions || []).length ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {(row.shippingInstructions || []).map((si) => (
                        <a
                          key={si.id}
                          href="#"
                          className="link"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setSiDocumentModalId(si.id)
                          }}
                        >
                          {si.referenceNumber || `SI-${si.id}`}
                        </a>
                      ))}
                    </div>
                  ) : '—'}
                </dd>
              </dl>
              <div className="allocation-mobile-card__actions" onClick={(e) => e.stopPropagation()}>
                <ShipmentPlanRowActions
                  plan={row}
                  canEdit={canEdit('shipment-plan')}
                  canApprove={canApprove('shipment-plan')}
                  canDelete={canDelete('shipment-plan')}
                  canView={canView('shipment-plan')}
                  onEdit={() => openEditModal(row)}
                  onEditPlanPreBerth={(planRow) => openPreBerthEditModal(planRow)}
                  onSubmit={async () => {
                    try {
                      await submitShipmentPlan(row.id)
                      setToast({ message: t('submitPlanSuccess'), variant: 'success' })
                      await loadList()
                    } catch (err) {
                      setToast({ message: err?.message || t('submitPlanFailed'), variant: 'error' })
                    }
                  }}
                  onOpenApproval={() => navigate(`/shipment-plans/approval/${row.id}`)}
                  onViewHub={() => openViewModal(row)}
                  onDelete={() => {
                    const label = row.planReference || `Plan #${row.id}`
                    if (!window.confirm(t('deletePlanConfirm', { label }))) return
                    void (async () => {
                      try {
                        await deleteShipmentPlan(row.id)
                        setToast({ message: t('deletePlanSuccess'), variant: 'success' })
                        await loadList()
                      } catch (err) {
                        setToast({ message: err?.message || t('deletePlanFailed'), variant: 'error' })
                      }
                    })()
                  }}
                />
              </div>
            </article>
          ))}
        </div>

        {filteredPlans.length > 0 && (
          <div
            className="shipment-plans-list__pagination"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.75rem',
              marginTop: 'var(--spacing-3)',
            }}
          >
            <p className="text-steel" style={{ margin: 0, fontSize: '0.9rem' }}>
              {t('paginationShowing', {
                from: plansPaginationRange.from,
                to: plansPaginationRange.to,
                total: filteredPlans.length,
              })}
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn--secondary btn--small"
                disabled={plansListPage <= 1}
                onClick={() => setPlansListPage((p) => Math.max(1, p - 1))}
              >
                {t('paginationPrev')}
              </button>
              <span className="text-steel" style={{ fontSize: '0.9rem' }}>
                {t('paginationPageOf', { page: plansListPage, totalPages: plansListTotalPages })}
              </span>
              <button
                type="button"
                className="btn btn--secondary btn--small"
                disabled={plansListPage >= plansListTotalPages}
                onClick={() => setPlansListPage((p) => Math.min(plansListTotalPages, p + 1))}
              >
                {t('paginationNext')}
              </button>
            </div>
          </div>
        )}
      </section>

      <VesselInfoModal
        planId={vesselInfoPlanId}
        isOpen={vesselInfoPlanId != null}
        onClose={() => setVesselInfoPlanId(null)}
        onSaved={loadList}
        onOpenPlanPreBerthEdit={(pid) => openPreBerthEditModal({ id: pid })}
      />
      <SiDocumentModal
        isOpen={siDocumentModalId != null}
        siId={siDocumentModalId}
        onClose={() => setSiDocumentModalId(null)}
        allowPreApprovalPreview
      />
      <ShipmentPlanCombinedFormModal
        isOpen={combinedModal != null}
        mode={combinedModal?.mode ?? 'create'}
        planRow={combinedModal?.planRow ?? null}
        occupancyRows={list}
        onClose={handleCombinedModalClose}
        onSaved={handleCombinedModalSaved}
        logActivity={logActivity}
      />
    </div>
  )
}
