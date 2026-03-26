import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useActivityLog } from '../context/ActivityLogContext'
import { useRbac } from '../context/RbacContext'
import { createSiLookupItem, deleteSiLookupItem, fetchSiLookupList, updateSiLookupItem } from '../api/siLookupCrud'
import '../styles/allocation.css'
import '../styles/modal.css'

function normalizeValue(type, raw) {
  const v = (raw || '').trim()
  if (!v) return ''
  // Keep trade-term codes consistently normalized (backend uppercases).
  return type === 'trade-terms' ? v.toUpperCase() : v
}

export default function MasterSiLookup({
  apiType,
  title,
  valueLabel,
  placeholder,
  pageKey,
  // Whether to show delete button (ports master pages currently only add/edit, but we include delete for full CRUD).
  showDelete = true,
}) {
  const { logActivity } = useActivityLog()
  const { canEdit, canDelete } = useRbac()

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formValue, setFormValue] = useState('')

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

  const openAdd = useCallback(() => {
    setEditingId(null)
    setFormValue('')
    setModalOpen(true)
  }, [])

  const openEdit = useCallback((item) => {
    setEditingId(item.id)
    setFormValue(item.value ?? '')
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEditingId(null)
    setFormValue('')
  }, [])

  const canDoEdit = canEdit(pageKey)
  const canDoDelete = canDelete(pageKey)

  const handleSubmit = useCallback(async () => {
    const value = normalizeValue(apiType, formValue)
    if (!value) return
    setSaving(true)
    setError(null)
    try {
      if (editingId != null) {
        await updateSiLookupItem(apiType, editingId, { value })
        logActivity({
          pageKey,
          action: 'update',
          entityType: title,
          entityLabel: value,
        })
      } else {
        await createSiLookupItem(apiType, { value })
        logActivity({
          pageKey,
          action: 'add',
          entityType: title,
          entityLabel: value,
        })
      }
      await load()
      closeModal()
    } catch (e) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [apiType, formValue, editingId, load, closeModal, logActivity, pageKey, title])

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
      <p className="allocation-page__intro">Manage SI master dropdown values (live API).</p>
      <p className="text-steel" style={{ fontSize: 'var(--font-size-small)' }}>
        <Link to="/master" className="link">← Back to Master Menu</Link>
      </p>
      {error && (
        <p className="allocation-page__intro" style={{ color: 'var(--color-danger, #c00)' }} role="alert">
          {error}
        </p>
      )}

      <section className="card at-berth-list-section">
        <div className="card__header-row">
          <h2 className="card__title">{valueLabel}</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={load}
              disabled={loading}
            >
              Refresh
            </button>
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
        <div className="modal-overlay" onClick={closeModal} aria-hidden="true">
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

