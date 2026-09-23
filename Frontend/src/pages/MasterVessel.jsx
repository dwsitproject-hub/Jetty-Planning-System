import { useState, useCallback, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchMasterVessels,
  createMasterVessel,
  updateMasterVesselApi,
  deleteMasterVessel,
  fetchSyncRuns,
  fetchSyncRun,
  startSyncRun,
  applySyncRun,
  discardSyncRun,
} from '../api/masterVessels'
import DataHubSyncReviewModal from '../components/DataHubSyncReviewModal.jsx'
import { useActivityLog } from '../context/ActivityLogContext'
import { useRbac } from '../context/RbacContext'
import '../styles/allocation.css'
import '../styles/modal.css'
import SortableFilterableTableHead from '../components/SortableFilterableTableHead.jsx'
import MasterTablePagination from '../components/MasterTablePagination.jsx'
import { useSortableFilterableRows } from '../hooks/useSortableFilterableRows.js'
import { useMasterTablePagination } from '../hooks/useMasterTablePagination.js'
import {
  formatMasterCreatedLine,
  formatMasterLastUpdatedLine,
  MASTER_AUDIT_COLUMNS,
} from '../utils/formatMasterAudit.js'

const PAGE_KEY = 'master-vessel'

/** Enums mirrored from the DataHub vessel contract. */
const VESSEL_TYPES = ['barge', 'tanker', 'SPOB']
const LAMBUNG_TYPES = [
  'Double hull Double Bottom',
  'Single hull Double Bottom',
  'Single hull Single Bottom',
]
const CHARTER_TYPES = ['Voyage Charter', 'Time Charter']

const text = (v) => (v || '').toLowerCase()

const VESSEL_COLUMNS = [
  { key: 'vesselName', label: 'Vessel Name', getSortValue: (v) => text(v.vesselName) },
  { key: 'hubCode', label: 'Hub Code', getSortValue: (v) => text(v.hubCode), getFilterValue: (v) => v.hubCode || '' },
  {
    key: 'vesselType',
    label: 'Type',
    filterType: 'select',
    selectOptions: VESSEL_TYPES,
    getSortValue: (v) => text(v.vesselType),
    getFilterValue: (v) => v.vesselType || '',
  },
  { key: 'vesselImo', label: 'IMO', getSortValue: (v) => text(v.vesselImo), getFilterValue: (v) => v.vesselImo || '' },
  { key: 'vesselMmsi', label: 'MMSI', getSortValue: (v) => text(v.vesselMmsi), getFilterValue: (v) => v.vesselMmsi || '' },
  { key: 'vesselCodeSap', label: 'SAP Code', getSortValue: (v) => text(v.vesselCodeSap), getFilterValue: (v) => v.vesselCodeSap || '' },
  { key: 'vesselGrossTonnage', label: 'GT', getSortValue: (v) => (v.vesselGrossTonnage ?? -1) },
  { key: 'vesselDraft', label: 'Draft (m)', getSortValue: (v) => (v.vesselDraft ?? -1) },
  { key: 'vesselLengthOverall', label: 'LOA', getSortValue: (v) => text(v.vesselLengthOverall) },
  {
    key: 'heater',
    label: 'Heater',
    filterType: 'select',
    selectOptions: ['Yes', 'No'],
    getSortValue: (v) => (v.heater ? 1 : 0),
    getFilterValue: (v) => (v.heater === true ? 'Yes' : v.heater === false ? 'No' : ''),
  },
  {
    key: 'typeLambung',
    label: 'Hull Type',
    filterType: 'select',
    selectOptions: LAMBUNG_TYPES,
    getSortValue: (v) => text(v.typeLambung),
    getFilterValue: (v) => v.typeLambung || '',
  },
  {
    key: 'typeCharter',
    label: 'Charter Type',
    filterType: 'select',
    selectOptions: CHARTER_TYPES,
    getSortValue: (v) => text(v.typeCharter),
    getFilterValue: (v) => v.typeCharter || '',
  },
  ...MASTER_AUDIT_COLUMNS,
]

