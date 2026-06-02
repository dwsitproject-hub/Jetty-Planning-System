import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  fetchShipmentPlan,
  submitShipmentPlan,
  updateShipmentPlan,
} from '../api/shipmentPlans'
import { fetchSiLookups } from '../api/siLookups'
import { useRbac } from '../context/RbacContext'
import PurposeBadge from '../components/PurposeBadge'
import { MAX_SI_VESSEL_NAME_CHARS, MAX_SI_VOYAGE_CHARS } from '../constants/inputLimits'
import '../styles/shipping-instruction.css'

function approvalBadgeClass(status) {
  const s = (status || 'draft').toLowerCase()
  return `si-status-badge si-status-badge--${s.replace(/\s+/g, '-')}`
}

function toDateTimeLocalValue(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function ShipmentPlanHub() {
  const { planId } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation('shipmentPlan')
  const { canView, canEdit, canApprove } = useRbac()
  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const [lookups, setLookups] = useState(null)
  const [editOpen, setEditOpen] = useState(false)
  const [formVessel, setFormVessel] = useState('')
  const [formJettyId, setFormJettyId] = useState('')
  const [formEta, setFormEta] = useState('')
  const [formPurposeId, setFormPurposeId] = useState('')
  const [formVoyageNo, setFormVoyageNo] = useState('')
  const [formAgentId, setFormAgentId] = useState('')

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
    } catch {
      setPlan(null)
      setToast({ message: 'Plan not found.', variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchSiLookups()
      .then((data) => setLookups(data))
      .catch(() => setLookups(null))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!toast) return
    const tid = window.setTimeout(() => setToast(null), 5500)
    return () => window.clearTimeout(tid)
  }, [toast])

  const openEdit = () => {
    if (!plan) return
    setFormVessel(plan.vesselName || '')
    setFormJettyId(plan.jettyId != null ? String(plan.jettyId) : '')
    setFormEta(toDateTimeLocalValue(plan.eta))
    setFormPurposeId(plan.purposeId != null ? String(plan.purposeId) : '')
    setFormVoyageNo(plan.voyageNo || '')
    setFormAgentId(plan.agentId != null ? String(plan.agentId) : '')
    setEditOpen(true)
  }

  const saveEdit = async (e) => {
    e.preventDefault()
    const v = formVessel.trim()
    if (!v) return
    if (!formEta?.trim()) {
      setToast({ message: t('formEtaRequired'), variant: 'error' })
      return
    }
    if (!formPurposeId) {
      setToast({ message: t('formPurposeRequired'), variant: 'error' })
      return
    }
    try {
      const jettyId = formJettyId ? parseInt(formJettyId, 10) : null
      const purposePid = parseInt(formPurposeId, 10)
      if (Number.isNaN(purposePid)) {
        setToast({ message: t('formPurposeRequired'), variant: 'error' })
        return
      }
      const agentPid = formAgentId.trim() ? parseInt(formAgentId, 10) : NaN
      await updateShipmentPlan(id, {
        vesselName: v,
        jettyId: Number.isNaN(jettyId) ? null : jettyId,
        eta: new Date(formEta).toISOString(),
        purposeId: purposePid,
        voyageNo: formVoyageNo.trim() || null,
        agentId: Number.isFinite(agentPid) ? agentPid : null,
      })
      setEditOpen(false)
      setToast({ message: 'Plan updated.', variant: 'success' })
      await load()
    } catch (err) {
      setToast({ message: err?.message || 'Update failed', variant: 'error' })
    }
  }

  const handleSubmit = async () => {
    if (!canEdit('shipment-plan')) return
    try {
      await submitShipmentPlan(id)
      setToast({ message: 'Plan submitted for approval.', variant: 'success' })
      await load()
    } catch (err) {
      setToast({ message: err?.message || 'Submit failed', variant: 'error' })
    }
  }

  if (!canView('shipment-plan')) {
    return (
      <div className="shipping-instruction-page shipping-instruction-page--plans">
        <p className="text-steel" style={{ padding: '1rem' }}>{t('noPermission')}</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="shipping-instruction-page shipping-instruction-page--plans">
        <p className="text-steel" style={{ padding: '1rem' }}>{t('listLoading')}</p>
      </div>
    )
  }

  if (!plan) {
    return (
      <div className="shipping-instruction-page shipping-instruction-page--plans">
        <p className="text-steel" style={{ padding: '1rem' }}>Plan not found.</p>
        <Link to="/shipment-plans" className="btn btn--primary">{t('backToList')}</Link>
      </div>
    )
  }

  const addSiHref = `/shipment-plans?shipment_plan_id=${encodeURIComponent(String(id))}`
  const canSubmit =
    canEdit('shipment-plan') &&
    (plan.approvalStatus === 'Draft' || plan.approvalStatus === 'Rejected') &&
    (plan.siCount ?? 0) >= 1

  return (
    <div className="shipping-instruction-page shipping-instruction-page--plans">
      {toast && (
        <div
          className={`si-toast si-toast--${toast.variant}`}
          role={toast.variant === 'error' ? 'alert' : 'status'}
          aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          <span className="si-toast__icon" aria-hidden>{toast.variant === 'error' ? '!' : '✓'}</span>
          <p className="si-toast__message">{toast.message}</p>
          <button type="button" className="si-toast__close" onClick={() => setToast(null)} aria-label={t('dismissNotification')}>×</button>
        </div>
      )}

      <header className="si-page-header">
        <div className="si-page-header__text">
          <button type="button" className="btn btn--secondary btn--small" style={{ marginBottom: 8 }} onClick={() => navigate('/shipment-plans')}>
            ← {t('backToList')}
          </button>
          <h1 className="page-title">
            {t('hubTitle')}: {plan.planReference || `#${plan.id}`}
          </h1>
          <p className="si-page-header__subtitle">
            <span className={approvalBadgeClass(plan.approvalStatus)}>{plan.approvalStatus}</span>
            {' · '}
            {plan.vesselName}
            {plan.purposeCode && (
              <>
                {' · '}
                <PurposeBadge purpose={plan.purposeCode} />
              </>
            )}
            {plan.voyageNo ? ` · ${plan.voyageNo}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          {plan.approvalStatus === 'Submitted' && canApprove('shipment-plan') && (
            <button
              type="button"
              className="btn btn--primary si-page-header__cta"
              onClick={() => navigate(`/shipment-plans/approval/${id}`)}
            >
              {t('openApproval')}
            </button>
          )}
          {canEdit('shipment-plan') && (plan.approvalStatus === 'Draft' || plan.approvalStatus === 'Rejected') && (
            <>
              <Link className="btn btn--secondary si-page-header__cta" to={addSiHref}>
                {t('addSi')}
              </Link>
              {canSubmit && (
                <button type="button" className="btn btn--primary si-page-header__cta" onClick={handleSubmit}>
                  {t('submitForApproval')}
                </button>
              )}
              <button type="button" className="btn btn--secondary si-page-header__cta" onClick={openEdit}>
                {t('editPlan')}
              </button>
            </>
          )}
        </div>
      </header>

      <div className="si-summary-cards" style={{ marginBottom: 'var(--spacing-4)' }}>
        {plan.submittedAt && (
          <div className="si-summary-card">
            <span className="si-summary-card__label">{t('submittedAt')}</span>
            <span className="si-summary-card__value" style={{ fontSize: '0.95rem' }}>{new Date(plan.submittedAt).toLocaleString('en-GB')}</span>
          </div>
        )}
        {plan.approvedAt && (
          <div className="si-summary-card">
            <span className="si-summary-card__label">{t('approvedAt')}</span>
            <span className="si-summary-card__value" style={{ fontSize: '0.95rem' }}>{new Date(plan.approvedAt).toLocaleString('en-GB')}</span>
          </div>
        )}
        {plan.rejectedAt && (
          <div className="si-summary-card">
            <span className="si-summary-card__label">{t('rejectedAt')}</span>
            <span className="si-summary-card__value" style={{ fontSize: '0.95rem' }}>{new Date(plan.rejectedAt).toLocaleString('en-GB')}</span>
          </div>
        )}
      </div>

      {plan.rejectionReason && (
        <div className="card" style={{ marginBottom: 'var(--spacing-3)' }}>
          <strong>{t('rejectionReason')}</strong>
          <p className="text-steel" style={{ marginTop: 8 }}>{plan.rejectionReason}</p>
        </div>
      )}

      {canEdit('shipment-plan') && (plan.approvalStatus === 'Draft' || plan.approvalStatus === 'Rejected') && (
        <p className="text-steel" style={{ marginBottom: 'var(--spacing-3)', maxWidth: 720 }}>
          {t('hubExtraSiHint')}
        </p>
      )}

      <h2 className="shipping-instruction-form__section-title">{t('siOnPlan')}</h2>
      <div className="si-table-wrap">
        <table className="si-table">
          <thead>
            <tr>
              <th>{t('colSiRef')}</th>
              <th>{t('colPurpose')}</th>
              <th>{t('colSiStatus')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(plan.shippingInstructions || []).map((si) => (
              <tr key={si.id}>
                <td>{si.referenceNumber || `SI-${si.id}`}</td>
                <td><PurposeBadge purpose={si.purpose} /></td>
                <td>{si.status}</td>
                <td>
                  <Link className="btn btn--secondary btn--small" to={`/shipping-instruction/view/${si.id}`}>
                    {t('openSi')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editOpen && (
        <div className="modal-overlay" onClick={() => setEditOpen(false)} aria-hidden="true">
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal__title">{t('editPlan')}</h2>
            <form onSubmit={saveEdit} className="shipping-instruction-form">
              <div className="shipping-instruction-form__section">
                <div className="shipping-instruction-form__grid">
                  <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                    <label htmlFor="hub-purpose">{t('formPlanPurposeRequired')}</label>
                    <select
                      id="hub-purpose"
                      value={formPurposeId}
                      onChange={(e) => setFormPurposeId(e.target.value)}
                      required
                      disabled={!lookups}
                    >
                      <option value="">—</option>
                      {(lookups?.purposes || []).map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                    <label htmlFor="hub-vessel">{t('formVesselRequired')}</label>
                    <input
                      id="hub-vessel"
                      maxLength={MAX_SI_VESSEL_NAME_CHARS}
                      value={formVessel}
                      onChange={(e) => setFormVessel(e.target.value)}
                      required
                    />
                  </div>
                  <div className="input-group">
                    <label htmlFor="hub-jetty">{t('formJettyOptional')}</label>
                    <select id="hub-jetty" value={formJettyId} onChange={(e) => setFormJettyId(e.target.value)}>
                      <option value="">—</option>
                      {(lookups?.jetties || []).map((j) => (
                        <option key={j.id} value={j.id}>{j.label || j.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group">
                    <label htmlFor="hub-eta">{t('formEtaRequiredLabel')}</label>
                    <input id="hub-eta" type="datetime-local" value={formEta} onChange={(e) => setFormEta(e.target.value)} required />
                  </div>
                  <div className="input-group">
                    <label htmlFor="hub-voyage">{t('formVoyageOptional')}</label>
                    <input
                      id="hub-voyage"
                      maxLength={MAX_SI_VOYAGE_CHARS}
                      value={formVoyageNo}
                      onChange={(e) => setFormVoyageNo(e.target.value)}
                      placeholder={t('formVoyagePlaceholder')}
                    />
                  </div>
                  <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                    <label htmlFor="hub-agent">{t('formAgentOptional')}</label>
                    <select id="hub-agent" value={formAgentId} onChange={(e) => setFormAgentId(e.target.value)} disabled={!lookups}>
                      <option value="">—</option>
                      {(lookups?.agents || []).map((a) => (
                        <option key={a.id} value={a.id}>{a.label || a.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <div className="modal__footer">
                <button type="button" className="btn btn--secondary" onClick={() => setEditOpen(false)}>{t('cancel')}</button>
                <button type="submit" className="btn btn--primary">{t('save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
