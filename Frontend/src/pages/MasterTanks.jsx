import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchPorts } from '../api/ports'
import {
  createMasterTank,
  deleteMasterTank,
  downloadMasterTanksTemplate,
  fetchMasterTanks,
  importMasterTanksCsv,
  updateMasterTank,
} from '../api/masterTanks'
import { useActivityLog } from '../context/ActivityLogContext'
import { useRbac } from '../context/RbacContext'
import '../styles/allocation.css'
import '../styles/modal.css'
import SortableFilterableTableHead from '../components/SortableFilterableTableHead.jsx'
import { useSortableFilterableRows } from '../hooks/useSortableFilterableRows.js'

const PAGE_KEY = 'master-tanks'

const TANK_COLUMNS = [
  {
    key: 'code',
    label: 'Code',
    getSortValue: (t) => (t.code || '').toLowerCase(),
  },
  {
    key: 'name',
    label: 'Name',
    getSortValue: (t) => (t.name || '').toLowerCase(),
    getFilterValue: (t) => t.name || '',
  },
  {
    key: 'description',
    label: 'Description',
    getSortValue: (t) => (t.description || '').toLowerCase(),
    getFilterValue: (t) => t.description || '',
  },
]

export default function MasterTanks() {
  const { t } = useTranslation('pages')
  const { logActivity } = useActivityLog()
  const { canEdit, canDelete } = useRbac()
  const canDoEdit = canEdit(PAGE_KEY)
  const canDoDelete = canDelete(PAGE_KEY)
  const fileInputRef = useRef(null)

  const [ports, setPorts] = useState([])
  const [portId, setPortId] = useState('')
  const [tanks, setTanks] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const [importErrors, setImportErrors] = useState([])

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formCode, setFormCode] = useState('')
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')

  const loadPorts = useCallback(async () => {
    try {
      const list = await fetchPorts()
      const arr = Array.isArray(list) ? list : []
      setPorts(arr)
      setPortId((prev) => {
        if (prev && arr.some((p) => String(p.id) === String(prev))) return prev
        return arr[0] ? String(arr[0].id) : ''
      })
    } catch (e) {
      setPorts([])
      setError(e?.message || 'Failed to load ports')
    }
  }, [])

  const loadTanks = useCallback(async () => {
    if (!portId) {
      setTanks([])
      setLoading(false)
      return
    }
    setError(null)
    setLoading(true)
    try {
      const list = await fetchMasterTanks(portId)
      setTanks(Array.isArray(list) ? list : [])
    } catch (e) {
      setTanks([])
      setError(e?.message || 'Failed to load tanks')
    } finally {
      setLoading(false)
    }
  }, [portId])

  useEffect(() => {
    loadPorts()
  }, [loadPorts])

  useEffect(() => {
    loadTanks()
  }, [loadTanks])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 5500)
    return () => window.clearTimeout(timer)
  }, [toast])

  const openAdd = useCallback(() => {
    setEditingId(null)
    setFormCode('')
    setFormName('')
    setFormDescription('')
    setModalOpen(true)
  }, [])

  const openEdit = useCallback((tank) => {
    setEditingId(tank.id)
    setFormCode(tank.code || '')
    setFormName(tank.name || '')
    setFormDescription(tank.description || '')
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEditingId(null)
    setFormCode('')
    setFormName('')
    setFormDescription('')
  }, [])

  const handleSubmit = useCallback(async () => {
    const code = (formCode || '').trim()
    if (!code || !portId) return
    setSaving(true)
    setError(null)
    try {
      if (editingId != null) {
        await updateMasterTank(editingId, {
          code,
          name: (formName || '').trim() || null,
          description: (formDescription || '').trim() || null,
        })
        logActivity({ pageKey: PAGE_KEY, action: 'update', entityType: 'Tank', entityLabel: code })
        setToast({ message: `Tank saved: ${code}.`, variant: 'success' })
      } else {
        await createMasterTank({
          portId: Number(portId),
          code,
          name: (formName || '').trim() || null,
          description: (formDescription || '').trim() || null,
        })
        logActivity({ pageKey: PAGE_KEY, action: 'add', entityType: 'Tank', entityLabel: code })
        setToast({ message: `Tank added: ${code}.`, variant: 'success' })
      }
      await loadTanks()
      closeModal()
    } catch (e) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [editingId, formCode, formName, formDescription, portId, closeModal, logActivity, loadTanks])

  const handleDelete = useCallback(
    async (tank) => {
      if (!canDoDelete || !tank?.id) return
      const label = tank.code || `Tank #${tank.id}`
      // eslint-disable-next-line no-alert
      const ok = window.confirm(`Are you sure you want to delete tank "${label}"?`)
      if (!ok) return
      setDeleting(true)
      setError(null)
      try {
        await deleteMasterTank(tank.id)
        logActivity({
          pageKey: PAGE_KEY,
          action: 'delete',
          entityType: 'Tank',
          entityLabel: label,
        })
        setToast({ message: `Deleted tank "${label}".`, variant: 'success' })
        await loadTanks()
      } catch (e) {
        setError(e?.message || 'Delete failed')
      } finally {
        setDeleting(false)
      }
    },
    [canDoDelete, logActivity, loadTanks]
  )

  const handleImportFile = useCallback(
    async (e) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      setImporting(true)
      setError(null)
      setImportErrors([])
      try {
        const result = await importMasterTanksCsv(file)
        const created = Number(result?.created || 0)
        const updated = Number(result?.updated || 0)
        const errors = Array.isArray(result?.errors) ? result.errors : []
        setImportErrors(errors)
        logActivity({
          pageKey: PAGE_KEY,
          action: 'import',
          entityType: 'Tank',
          entityLabel: file.name,
        })
        setToast({
          message: `CSV import finished: ${created} created, ${updated} updated${errors.length ? `, ${errors.length} row error(s)` : ''}.`,
          variant: errors.length ? 'warning' : 'success',
        })
        await loadTanks()
      } catch (err) {
        setError(err?.message || 'CSV import failed')
      } finally {
        setImporting(false)
      }
    },
    [logActivity, loadTanks]
  )

  const { displayRows, filters, updateFilter, sortState, handleSort } = useSortableFilterableRows(
    tanks,
    TANK_COLUMNS,
    { key: 'code', dir: 'asc' }
  )

  const portOptions = useMemo(
    () => ports.map((p) => ({ value: String(p.id), label: p.name || `Port #${p.id}` })),
    [ports]
  )

  return (
    <div className="allocation-page">
      <h1 className="page-title">{t('masterHubTanksTitle')}</h1>
      <p className="allocation-page__intro">{t('masterHubTanksDesc')}</p>
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
          style={{
            color:
              toast.variant === 'success'
                ? 'var(--color-success, #0a7)'
                : toast.variant === 'warning'
                  ? 'var(--color-warning, #b8860b)'
                  : 'var(--color-danger, #c00)',
          }}
          role="status"
        >
          {toast.message}
        </p>
      )}

      {importErrors.length > 0 ? (
        <section className="card" style={{ marginBottom: '1rem' }}>
          <h2 className="card__title">CSV import errors</h2>
          <ul className="text-steel" style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {importErrors.slice(0, 50).map((err, i) => (
              <li key={`${err.row}-${i}`}>
                Row {err.row}: {err.message}
              </li>
            ))}
          </ul>
          {importErrors.length > 50 ? (
            <p className="text-steel">…and {importErrors.length - 50} more</p>
          ) : null}
        </section>
      ) : null}

      <section className="card at-berth-list-section">
        <div className="card__header-row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <h2 className="card__title">Shore tanks</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="text-steel" htmlFor="master-tanks-port" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              Port
              <select
                id="master-tanks-port"
                className="berthing-modal__input"
                value={portId}
                onChange={(e) => setPortId(e.target.value)}
                style={{ minWidth: 180 }}
              >
                {portOptions.length === 0 ? <option value="">No ports</option> : null}
                {portOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn--secondary btn--small" onClick={() => loadTanks()} disabled={loading || !portId}>
              Refresh
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => downloadMasterTanksTemplate().catch((e) => setError(e?.message || 'Template download failed'))}
              disabled={!canDoEdit}
            >
              Download CSV template
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => fileInputRef.current?.click()}
              disabled={!canDoEdit || importing}
            >
              {importing ? 'Importing…' : 'Import CSV'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={handleImportFile}
            />
            <button type="button" className="btn btn--primary" onClick={openAdd} disabled={!canDoEdit || !portId}>
              Add Tank
            </button>
          </div>
        </div>
        {loading ? (
          <p className="text-steel">Loading tanks…</p>
        ) : !portId ? (
          <p className="text-steel">Select a port to view tanks.</p>
        ) : tanks.length === 0 ? (
          <p className="text-steel">No tanks for this port. Click Add Tank or Import CSV.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table allocation-table">
              <thead>
                <SortableFilterableTableHead
                  columns={TANK_COLUMNS}
                  sortState={sortState}
                  onSort={handleSort}
                  filters={filters}
                  onFilterChange={updateFilter}
                  trailingBlankCols={1}
                />
              </thead>
              <tbody>
                {displayRows.map((tank) => (
                  <tr key={tank.id} className="allocation-table__row">
                    <td><strong>{tank.code || '—'}</strong></td>
                    <td>{tank.name || '—'}</td>
                    <td>
                      {tank.description
                        ? tank.description.length > 60
                          ? `${tank.description.slice(0, 60)}…`
                          : tank.description
                        : '—'}
                    </td>
                    <td className="allocation-table__action-col">
                      <div className="allocation-table__action-btns">
                        <button
                          type="button"
                          className="btn btn--small btn--secondary"
                          onClick={() => openEdit(tank)}
                          disabled={!canDoEdit}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn--small btn--secondary"
                          onClick={() => handleDelete(tank)}
                          disabled={!canDoDelete || deleting}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {displayRows.length === 0 && (
              <p className="text-steel" style={{ marginTop: 'var(--spacing-3)' }}>
                No entries match the current filters.
              </p>
            )}
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="modal-overlay" role="presentation" onClick={closeModal}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="master-tank-modal-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="master-tank-modal-title" className="modal__title">
              {editingId != null ? 'Edit Tank' : 'Add Tank'}
            </h2>
            <div className="modal__body">
              <div className="modal__field">
                <label className="modal__label" htmlFor="master-tank-code">Code (required)</label>
                <input
                  id="master-tank-code"
                  className="modal__input"
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value)}
                  placeholder="e.g. 5104"
                  autoComplete="off"
                />
              </div>
              <div className="modal__field">
                <label className="modal__label" htmlFor="master-tank-name">Name (optional)</label>
                <input
                  id="master-tank-name"
                  className="modal__input"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="modal__field">
                <label className="modal__label" htmlFor="master-tank-desc">Description (optional)</label>
                <textarea
                  id="master-tank-desc"
                  className="modal__input"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <div className="modal__actions">
              <button type="button" className="btn btn--secondary" onClick={closeModal} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleSubmit}
                disabled={saving || !(formCode || '').trim()}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
