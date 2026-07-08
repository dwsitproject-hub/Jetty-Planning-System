import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { fetchShipmentPlan, approveShipmentPlan, rejectShipmentPlan } from '../api/shipmentPlans'
import { useRbac } from '../context/RbacContext'
import PurposeBadge from '../components/PurposeBadge'
import '../styles/si-approval.css'
import '../styles/shipping-instruction.css'
import '../styles/si-view.css'

import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'

function breakdownTotalLabel(breakdown) {
  const rows = Array.isArray(breakdown) ? breakdown : []
  const totalsByUnit = rows.reduce((acc, r) => {
    const code = r.metricCode || '?'
    acc[code] = (acc[code] || 0) + (Number(r.qty) || 0)
    return acc
  }, {})
  if (Object.keys(totalsByUnit).length === 0) return '—'
  return Object.entries(totalsByUnit)
    .map(([code, sum]) => `${Number(sum).toLocaleString('id-ID')} ${code}`)
    .join(' · ')
}

function displayCommodity(si) {
  if (si?.commodity && String(si.commodity).trim()) return String(si.commodity).trim()
  const first = (si?.breakdown || []).find((b) => b?.commodityName && String(b.commodityName).trim())
  return first?.commodityName ? String(first.commodityName).trim() : '—'
}

