import { useState, useCallback, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchMasterVessels,
  deleteMasterVessel,
  fetchSyncRuns,
  fetchSyncRun,
  startSyncRun,
  startRecordSync,
  applySyncRun,
  discardSyncRun,
} from '../api/masterVessels'
import DataHubSyncReviewModal from '../components/DataHubSyncReviewModal.jsx'
import DataHubRecordSyncButton from '../components/DataHubRecordSyncButton.jsx'
import AppToast from '../components/AppToast.jsx'
import MasterSourceBadge from '../components/MasterSourceBadge.jsx'
import DataHubFieldCue from '../components/DataHubFieldCue.jsx'
import MasterVesselFormModal, {
  EMPTY_VESSEL_FORM,
  pushSaveToast,
  vesselFormFromRecord,
} from '../components/MasterVesselFormModal.jsx'
import { useActivityLog } from '../context/ActivityLogContext'
import { useRbac } from '../context/RbacContext'
import { CHARTER_TYPES, LAMBUNG_TYPES, VESSEL_TYPE_OPTIONS, VESSEL_TYPES } from '../utils/masterVesselOptions'
import '../styles/allocation.css'
import '../styles/modal.css'
import '../styles/datahub-sync.css'
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

const text = (v) => (v || '').toLowerCase()

const VESSEL_COLUMNS = [
  { key: 'vesselName', label: <DataHubFieldCue>Vessel Name</DataHubFieldCue>, labelText: 'Vessel Name', getSortValue: (v) => text(v.vesselName) },
  { key: 'hubCode', label: <DataHubFieldCue>Hub Code</DataHubFieldCue>, labelText: 'Hub Code', getSortValue: (v) => text(v.hubCode), getFilterValue: (v) => v.hubCode || '' },
  {
    key: 'isActive',
    label: 'Active',
    labelText: 'Active',
    filterType: 'select',
    selectOptions: ['Yes', 'No'],
    getSortValue: (v) => (v.isActive === false ? 0 : 1),
    getFilterValue: (v) => (v.isActive === false ? 'No' : 'Yes'),
  },
  {
    key: 'vesselType',
    label: <DataHubFieldCue>Type</DataHubFieldCue>,
    labelText: 'Type',
    filterType: 'select',
    selectOptions: VESSEL_TYPES,
    getSortValue: (v) => text(v.vesselType),
    getFilterValue: (v) => v.vesselType || '',
  },
  { key: 'vesselImo', label: <DataHubFieldCue>IMO</DataHubFieldCue>, labelText: 'IMO', getSortValue: (v) => text(v.vesselImo), getFilterValue: (v) => v.vesselImo || '' },
  { key: 'vesselMmsi', label: <DataHubFieldCue>MMSI</DataHubFieldCue>, labelText: 'MMSI', getSortValue: (v) => text(v.vesselMmsi), getFilterValue: (v) => v.vesselMmsi || '' },
  { key: 'vesselCodeSap', label: <DataHubFieldCue>SAP Code</DataHubFieldCue>, labelText: 'SAP Code', getSortValue: (v) => text(v.vesselCodeSap), getFilterValue: (v) => v.vesselCodeSap || '' },
  { key: 'vesselGrossTonnage', label: <DataHubFieldCue>GT</DataHubFieldCue>, labelText: 'GT', getSortValue: (v) => (v.vesselGrossTonnage ?? -1) },
  { key: 'vesselDraft', label: <DataHubFieldCue>Draft (m)</DataHubFieldCue>, labelText: 'Draft (m)', getSortValue: (v) => (v.vesselDraft ?? -1) },
  { key: 'vesselLengthOverall', label: <DataHubFieldCue>LOA</DataHubFieldCue>, labelText: 'LOA', getSortValue: (v) => text(v.vesselLengthOverall) },
  {
    key: 'heater',
    label: <DataHubFieldCue>Heater</DataHubFieldCue>,
    labelText: 'Heater',
    filterType: 'select',
    selectOptions: ['Yes', 'No'],
    getSortValue: (v) => (v.heater ? 1 : 0),
    getFilterValue: (v) => (v.heater === true ? 'Yes' : v.heater === false ? 'No' : ''),
  },
  {
    key: 'typeLambung',
    label: <DataHubFieldCue>Hull Type</DataHubFieldCue>,
    labelText: 'Hull Type',
    filterType: 'select',
    selectOptions: LAMBUNG_TYPES,
    getSortValue: (v) => text(v.typeLambung),
    getFilterValue: (v) => v.typeLambung || '',
  },
  {
    key: 'typeCharter',
    label: <DataHubFieldCue>Charter Type</DataHubFieldCue>,
    labelText: 'Charter Type',
    filterType: 'select',
    selectOptions: CHARTER_TYPES,
    getSortValue: (v) => text(v.typeCharter),
    getFilterValue: (v) => v.typeCharter || '',
  },
  ...MASTER_AUDIT_COLUMNS,
]

