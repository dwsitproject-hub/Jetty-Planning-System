import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useActivityLog } from '../context/ActivityLogContext'
import { useRbac } from '../context/RbacContext'
import { createSiLookupItem, deleteSiLookupItem, fetchSiLookupList, updateSiLookupItem } from '../api/siLookupCrud'
import '../styles/allocation.css'
import '../styles/modal.css'

const RATE_METRIC_OPTIONS = [
  { value: 'KLPH', label: 'KLPH' },
  { value: 'MTPH', label: 'MTPH' },
  { value: 'MTPD', label: 'MTPD' },
]

function normalizeValue(type, raw) {
  const v = (raw || '').trim()
  if (!v) return ''
  return type === 'trade-terms' ? v.toUpperCase() : v
}

export default function MasterSiLookup({
  apiType,
  title,
  valueLabel,
  placeholder,
  pageKey,
  showDelete = true,
  enableStandardRateFields = false,
}) {
  const { logActivity } = useActivityLog()
  const { canEdit, canDelete } = useRbac()

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null) // { message, variant }

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formValue, setFormValue] = useState('')
  const [formLoadingRate, setFormLoadingRate] = useState('')
  const [formLoadingMetric, setFormLoadingMetric] = useState('MTPH')
  const [formClearLoadingRate, setFormClearLoadingRate] = useState(false)
  const [editingHadLoadingRate, setEditingHadLoadingRate] = useState(false)

  const [formUnloadingRate, setFormUnloadingRate] = useState('')
  const [formUnloadingMetric, setFormUnloadingMetric] = useState('MTPH')
  const [formClearUnloadingRate, setFormClearUnloadingRate] = useState(false)
  const [editingHadUnloadingRate, setEditingHadUnloadingRate] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const list = await fetchSiLookupList(apiType)
      setItems(Array.isArray(list) ? list : [])
    } catch (e) {
      setItems([])
      setError(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [apiType])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!toast?.message) return undefined
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const openAdd = useCallback(() => {
    setEditingId(null)
    setFormValue('')
    setFormLoadingRate('')
    setFormLoadingMetric('MTPH')
    setFormClearLoadingRate(false)
    setEditingHadLoadingRate(false)
    setFormUnloadingRate('')
    setFormUnloadingMetric('MTPH')
    setFormClearUnloadingRate(false)
    setEditingHadUnloadingRate(false)
    setModalOpen(true)
  }, [])

  const openEdit = useCallback((item) => {
    setEditingId(item.id)
    setFormValue(item.value ?? '')
    const lr = item?.portRates?.loading ?? null
    const ur = item?.portRates?.unloading ?? null

    setEditingHadLoadingRate(Boolean(lr))
    setFormLoadingRate(lr != null ? String(lr.rate ?? '') : '')
    setFormLoadingMetric(lr != null ? (lr.rateMetric || 'MTPH') : 'MTPH')
    setFormClearLoadingRate(false)

    setEditingHadUnloadingRate(Boolean(ur))
    setFormUnloadingRate(ur != null ? String(ur.rate ?? '') : '')
    setFormUnloadingMetric(ur != null ? (ur.rateMetric || 'MTPH') : 'MTPH')
    setFormClearUnloadingRate(false)

    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEditingId(null)
    setFormValue('')
    setFormLoadingRate('')
    setFormLoadingMetric('MTPH')
    setFormClearLoadingRate(false)
    setEditingHadLoadingRate(false)
    setFormUnloadingRate('')
    setFormUnloadingMetric('MTPH')
    setFormClearUnloadingRate(false)
    setEditingHadUnloadingRate(false)
  }, [])

  const canDoEdit = canEdit(pageKey)
  const canDoDelete = canDelete(pageKey)

  const handleSubmit = useCallback(async () => {
    const value = normalizeValue(apiType, formValue)
    if (!value) return

    if (enableStandardRateFields) {
      if (formClearLoadingRate && editingId == null) {
        setError('Clear loading rate is only available when editing an existing commodity.')
        return
      }
      if (formClearUnloadingRate && editingId == null) {
        setError('Clear unloading rate is only available when editing an existing commodity.')
        return
      }

      if (!formClearLoadingRate && formLoadingRate.trim() !== '') {
        const r = Number(formLoadingRate)
        if (Number.isNaN(r) || r < 0) {
          setError('Loading rate must be a non-negative number.')
          return
        }
        if (!RATE_METRIC_OPTIONS.some((o) => o.value === formLoadingMetric)) {
          setError('Select a valid loading metric (KLPH, MTPH, MTPD).')
          return
        }
      }

      if (!formClearUnloadingRate && formUnloadingRate.trim() !== '') {
        const r = Number(formUnloadingRate)
        if (Number.isNaN(r) || r < 0) {
          setError('Unloading rate must be a non-negative number.')
          return
        }
        if (!RATE_METRIC_OPTIONS.some((o) => o.value === formUnloadingMetric)) {
          setError('Select a valid unloading metric (KLPH, MTPH, MTPD).')
          return
        }
      }
    }

    setSaving(true)
    setError(null)
    try {
      const payload = { value }
      if (enableStandardRateFields) {
        if (formClearLoadingRate) {
          payload.clearLoadingRate = true
        } else if (formLoadingRate.trim() !== '') {
          payload.loadingRate = Number(formLoadingRate)
          payload.loadingRateMetric = formLoadingMetric
        }

        if (formClearUnloadingRate) {
          payload.clearUnloadingRate = true
        } else if (formUnloadingRate.trim() !== '') {
          payload.unloadingRate = Number(formUnloadingRate)
          payload.unloadingRateMetric = formUnloadingMetric
        }
      }

      if (editingId != null) {
        await updateSiLookupItem(apiType, editingId, payload)
        logActivity({
          pageKey,
          action: 'update',
          entityType: title,
          entityLabel: value,
        })
        setToast({ message: `Saved ${valueLabel} "${value}"`, variant: 'success' })
      } else {
        await createSiLookupItem(apiType, payload)
        logActivity({
          pageKey,
          action: 'add',
          entityType: title,
          entityLabel: value,
        })
        setToast({ message: `Added ${valueLabel} "${value}"`, variant: 'success' })
      }
      await load()
      closeModal()
    } catch (e) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [
    apiType,
    formValue,
    editingId,
    load,
    closeModal,
    logActivity,
    pageKey,
    title,
    enableStandardRateFields,
    formLoadingRate,
    formLoadingMetric,
    formClearLoadingRate,
    formUnloadingRate,
    formUnloadingMetric,
    formClearUnloadingRate,
    valueLabel,
  ])

  const handleDelete = useCallback(
    async (item) => {
      if (!showDelete) return
      if (!canDoDelete) return
      // eslint-disable-next-line no-alert
      const ok = window.confirm(`Delete ${valueLabel} "${item.value}"? This is a soft delete.`)
      if (!ok) return

      setDeleting(true)
      setError(null)
      try {
        await deleteSiLookupItem(apiType, item.id)
        logActivity({
          pageKey,
          action: 'delete',
          entityType: title,
          entityLabel: item.value ?? String(item.id),
        })
        setToast({ message: `Deleted ${valueLabel} "${item.value ?? String(item.id)}"`, variant: 'success' })
        await load()
      } catch (e) {
        setError(e?.message || 'Delete failed')
      } finally {
        setDeleting(false)
      }
    },
    [showDelete, canDoDelete, apiType, valueLabel, load, logActivity, pageKey, title],
  )

  return (
    <div className="allocation-page">
      <h1 className="page-title">{title}</h1>
      <p className="text-steel" style={{ fontSize: 'var(--font-size-small)' }}>
        <Link to="/master" className="link">← Back to Master Menu</Link>
      </p>
      {error && (
        <p className="allocation-page__intro" style={{ color: 'var(--color-danger, #c00)' }} role="alert">
          {error}
        </p>
      )}
      {toast?.message && (
        <div
          className={`toast ${toast.variant === 'error' ? 'toast--warning' : 'toast--success'}`}
          role={toast.variant === 'error' ? 'alert' : 'status'}
          aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          <span className="toast__icon" aria-hidden>{toast.variant === 'error' ? '!' : '✓'}</span>
          <p className="toast__message">{toast.message}</p>
          <button type="button" className="toast__close" onClick={() => setToast(null)} aria-label="Dismiss notification">
            ×
          </button>
        </div>
      )}

      <section className="card at-berth-list-section">
        <div className="card__header-row">
          <h2 className="card__title">{valueLabel}</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn--primary"
              onClick={openAdd}
              disabled={!canDoEdit || loading}
              title={!canDoEdit ? 'You do not have edit permission for this master page.' : ''}
            >
              Add {valueLabel}
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-steel">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-steel">No entries. Click Add {valueLabel} to add one.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table allocation-table">
              <thead>
                <tr>
                  <th>{valueLabel}</th>
                  {enableStandardRateFields && (
                    <>
                      <th>Loading rate</th>
                      <th>Loading metric</th>
                      <th>Unloading rate</th>
                      <th>Unloading metric</th>
                    </>
                  )}
                  <th>Sort order</th>
                  <th className="allocation-table__action-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="allocation-table__row">
                    <td>
                      <strong>{it.value ?? '—'}</strong>
                    </td>
                    {enableStandardRateFields && (
                      <>
                        <td>{it?.portRates?.loading != null ? it.portRates.loading.rate : '—'}</td>
                        <td>{it?.portRates?.loading != null ? it.portRates.loading.rateMetric : '—'}</td>
                        <td>{it?.portRates?.unloading != null ? it.portRates.unloading.rate : '—'}</td>
                        <td>{it?.portRates?.unloading != null ? it.portRates.unloading.rateMetric : '—'}</td>
                      </>
                    )}
                    <td>{it.sortOrder ?? '—'}</td>
                    <td className="allocation-table__action-col">
                      <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                        <button
                          type="button"
                          className="btn btn--small btn--secondary"
                          onClick={() => openEdit(it)}
                          disabled={!canDoEdit}
                          title={!canDoEdit ? 'Edit permission required.' : ''}
                        >
                          Edit
                        </button>
                        {showDelete && (
                          <button
                            type="button"
                            className="btn btn--small btn--secondary"
                            onClick={() => handleDelete(it)}
                            disabled={!canDoDelete || deleting}
                            title={!canDoDelete ? 'Delete permission required.' : ''}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div
            className="modal modal--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2 className="modal__title">{editingId != null ? `Edit ${valueLabel}` : `Add ${valueLabel}`}</h2>
            <div className="modal__section">
              <label htmlFor="si-lookup-value" className="modal__label">
                {valueLabel}
              </label>
              <input
                id="si-lookup-value"
                type="text"
                className="modal__input"
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
                placeholder={placeholder}
                disabled={!canDoEdit}
              />
            </div>
            {enableStandardRateFields && (
              <>
                <div className="modal__section">
                  <label htmlFor="si-commodity-loading-rate" className="modal__label">
                    Loading rate <span className="text-steel">— optional; numeric value only</span>
                  </label>
                  <input
                    id="si-commodity-loading-rate"
                    type="number"
                    min={0}
                    step="any"
                    className="modal__input"
                    value={formLoadingRate}
                    onChange={(e) => {
                      setFormLoadingRate(e.target.value)
                      if (e.target.value.trim() !== '') setFormClearLoadingRate(false)
                    }}
                    placeholder="e.g. 350"
                    disabled={!canDoEdit || formClearLoadingRate}
                  />
                </div>
                <div className="modal__section">
                  <label htmlFor="si-commodity-loading-metric" className="modal__label">
                    Loading metric
                  </label>
                  <select
                    id="si-commodity-loading-metric"
                    className="modal__input"
                    value={formLoadingMetric}
                    onChange={(e) => setFormLoadingMetric(e.target.value)}
                    disabled={!canDoEdit || formClearLoadingRate}
                  >
                    {RATE_METRIC_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                {editingId != null && editingHadLoadingRate && (
                  <div className="modal__section">
                    <label className="modal__label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="checkbox"
                        checked={formClearLoadingRate}
                        onChange={(e) => setFormClearLoadingRate(e.target.checked)}
                        disabled={!canDoEdit}
                      />
                      Clear loading rate
                    </label>
                  </div>
                )}

                <div className="modal__section">
                  <label htmlFor="si-commodity-unloading-rate" className="modal__label">
                    Unloading rate <span className="text-steel">— optional; numeric value only</span>
                  </label>
                  <input
                    id="si-commodity-unloading-rate"
                    type="number"
                    min={0}
                    step="any"
                    className="modal__input"
                    value={formUnloadingRate}
                    onChange={(e) => {
                      setFormUnloadingRate(e.target.value)
                      if (e.target.value.trim() !== '') setFormClearUnloadingRate(false)
                    }}
                    placeholder="e.g. 350"
                    disabled={!canDoEdit || formClearUnloadingRate}
                  />
                </div>
                <div className="modal__section">
                  <label htmlFor="si-commodity-unloading-metric" className="modal__label">
                    Unloading metric
                  </label>
                  <select
                    id="si-commodity-unloading-metric"
                    className="modal__input"
                    value={formUnloadingMetric}
                    onChange={(e) => setFormUnloadingMetric(e.target.value)}
                    disabled={!canDoEdit || formClearUnloadingRate}
                  >
                    {RATE_METRIC_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                {editingId != null && editingHadUnloadingRate && (
                  <div className="modal__section">
                    <label className="modal__label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="checkbox"
                        checked={formClearUnloadingRate}
                        onChange={(e) => setFormClearUnloadingRate(e.target.checked)}
                        disabled={!canDoEdit}
                      />
                      Clear unloading rate
                    </label>
                  </div>
                )}
              </>
            )}
            <div className="modal__footer">
              <button type="button" className="btn btn--secondary" onClick={closeModal} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleSubmit}
                disabled={saving || !canDoEdit}
              >
                {saving ? 'Saving…' : editingId != null ? 'Save' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
