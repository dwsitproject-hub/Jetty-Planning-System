import { useState, useCallback, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { fetchPorts, createPort, updatePortApi, deletePort } from '../api/ports'
import { useActivityLog } from '../context/ActivityLogContext'
import { useRbac } from '../context/RbacContext'
import '../styles/allocation.css'
import '../styles/modal.css'
import { MAX_MASTER_DESCRIPTION_CHARS, MAX_MASTER_PORT_NAME_CHARS } from '../constants/inputLimits'
import { DEFAULT_SCHEDULE_TIMEZONE } from '../utils/scheduleDateTime.js'
import { getIanaTimeZoneOptions, mergeTimezoneOptionsWithOrphan } from '../utils/ianaTimeZoneOptions.js'
import SearchableSingleSelect from '../components/SearchableSingleSelect.jsx'

const PAGE_KEY = 'master-port'

export default function MasterPort() {
  const { logActivity } = useActivityLog()
  const { canEdit, canDelete } = useRbac()
  const canDoEdit = canEdit(PAGE_KEY)
  const canDoDelete = canDelete(PAGE_KEY)
  const [ports, setPorts] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)

  const loadPorts = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const list = await fetchPorts()
      setPorts(Array.isArray(list) ? list : [])
    } catch (e) {
      setPorts([])
      setError(e?.message || 'Failed to load ports')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPorts()
  }, [loadPorts])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 5500)
    return () => window.clearTimeout(timer)
  }, [toast])

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formScheduleTimezone, setFormScheduleTimezone] = useState(DEFAULT_SCHEDULE_TIMEZONE)

  const openAdd = useCallback(() => {
    setEditingId(null)
    setFormName('')
    setFormDescription('')
    setFormScheduleTimezone(DEFAULT_SCHEDULE_TIMEZONE)
    setModalOpen(true)
  }, [])

  const openEdit = useCallback((port) => {
    setEditingId(port.id)
    setFormName(port.name || '')
    setFormDescription(port.description ?? '')
    setFormScheduleTimezone(port.scheduleTimezone || DEFAULT_SCHEDULE_TIMEZONE)
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEditingId(null)
    setFormName('')
    setFormDescription('')
    setFormScheduleTimezone(DEFAULT_SCHEDULE_TIMEZONE)
  }, [])

  const handleSubmit = useCallback(async () => {
    const name = (formName || '').trim()
    if (!name) return
    setSaving(true)
    setError(null)
    try {
      if (editingId != null) {
        await updatePortApi(editingId, {
          name,
          description: (formDescription || '').trim() || null,
          scheduleTimezone: (formScheduleTimezone || '').trim() || DEFAULT_SCHEDULE_TIMEZONE,
        })
        logActivity({ pageKey: PAGE_KEY, action: 'update', entityType: 'Port', entityLabel: name })
        setToast({ message: `Port saved: ${name}.`, variant: 'success' })
      } else {
        await createPort({
          name,
          description: (formDescription || '').trim() || null,
          scheduleTimezone: (formScheduleTimezone || '').trim() || DEFAULT_SCHEDULE_TIMEZONE,
        })
        logActivity({ pageKey: PAGE_KEY, action: 'add', entityType: 'Port', entityLabel: name })
        setToast({ message: `Port added: ${name}.`, variant: 'success' })
      }
      await loadPorts()
      closeModal()
    } catch (e) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [editingId, formName, formDescription, formScheduleTimezone, closeModal, logActivity, loadPorts])

  const handleDelete = useCallback(
    async (port) => {
      if (!canDoDelete || !port?.id) return
      const label = port.name || `Port #${port.id}`
      // eslint-disable-next-line no-alert
      const ok = window.confirm(`Are you sure you want to delete port "${label}"?`)
      if (!ok) return

      setDeleting(true)
      setError(null)
      try {
        await deletePort(port.id)
        logActivity({
          pageKey: PAGE_KEY,
          action: 'delete',
          entityType: 'Port',
          entityLabel: label,
        })
        setToast({ message: `Deleted port "${label}".`, variant: 'success' })
        await loadPorts()
      } catch (e) {
        setError(e?.message || 'Delete failed')
      } finally {
        setDeleting(false)
      }
    },
    [canDoDelete, logActivity, loadPorts]
  )

  const timezoneSelectOptions = useMemo(
    () => mergeTimezoneOptionsWithOrphan(formScheduleTimezone, getIanaTimeZoneOptions()),
    [formScheduleTimezone]
  )

  return (
    <div className="allocation-page">
      <h1 className="page-title">Master – Port</h1>
      <p className="allocation-page__intro">
        Add and manage master port / site data.
      </p>
      <p className="text-steel">
        <Link to="/master" className="link">← Back to Master Menu</Link>
      </p>

      {error && (
        <p className="allocation-page__intro" style={{ color: 'var(--color-danger, #c00)' }} role="alert">
          {error}
        </p>
      )}

      {toast && (
        <p
          className="allocation-page__intro"
          style={{ color: toast.variant === 'success' ? 'var(--color-success, #0a7)' : 'var(--color-danger, #c00)' }}
          role="status"
        >
          {toast.message}
        </p>
      )}

      <section className="card at-berth-list-section">
        <div className="card__header-row">
          <h2 className="card__title">Ports</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => loadPorts()}
              disabled={loading}
            >
              Refresh
            </button>
            <button type="button" className="btn btn--primary" onClick={openAdd} disabled={!canDoEdit}>
              Add Port
            </button>
          </div>
        </div>
        {loading ? (
          <p className="text-steel">Loading ports…</p>
        ) : ports.length === 0 ? (
          <p className="text-steel">No ports. Click Add Port to add one.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table allocation-table">
              <thead>
                <tr>
                  <th className="allocation-table__th">Port Name</th>
                  <th className="allocation-table__th">Schedule TZ</th>
                  <th className="allocation-table__th">Description</th>
                  <th className="allocation-table__action-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {ports.map((p) => (
                  <tr key={p.id} className="allocation-table__row">
                    <td><strong>{p.name || '—'}</strong></td>
                    <td className="text-steel">{p.scheduleTimezone || DEFAULT_SCHEDULE_TIMEZONE}</td>
                    <td>
                      {p.description
                        ? p.description.length > 60
                          ? `${p.description.slice(0, 60)}…`
                          : p.description
                        : '—'}
                    </td>
                    <td className="allocation-table__action-col">
                      <div className="allocation-table__action-btns">
                        <button
                          type="button"
                          className="btn btn--small btn--secondary"
                          onClick={() => openEdit(p)}
                          disabled={!canDoEdit}
                          title={!canDoEdit ? 'Edit permission required.' : ''}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn--small btn--secondary"
                          onClick={() => handleDelete(p)}
                          disabled={!canDoDelete || deleting}
                          title={!canDoDelete ? 'Delete permission required.' : ''}
                        >
                          Delete
                        </button>
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
            aria-labelledby="port-modal-title"
            aria-modal="true"
          >
            <h2 id="port-modal-title" className="modal__title">
              {editingId != null ? 'Edit Port' : 'Add Port'}
            </h2>
            <div className="modal__section">
              <label htmlFor="port-name" className="modal__label">Port Name</label>
              <input
                id="port-name"
                type="text"
                className="modal__input"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                maxLength={MAX_MASTER_PORT_NAME_CHARS}
                placeholder="e.g. Bontang"
              />
            </div>
            <div className="modal__section">
              <SearchableSingleSelect
                id="port-schedule-tz"
                label="Schedule timezone (IANA)"
                options={timezoneSelectOptions}
                value={formScheduleTimezone}
                onChange={setFormScheduleTimezone}
                placeholder="Select timezone…"
                disabled={saving}
              />
            </div>
            <div className="modal__section">
              <label htmlFor="port-description" className="modal__label">Description</label>
              <textarea
                id="port-description"
                className="modal__input modal__textarea"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                maxLength={MAX_MASTER_DESCRIPTION_CHARS}
                placeholder="Optional description"
                rows={4}
              />
            </div>
            <div className="modal__footer">
              <button type="button" className="btn btn--secondary" onClick={closeModal} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={handleSubmit} disabled={saving}>
                {saving ? 'Saving…' : editingId != null ? 'Save' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