export default function MasterVessel() {
  const { logActivity } = useActivityLog()
  const { canEdit, canDelete } = useRbac()
  const canDoEdit = canEdit(PAGE_KEY)
  const canDoDelete = canDelete(PAGE_KEY)

  const [vessels, setVessels] = useState([])
  const [loading, setLoading] = useState(true)
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

  const [vesselModal, setVesselModal] = useState(null)

  const openAdd = useCallback(() => {
    setVesselModal({ editingId: null, initialForm: { ...EMPTY_VESSEL_FORM } })
  }, [])

  const openEdit = useCallback((v) => {
    setVesselModal({ editingId: v.id, initialForm: vesselFormFromRecord(v) })
  }, [])

  const closeModal = useCallback(() => {
    setVesselModal(null)
  }, [])

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
  const [syncingRecordId, setSyncingRecordId] = useState(null)
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
      const resp = await startSyncRun()
      await loadLatestRun()
      if (resp?.noChanges) {
        setToast({
          message: 'DataHub matches JPS — nothing new or changed to review.',
          variant: 'success',
        })
        return
      }
      const run = resp?.run
      if (run?.id) await openReview(run.id)
    } catch (e) {
      setError(e?.message || 'DataHub sync failed')
    } finally {
      setSyncing(false)
    }
  }, [loadLatestRun, openReview])

  const handleRecordSync = useCallback(async (row) => {
    setSyncing(true)
    setSyncingRecordId(row.id)
    setError(null)
    setSyncError(null)
    try {
      const resp = await startRecordSync(row.id)
      await loadLatestRun()
      if (resp?.noChanges) {
        setToast({ message: 'This record already matches DataHub.', variant: 'success' })
        return
      }
      if (resp?.run?.id) await openReview(resp.run.id)
    } catch (e) {
      setError(e?.message || 'DataHub sync failed')
    } finally {
      setSyncing(false)
      setSyncingRecordId(null)
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
      <h1 className="page-title page-title-row">
        Master – Vessel
        <MasterSourceBadge kind="datahub" />
      </h1>
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

      {toast && <AppToast toast={toast} onDismiss={() => setToast(null)} />}

      {stagedRun && !review && (
        <p className="allocation-page__intro">
          A DataHub sync is staged and waiting for review
          {stagedRun.source === 'webhook' ? ' (from webhook)' : ''} ({stagedRun.newCount} new,{' '}
          {stagedRun.changedCount} changed).{' '}
          <button type="button" className="btn btn--small btn--secondary" onClick={() => openReview(stagedRun.id)}>
            Resume review
          </button>
        </p>
      )}

      {!stagedRun && latestRun && (
        <p className="text-steel">
          Last DataHub sync {new Date(latestRun.startedAt).toLocaleString()}
          {latestRun.source === 'webhook' ? ' (webhook)' : ''} — {latestRun.status}
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
              {syncing && syncingRecordId == null ? 'Reading DataHub…' : 'Sync from DataHub'}
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
                    <td className="text-steel">
                      {v.hubCode ? (
                        v.hubCode
                      ) : (
                        <MasterSourceBadge kind="local" />
                      )}
                    </td>
                    <td className="text-steel">{v.isActive === false ? 'No' : 'Yes'}</td>
                    <td className="text-steel">{VESSEL_TYPE_OPTIONS.find((o) => o.value === v.vesselType)?.label || v.vesselType || '—'}</td>
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
                        <DataHubRecordSyncButton
                          hubCode={v.hubCode}
                          canEdit={canDoEdit}
                          busy={syncing}
                          syncing={syncingRecordId === v.id}
                          onClick={() => handleRecordSync(v)}
                        />
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

      {vesselModal && (
        <MasterVesselFormModal
          editingId={vesselModal.editingId}
          initialForm={vesselModal.initialForm}
          onClose={closeModal}
          onUseExisting={closeModal}
          onSaved={async (resp) => {
            const name = resp?.vesselName || vesselModal.initialForm?.vesselName || ''
            setToast(pushSaveToast(name, resp?.push))
            await loadVessels()
          }}
        />
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