function pushSaveToast(name, push) {
  if (!push || push.skipped) return { message: `Saved locally: ${name}.`, variant: 'success' }
  if (push.ok) {
    const code = push.code ? ` (${push.code})` : ''
    return { message: `Saved and pushed to DataHub${code}.`, variant: 'success' }
  }
  return {
    message: `Saved locally. DataHub push failed: ${push.error || 'unknown error'}`,
    variant: 'warning',
  }
}

const EMPTY_FORM = {
  vesselName: '',
  vesselImo: '',
  vesselMmsi: '',
  vesselCodeSap: '',
  vesselCapacityMt: '',
  vesselGrossTonnage: '',
  vesselDraft: '',
  vesselLengthOverall: '',
  vesselType: '',
  heater: false,
  typeLambung: '',
  typeCharter: '',
}

export default function MasterVessel() {
  const { logActivity } = useActivityLog()
  const { canEdit, canDelete } = useRbac()
  const canDoEdit = canEdit(PAGE_KEY)
  const canDoDelete = canDelete(PAGE_KEY)

  const [vessels, setVessels] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)

  const loadVessels = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const list = await fetchMasterVessels()
      setVessels(Array.isArray(list) ? list : [])
    } catch (e) {
      setVessels([])
      setError(e?.message || 'Failed to load vessels')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadVessels()
  }, [loadVessels])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 5500)
    return () => window.clearTimeout(timer)
  }, [toast])

  // --- add / edit -----------------------------------------------------------

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  const openAdd = useCallback(() => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }, [])

  const openEdit = useCallback((v) => {
    setEditingId(v.id)
    setForm({
      vesselName: v.vesselName || '',
      vesselImo: v.vesselImo ?? '',
      vesselMmsi: v.vesselMmsi ?? '',
      vesselCodeSap: v.vesselCodeSap ?? '',
      vesselCapacityMt: v.vesselCapacityMt ?? '',
      vesselGrossTonnage: v.vesselGrossTonnage ?? '',
      vesselDraft: v.vesselDraft ?? '',
      vesselLengthOverall: v.vesselLengthOverall ?? '',
      vesselType: v.vesselType ?? '',
      heater: v.heater === true,
      typeLambung: v.typeLambung ?? '',
      typeCharter: v.typeCharter ?? '',
    })
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }, [])

  const handleSubmit = useCallback(async () => {
    const name = (form.vesselName || '').trim()
    if (!name) return
    setSaving(true)
    setError(null)
    try {
      let resp
      if (editingId != null) {
        resp = await updateMasterVesselApi(editingId, form)
        logActivity({ pageKey: PAGE_KEY, action: 'update', entityType: 'Vessel', entityLabel: name })
      } else {
        resp = await createMasterVessel(form)
        logActivity({ pageKey: PAGE_KEY, action: 'add', entityType: 'Vessel', entityLabel: name })
      }
      setToast(pushSaveToast(name, resp?.push))
      await loadVessels()
      closeModal()
    } catch (e) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [editingId, form, closeModal, logActivity, loadVessels])

  const handleDelete = useCallback(
    async (v) => {
      if (!canDoDelete || !v?.id) return
      const label = v.vesselName || `Vessel #${v.id}`
      // eslint-disable-next-line no-alert
      const ok = window.confirm(`Are you sure you want to delete vessel "${label}"?`)
      if (!ok) return
      setDeleting(true)
      setError(null)
      try {
        await deleteMasterVessel(v.id)
        logActivity({ pageKey: PAGE_KEY, action: 'delete', entityType: 'Vessel', entityLabel: label })
        setToast({ message: `Deleted vessel "${label}".`, variant: 'success' })
        await loadVessels()
      } catch (e) {
        setError(e?.message || 'Delete failed')
      } finally {
        setDeleting(false)
      }
    },
    [canDoDelete, logActivity, loadVessels]
  )

  // --- DataHub sync ---------------------------------------------------------

  const [syncing, setSyncing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [syncError, setSyncError] = useState(null)
  const [review, setReview] = useState(null)
  const [latestRun, setLatestRun] = useState(null)
  // A staged run is one nobody has applied or discarded yet, so it can be resumed.
  const stagedRun = latestRun?.status === 'staged' ? latestRun : null

  const loadLatestRun = useCallback(async () => {
    try {
      const runs = await fetchSyncRuns({ limit: 1 })
      setLatestRun(Array.isArray(runs) ? (runs[0] ?? null) : null)
    } catch {
      setLatestRun(null)
    }
  }, [])

  useEffect(() => {
    loadLatestRun()
  }, [loadLatestRun])

  const openReview = useCallback(async (runId) => {
    setSyncError(null)
    try {
      const payload = await fetchSyncRun(runId)
      setReview(payload)
    } catch (e) {
      setError(e?.message || 'Failed to load the staged sync')
    }
  }, [])

  const handleSync = useCallback(async () => {
    setSyncing(true)
    setError(null)
    setSyncError(null)
    try {
      const { run } = await startSyncRun()
      await loadLatestRun()
      await openReview(run.id)
    } catch (e) {
      setError(e?.message || 'DataHub sync failed')
    } finally {
      setSyncing(false)
    }
  }, [loadLatestRun, openReview])

  const handleApply = useCallback(
    async (itemIds) => {
      if (!review?.run?.id) return
      setApplying(true)
      setSyncError(null)
      try {
        const result = await applySyncRun(review.run.id, itemIds)
        logActivity({
          pageKey: PAGE_KEY,
          action: 'import',
          entityType: 'Vessel',
          entityLabel: `DataHub sync #${review.run.id}`,
        })
        setToast({
          message: `Applied DataHub sync: ${result.created} added, ${result.updated} updated.`,
          variant: 'success',
        })
        setReview(null)
        await Promise.all([loadVessels(), loadLatestRun()])
      } catch (e) {
        setSyncError(e?.message || 'Apply failed')
      } finally {
        setApplying(false)
      }
    },
    [review, logActivity, loadVessels, loadLatestRun]
  )

  const handleDiscard = useCallback(async () => {
    if (!review?.run?.id) return
    setApplying(true)
    try {
      await discardSyncRun(review.run.id)
      setReview(null)
      setToast({ message: 'Staged sync discarded.', variant: 'success' })
      await loadLatestRun()
    } catch (e) {
      setSyncError(e?.message || 'Discard failed')
    } finally {
      setApplying(false)
    }
  }, [review, loadLatestRun])

  const { displayRows, filters, updateFilter, sortState, handleSort } = useSortableFilterableRows(
    vessels,
    VESSEL_COLUMNS,
    { key: 'vesselName', dir: 'asc' }
  )

  const paginationResetKey = useMemo(
    () => JSON.stringify({ filters, sortKey: sortState.key, sortDir: sortState.dir }),
    [filters, sortState.key, sortState.dir]
  )
  const {
    page: vesselPage,
    setPage: setVesselPage,
    totalPages: vesselTotalPages,
    pagedRows: pagedVessels,
    range: vesselPaginationRange,
  } = useMasterTablePagination(displayRows, { resetKey: paginationResetKey })

  return (
    <div className="allocation-page">
      <h1 className="page-title">Master – Vessel</h1>
      <p className="allocation-page__intro">
        Vessel master held in JPS as a reviewed copy of the DataHub records. A sync stages the hub
        data for review; nothing changes here until you apply it.
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

      {stagedRun && !review && (
        <p className="allocation-page__intro">
          A DataHub sync is staged and waiting for review ({stagedRun.newCount} new,{' '}
          {stagedRun.changedCount} changed).{' '}
          <button type="button" className="btn btn--small btn--secondary" onClick={() => openReview(stagedRun.id)}>
            Resume review
          </button>
        </p>
      )}

      {!stagedRun && latestRun && (
        <p className="text-steel">
          Last DataHub sync {new Date(latestRun.startedAt).toLocaleString()} — {latestRun.status}
          {latestRun.status === 'applied' ? ` (${latestRun.appliedCount} rows written)` : ''}
          {latestRun.error ? `: ${latestRun.error}` : ''}
        </p>
      )}

      <section className="card at-berth-list-section">
        <div className="card__header-row">
          <h2 className="card__title">Vessels</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => loadVessels()}
              disabled={loading}
            >
              Refresh
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={handleSync}
              disabled={!canDoEdit || syncing}
              title={!canDoEdit ? 'Edit permission required.' : ''}
            >
              {syncing ? 'Reading DataHub…' : 'Sync from DataHub'}
            </button>
            <button type="button" className="btn btn--primary" onClick={openAdd} disabled={!canDoEdit}>
              Add Vessel
            </button>
          </div>
        </div>
        {loading ? (
          <p className="text-steel">Loading vessels…</p>
        ) : vessels.length === 0 ? (
          <p className="text-steel">
            No vessels yet. Run Sync from DataHub to pull the hub master, or add one manually.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table allocation-table">
              <thead>
                <SortableFilterableTableHead
                  columns={VESSEL_COLUMNS}
                  sortState={sortState}
                  onSort={handleSort}
                  filters={filters}
                  onFilterChange={updateFilter}
                  trailingBlankCols={1}
                />
              </thead>
              <tbody>
                {pagedVessels.map((v) => (
                  <tr key={v.id} className="allocation-table__row">
                    <td><strong>{v.vesselName || '—'}</strong></td>
                    <td className="text-steel">{v.hubCode || '—'}</td>
                    <td className="text-steel">{v.vesselType || '—'}</td>
                    <td className="text-steel">{v.vesselImo || '—'}</td>
                    <td className="text-steel">{v.vesselMmsi || '—'}</td>
                    <td className="text-steel">{v.vesselCodeSap || '—'}</td>
                    <td className="text-steel">{v.vesselGrossTonnage ?? '—'}</td>
                    <td className="text-steel">{v.vesselDraft ?? '—'}</td>
                    <td className="text-steel">{v.vesselLengthOverall || '—'}</td>
                    <td className="text-steel">{v.heater == null ? '—' : v.heater ? 'Yes' : 'No'}</td>
                    <td className="text-steel">{v.typeLambung || '—'}</td>
                    <td className="text-steel">{v.typeCharter || '—'}</td>
                    <td className="text-steel">{formatMasterCreatedLine(v)}</td>
                    <td className="text-steel">{formatMasterLastUpdatedLine(v)}</td>
                    <td className="allocation-table__action-col">
                      <div className="allocation-table__action-btns">
                        <button
                          type="button"
                          className="btn btn--small btn--secondary"
                          onClick={() => openEdit(v)}
                          disabled={!canDoEdit}
                          title={!canDoEdit ? 'Edit permission required.' : ''}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn--small btn--secondary"
                          onClick={() => handleDelete(v)}
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
            {displayRows.length === 0 && (
              <p className="text-steel" style={{ marginTop: 'var(--spacing-3)' }}>
                No entries match the current filters.
              </p>
            )}
            <MasterTablePagination
              range={vesselPaginationRange}
              page={vesselPage}
              totalPages={vesselTotalPages}
              onPageChange={setVesselPage}
              ariaLabel="Vessel list pages"
            />
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="modal-overlay" onClick={closeModal} aria-hidden="true">
          <div
            className="modal modal--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="vessel-modal-title"
            aria-modal="true"
          >
            <h2 id="vessel-modal-title" className="modal__title">
              {editingId != null ? 'Edit Vessel' : 'Add Vessel'}
            </h2>
            <div className="modal__section">
              <label htmlFor="vessel-name" className="modal__label">Vessel Name</label>
              <input
                id="vessel-name"
                type="text"
                className="modal__input"
                value={form.vesselName}
                onChange={(e) => setField('vesselName', e.target.value)}
                maxLength={120}
                placeholder="e.g. MT BIO EXPRESS"
                disabled={saving}
              />
            </div>
            <div className="modal__section">
              <label htmlFor="vessel-imo" className="modal__label">IMO</label>
              <input
                id="vessel-imo"
                type="text"
                className="modal__input"
                value={form.vesselImo}
                onChange={(e) => setField('vesselImo', e.target.value)}
                maxLength={20}
                disabled={saving}
              />
            </div>
            <div className="modal__section">
              <label htmlFor="vessel-mmsi" className="modal__label">MMSI</label>
              <input
                id="vessel-mmsi"
                type="text"
                className="modal__input"
                value={form.vesselMmsi}
                onChange={(e) => setField('vesselMmsi', e.target.value)}
                maxLength={20}
                disabled={saving}
              />
            </div>
            <div className="modal__section">
              <label htmlFor="vessel-sap" className="modal__label">SAP Code</label>
              <input
                id="vessel-sap"
                type="text"
                className="modal__input"
                value={form.vesselCodeSap}
                onChange={(e) => setField('vesselCodeSap', e.target.value)}
                maxLength={60}
                disabled={saving}
              />
            </div>
            <div className="modal__section">
              <label htmlFor="vessel-capacity" className="modal__label">Capacity (MT)</label>
              <input
                id="vessel-capacity"
                type="number"
                step="0.001"
                className="modal__input"
                value={form.vesselCapacityMt}
                onChange={(e) => setField('vesselCapacityMt', e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="modal__section">
              <label htmlFor="vessel-gt" className="modal__label">Gross Tonnage</label>
              <input
                id="vessel-gt"
                type="number"
                step="0.001"
                className="modal__input"
                value={form.vesselGrossTonnage}
                onChange={(e) => setField('vesselGrossTonnage', e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="modal__section">
              <label htmlFor="vessel-draft" className="modal__label">Draft (m)</label>
              <input
                id="vessel-draft"
                type="number"
                step="0.01"
                className="modal__input"
                value={form.vesselDraft}
                onChange={(e) => setField('vesselDraft', e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="modal__section">
              <label htmlFor="vessel-loa" className="modal__label">Length Overall</label>
              <input
                id="vessel-loa"
                type="text"
                className="modal__input"
                value={form.vesselLengthOverall}
                onChange={(e) => setField('vesselLengthOverall', e.target.value)}
                maxLength={40}
                placeholder="e.g. 79"
                disabled={saving}
              />
            </div>
            <div className="modal__section">
              <label htmlFor="vessel-type" className="modal__label">Vessel Type</label>
              <select
                id="vessel-type"
                className="modal__input"
                value={form.vesselType}
                onChange={(e) => setField('vesselType', e.target.value)}
                disabled={saving}
              >
                <option value="">—</option>
                {VESSEL_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="modal__section">
              <label htmlFor="vessel-lambung" className="modal__label">Hull Type</label>
              <select
                id="vessel-lambung"
                className="modal__input"
                value={form.typeLambung}
                onChange={(e) => setField('typeLambung', e.target.value)}
                disabled={saving}
              >
                <option value="">—</option>
                {LAMBUNG_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="modal__section">
              <label htmlFor="vessel-charter" className="modal__label">Charter Type</label>
              <select
                id="vessel-charter"
                className="modal__input"
                value={form.typeCharter}
                onChange={(e) => setField('typeCharter', e.target.value)}
                disabled={saving}
              >
                <option value="">—</option>
                {CHARTER_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="modal__section">
              <label
                htmlFor="vessel-heater"
                className="modal__checkbox-label"
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <input
                  id="vessel-heater"
                  type="checkbox"
                  checked={form.heater === true}
                  onChange={(e) => setField('heater', e.target.checked)}
                  disabled={saving}
                />
                Heater
              </label>
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

      {review && (
        <DataHubSyncReviewModal
          run={review.run}
          items={review.items}
          applying={applying}
          error={syncError}
          onApply={handleApply}
          onDiscard={handleDiscard}
          onClose={() => setReview(null)}
        />
      )}
    </div>
  )
}
