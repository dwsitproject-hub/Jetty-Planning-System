/**
 * Vessel Information modal — opened by clicking a vessel name on Shipment plans,
 * Allocation & Berthing, At-Berth Executions, and Clearance.
 * Shows / edits the plan-level vessel attributes (name, capacity MT, LOA, GT, draft);
 * Vessel DWT is derived (GT + capacity) and read-only.
 * Saving uses PATCH /shipment-plans/:id/vessel-info (allowed in any approval status).
 */
import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchShipmentPlan, updateShipmentPlanVesselInfo } from '../api/shipmentPlans'
import { useRbac } from '../context/RbacContext'
import '../styles/modal.css'

/** Inline link-styled button for vessel names in tables. */
export function VesselNameButton({ name, onClick, strong = false }) {
  const label = name || '—'
  if (!name || typeof onClick !== 'function') {
    return strong ? <strong>{label}</strong> : <>{label}</>
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title="View vessel information"
      style={{
        background: 'none',
        border: 0,
        padding: 0,
        cursor: 'pointer',
        color: '#1d4ed8',
        textDecoration: 'underline',
        font: 'inherit',
        textAlign: 'left',
      }}
    >
      {strong ? <strong>{label}</strong> : label}
    </button>
  )
}

export default function VesselInfoModal({ planId, isOpen, onClose, onSaved }) {
  const { t } = useTranslation('shipmentPlan')
  const { canEdit } = useRbac()
  const allowEdit = canEdit('shipment-plan')

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [plan, setPlan] = useState(null)
  const [name, setName] = useState('')
  const [capacity, setCapacity] = useState('')
  const [loa, setLoa] = useState('')
  const [gt, setGt] = useState('')
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (!isOpen || planId == null) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setPlan(null)
    fetchShipmentPlan(planId)
      .then((d) => {
        if (cancelled) return
        setPlan(d)
        setName(d.vesselName || '')
        setCapacity(d.vesselCapacity != null ? String(d.vesselCapacity) : '')
        setLoa(d.vesselLoaM != null ? String(d.vesselLoaM) : '')
        setGt(d.vesselGrossTonnage != null ? String(d.vesselGrossTonnage) : '')
        setDraft(d.vesselDraft != null ? String(d.vesselDraft) : '')
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || 'Failed to load vessel information')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, planId])

  const dwt = useMemo(() => {
    const g = Number(gt)
    const c = Number(capacity)
    if (!Number.isFinite(g) || g <= 0 || !Number.isFinite(c) || c <= 0) return null
    return g + c
  }, [gt, capacity])

  if (!isOpen) return null

  const numOk = (raw) => {
    const n = Number(raw)
    return raw != null && String(raw).trim() !== '' && Number.isFinite(n) && n > 0
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t('formVesselRequired'))
      return
    }
    const dims = [
      [t('formVesselCapacityRequired'), capacity],
      [t('formVesselLoaRequired'), loa],
      [t('formVesselGtRequired'), gt],
      [t('formVesselDraftRequired'), draft],
    ]
    for (const [label, raw] of dims) {
      if (!numOk(raw)) {
        setError(t('formVesselNumberFieldInvalid', { field: label }))
        return
      }
    }
    setSaving(true)
    setError(null)
    try {
      await updateShipmentPlanVesselInfo(planId, {
        vesselName: name.trim(),
        vesselCapacity: Number(capacity),
        vesselLoaM: Number(loa),
        vesselGrossTonnage: Number(gt),
        vesselDraft: Number(draft),
      })
      if (typeof onSaved === 'function') onSaved()
      onClose()
    } catch (e) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const numberField = (id, label, value, setValue) => (
    <div className="modal__section">
      <label className="modal__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="modal__input"
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={!allowEdit || loading}
        required
      />
    </div>
  )

  return (
    <div className="modal-overlay" onClick={onClose} aria-hidden="true">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="vessel-info-title">
        <h2 className="modal__title" id="vessel-info-title">
          {t('vesselInfoTitle')}
          {plan?.planReference ? ` — ${plan.planReference}` : ''}
        </h2>
        {loading ? <p className="text-steel">{t('vesselInfoLoading')}</p> : null}
        {error ? (
          <p role="alert" style={{ color: 'var(--color-danger, #c00)', margin: '0 0 0.5rem' }}>
            {error}
          </p>
        ) : null}
        {!loading && plan ? (
          <>
            <div className="modal__section">
              <label className="modal__label" htmlFor="vessel-info-name">
                {t('formVesselRequired')}
              </label>
              <input
                id="vessel-info-name"
                className="modal__input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!allowEdit}
                required
              />
            </div>
            {numberField('vessel-info-capacity', t('formVesselCapacityRequired'), capacity, setCapacity)}
            {numberField('vessel-info-loa', t('formVesselLoaRequired'), loa, setLoa)}
            {numberField('vessel-info-gt', t('formVesselGtRequired'), gt, setGt)}
            {numberField('vessel-info-draft', t('formVesselDraftRequired'), draft, setDraft)}
            <div className="modal__section">
              <label className="modal__label" htmlFor="vessel-info-dwt">
                {t('formVesselDwtAuto')}
              </label>
              <input
                id="vessel-info-dwt"
                className="modal__input"
                value={dwt != null ? dwt.toLocaleString('en-US') : '—'}
                readOnly
                title={t('formVesselDwtHint')}
              />
            </div>
            {!allowEdit ? (
              <p className="text-steel" style={{ fontSize: '0.85rem' }}>
                {t('vesselInfoReadOnly')}
              </p>
            ) : null}
          </>
        ) : null}
        <div className="modal__footer">
          <button type="button" className="btn btn--secondary" onClick={onClose} disabled={saving}>
            {t('vesselInfoClose')}
          </button>
          {allowEdit && plan ? (
            <button type="button" className="btn btn--primary" onClick={handleSave} disabled={saving || loading}>
              {saving ? t('vesselInfoSaving') : t('vesselInfoSave')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