export default function ShipmentPlanApproval() {
  const { planId } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation('shipmentPlan')
  const { canView, canApprove } = useRbac()
  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [certified, setCertified] = useState(false)
  const [signOffReason, setSignOffReason] = useState('')
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const [toast, setToast] = useState(null)

  const id = parseInt(planId, 10)

  const load = useCallback(async () => {
    if (Number.isNaN(id)) {
      setPlan(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const d = await fetchShipmentPlan(id)
      setPlan(d)
      if (d?.approvalStatus === 'Approved') setDone('approved')
      if (d?.approvalStatus === 'Rejected') setDone('rejected')
    } catch {
      setPlan(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!toast) return
    const tid = window.setTimeout(() => setToast(null), 5500)
    return () => window.clearTimeout(tid)
  }, [toast])

  const handleApprove = async () => {
    if (!certified || !canApprove('shipment-plan')) return
    const r = signOffReason.trim()
    if (!r) {
      setError(t('approvalReasonRequired'))
      return
    }
    setError(null)
    try {
      await approveShipmentPlan(id, r)
      setDone('approved')
      setToast({ message: t('approveSuccess'), variant: 'success' })
      await load()
    } catch (e) {
      setError(e?.message || 'Approval failed')
    }
  }

  const handleReject = async () => {
    if (!certified || !canApprove('shipment-plan')) return
    const r = signOffReason.trim()
    if (!r) {
      setError(t('approvalReasonRequired'))
      return
    }
    setError(null)
    try {
      await rejectShipmentPlan(id, r)
      setDone('rejected')
      await load()
    } catch (e) {
      setError(e?.message || 'Reject failed')
    }
  }

  const statusLabel = useMemo(() => {
    if (!plan) return ''
    if (done === 'approved' || plan.approvalStatus === 'Approved') return 'Approved'
    if (done === 'rejected' || plan.approvalStatus === 'Rejected') return 'Rejected'
    if (plan.approvalStatus === 'Submitted') return 'Submitted'
    return plan.approvalStatus
  }, [plan, done])

  if (!canView('shipment-plan')) {
    return (
      <div className="si-approval-page">
        <p className="text-steel" style={{ padding: '1rem' }}>
          {t('noPermission')}
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="si-approval-page">
        <p className="text-steel" style={{ padding: '1rem' }}>
          {t('listLoading')}
        </p>
      </div>
    )
  }

  if (!plan) {
    return (
      <div className="si-approval-page">
        <div className="card" style={{ margin: '1rem' }}>
          <p className="text-steel">Plan not found.</p>
          <button type="button" className="btn btn--primary" onClick={() => navigate('/shipment-plans')}>
            {t('backToList')}
          </button>
        </div>
      </div>
    )
  }

  const sis = plan.shippingInstructions || []

  return (
    <div className="si-approval-page shipment-plan-approval">
      {toast && (
        <div
          className={`si-toast si-toast--${toast.variant}`}
          role={toast.variant === 'error' ? 'alert' : 'status'}
          aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          <span className="si-toast__icon" aria-hidden>
            {toast.variant === 'error' ? '!' : '✓'}
          </span>
          <p className="si-toast__message">{toast.message}</p>
          <button type="button" className="si-toast__close" onClick={() => setToast(null)} aria-label={t('dismissNotification')}>
            ×
          </button>
        </div>
      )}

      <header className="si-approval-header no-print">
        <div className="si-approval-header__left">
          <Link to="/shipment-plans" className="link si-approval-back no-print">
            {t('approvalBackToShipmentPlans')}
          </Link>
          <h1 className="page-title page-title-row">
            <span>{t('approvalPageTitle')}</span>
          </h1>
          <span className={`si-approval-status si-approval-status--${(statusLabel || 'submitted').toLowerCase()}`}>
            {statusLabel}
          </span>
        </div>
      </header>

      <section className="card shipment-plan-approval__section no-print" style={{ margin: '1rem' }}>
        <h2 className="shipment-plan-approval__section-title">{t('approvalPlanSummaryTitle')}</h2>
        <div className="si-view-summary" style={{ marginBottom: 0 }}>
          <div className="si-view-summary__row">
            <span className="si-view-summary__label">{t('approvalPlanRef')}</span>
            <span className="si-view-summary__value">{plan.planReference || `Plan #${plan.id}`}</span>
          </div>
          <div className="si-view-summary__row">
            <span className="si-view-summary__label">{t('approvalPlanVessel')}</span>
            <span className="si-view-summary__value">{plan.vesselName || '—'}</span>
          </div>
          <div className="si-view-summary__row">
            <span className="si-view-summary__label">{t('approvalPlanPurpose')}</span>
            <span className="si-view-summary__value">
              <PurposeBadge purpose={plan.purposeCode} />
            </span>
          </div>
          <div className="si-view-summary__row">
            <span className="si-view-summary__label">{t('approvalPlanEta')}</span>
            <span className="si-view-summary__value">{formatDateTimeDisplay(plan.eta)}</span>
          </div>
        </div>
      </section>

      <section className="card shipment-plan-approval__section no-print" style={{ margin: '1rem' }}>
        <h2 className="shipment-plan-approval__section-title">{t('approvalSiSectionTitle')}</h2>
        <p className="text-steel shipment-plan-approval__si-count">
          {t('approvalSiCount', { count: sis.length })}
        </p>
        <div className="shipment-plan-approval__si-list">
          {sis.map((si) => {
            const bd = Array.isArray(si.breakdown) ? si.breakdown : []
            const totalLabel = breakdownTotalLabel(bd)
            return (
              <article key={si.id} className="si-view-doc shipment-plan-approval__si-card">
                <h3 className="shipment-plan-approval__si-title">
                  {t('approvalSiNoLabel')}: {si.referenceNumber || `SI-${si.id}`}
                </h3>
                <div className="si-view-summary shipment-plan-approval__si-summary">
                  <div className="si-view-summary__row">
                    <span className="si-view-summary__label">{t('approvalSiCommodity')}</span>
                    <span className="si-view-summary__value">{displayCommodity(si)}</span>
                  </div>
                </div>
                <div className="si-view-table-wrap">
                  <table className="si-view-table">
                    <thead>
                      <tr>
                        <th className="si-view-table__th">{t('approvalTableCommodity')}</th>
                        <th className="si-view-table__th si-view-table__th--num">{t('approvalTableQty')}</th>
                        <th className="si-view-table__th">{t('approvalTableUnit')}</th>
                        <th className="si-view-table__th">{t('approvalTableKontrak')}</th>
                        <th className="si-view-table__th">{t('approvalTablePo')}</th>
                        <th className="si-view-table__th">{t('approvalTableSo')}</th>
                        <th className="si-view-table__th">{t('approvalTableKeterangan')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bd.length > 0 ? (
                        bd.map((row, i) => (
                          <tr key={`bd-${si.id}-${i}`}>
                            <td className="si-view-table__cell">{row.commodityName || '—'}</td>
                            <td className="si-view-table__cell si-view-table__cell--num">
                              {row.qty != null ? Number(row.qty).toLocaleString('id-ID') : '—'}
                            </td>
                            <td className="si-view-table__cell">{row.metricCode || '—'}</td>
                            <td className="si-view-table__cell">{row.contractNo || '—'}</td>
                            <td className="si-view-table__cell">{row.poNo || '—'}</td>
                            <td className="si-view-table__cell">{row.soNo || '—'}</td>
                            <td className="si-view-table__cell">{row.remarks || '—'}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td className="si-view-table__cell">—</td>
                          <td className="si-view-table__cell si-view-table__cell--num">—</td>
                          <td className="si-view-table__cell">—</td>
                          <td className="si-view-table__cell">—</td>
                          <td className="si-view-table__cell">—</td>
                          <td className="si-view-table__cell">—</td>
                          <td className="si-view-table__cell">—</td>
                        </tr>
                      )}
                      <tr className="si-view-table__total">
                        <td colSpan={6} className="si-view-table__cell si-view-table__cell--total-label">
                          {t('approvalTableTotal')}
                        </td>
                        <td className="si-view-table__cell si-view-table__cell--total">{totalLabel}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      {plan.approvalStatus === 'Submitted' && !done && canApprove('shipment-plan') && (
        <div className="card shipment-plan-approval__actions-card no-print" style={{ margin: '1rem' }}>
          <div className="shipment-plan-approval__certify-box">
            <input
              id="sp-approval-certify"
              type="checkbox"
              className="shipment-plan-approval__certify-checkbox"
              checked={certified}
              onChange={(e) => setCertified(e.target.checked)}
            />
            <label htmlFor="sp-approval-certify" className="shipment-plan-approval__certify-label">
              {t('certifyLabel')}
            </label>
          </div>
          <div className="input-group shipment-plan-approval__reason-group">
            <label htmlFor="sp-approval-reason">{t('approvalReasonLabel')}</label>
            <textarea
              id="sp-approval-reason"
              rows={3}
              className="modal__textarea shipment-plan-approval__reason-textarea"
              value={signOffReason}
              onChange={(e) => setSignOffReason(e.target.value)}
              placeholder={t('approvalReasonPlaceholder')}
              required
              aria-required
            />
          </div>
          {error && <p className="shipment-plan-approval__error">{error}</p>}
          <div className="shipment-plan-approval-actions">
            <button
              type="button"
              className="btn shipment-plan-approval-actions__approve"
              disabled={!certified || !signOffReason.trim()}
              onClick={handleApprove}
            >
              {t('approve')}
            </button>
            <button
              type="button"
              className="btn btn--secondary shipment-plan-approval-actions__reject"
              disabled={!certified || !signOffReason.trim()}
              onClick={handleReject}
            >
              {t('reject')}
            </button>
          </div>
        </div>
      )}

      {(done || plan.approvalStatus === 'Approved' || plan.approvalStatus === 'Rejected') && (
        <div className="card no-print" style={{ margin: '1rem' }}>
          <button type="button" className="btn btn--secondary" onClick={() => navigate('/shipment-plans')}>
            {t('backToList')}
          </button>
        </div>
      )}
    </div>
  )
}
