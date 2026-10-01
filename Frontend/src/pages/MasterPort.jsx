import { useState, useCallback, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { fetchPorts, createPort, updatePortApi, deletePort } from '../api/ports'
import {
  applyPortSyncRun,
  DATAHUB_PORT_REVIEW_META,
  discardPortSyncRun,
  fetchPortSyncRun,
  fetchPortSyncRuns,
  startPortSyncRun,
} from '../api/datahubPort.js'
import { useActivityLog } from '../context/ActivityLogContext'
import { useRbac } from '../context/RbacContext'
import '../styles/allocation.css'
import '../styles/modal.css'
import '../styles/datahub-sync.css'
import { MAX_MASTER_DESCRIPTION_CHARS, MAX_MASTER_PORT_NAME_CHARS } from '../constants/inputLimits'
import { DEFAULT_SCHEDULE_TIMEZONE } from '../utils/scheduleDateTime.js'
import { getIanaTimeZoneOptions, mergeTimezoneOptionsWithOrphan } from '../utils/ianaTimeZoneOptions.js'
import MasterSourceBadge from '../components/MasterSourceBadge.jsx'
import DataHubFieldCue from '../components/DataHubFieldCue.jsx'
import DataHubSyncReviewModal from '../components/DataHubSyncReviewModal.jsx'
import AppToast from '../components/AppToast.jsx'
import SearchableSingleSelect from '../components/SearchableSingleSelect.jsx'
import SortableFilterableTableHead from '../components/SortableFilterableTableHead.jsx'
import { useSortableFilterableRows } from '../hooks/useSortableFilterableRows.js'
import {
  formatMasterCreatedLine,
  formatMasterLastUpdatedLine,
  MASTER_AUDIT_COLUMNS,
} from '../utils/formatMasterAudit.js'

const PAGE_KEY = 'master-port'

const DEFAULT_OPERATIONAL_DAY_START = '06:00:00'

const PORT_COLUMNS = [
  {
    key: 'name',
    label: <DataHubFieldCue>Port Name</DataHubFieldCue>,
    labelText: 'Port Name',
    getSortValue: (p) => (p.name || '').toLowerCase(),
  },
  {
    key: 'hubCode',
    label: <DataHubFieldCue>Hub Code</DataHubFieldCue>,
    labelText: 'Hub Code',
    getSortValue: (p) => (p.hubCode || '').toLowerCase(),
    getFilterValue: (p) => p.hubCode || '',
  },
  {
    key: 'unlocode',
    label: <DataHubFieldCue>UN/LOCODE</DataHubFieldCue>,
    labelText: 'UN/LOCODE',
    getSortValue: (p) => (p.unlocode || '').toLowerCase(),
    getFilterValue: (p) => p.unlocode || '',
  },
  {
    key: 'country',
    label: <DataHubFieldCue>Country</DataHubFieldCue>,
    labelText: 'Country',
    getSortValue: (p) => (p.country || '').toLowerCase(),
    getFilterValue: (p) => p.country || '',
  },
  {
    key: 'isActive',
    label: 'Active',
    labelText: 'Active',
    filterType: 'select',
    selectOptions: ['Yes', 'No'],
    getSortValue: (p) => (p.isActive === false ? 0 : 1),
    getFilterValue: (p) => (p.isActive === false ? 'No' : 'Yes'),
  },
  {
    key: 'scheduleTimezone',
    label: 'Schedule TZ',
    getSortValue: (p) => (p.scheduleTimezone || DEFAULT_SCHEDULE_TIMEZONE).toLowerCase(),
  },
  {
    key: 'operationalDayStart',
    label: 'Op. Day Start',
    getSortValue: (p) => (p.operationalDayStart || DEFAULT_OPERATIONAL_DAY_START).toLowerCase(),
  },
  {
    key: 'description',
    label: 'Description',
    getSortValue: (p) => (p.description || '').toLowerCase(),
    getFilterValue: (p) => p.description || '',
  },
  {
    key: 'allowMultiJetyBerthing',
    label: 'Multi-Jetty Berthing',
    getSortValue: (p) => (p.allowMultiJetyBerthing ? 1 : 0),
  },
  ...MASTER_AUDIT_COLUMNS,
]

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
  const [formOperationalDayStart, setFormOperationalDayStart] = useState(DEFAULT_OPERATIONAL_DAY_START)
  const [formAllowMultiJetyBerthing, setFormAllowMultiJetyBerthing] = useState(false)
  const [formUnlocode, setFormUnlocode] = useState('')
  const [formCountry, setFormCountry] = useState('')
  const [formHubCode, setFormHubCode] = useState('')
  const [formIsActive, setFormIsActive] = useState(true)

  const [syncing, setSyncing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [syncError, setSyncError] = useState(null)
  const [review, setReview] = useState(null)
  const [latestRun, setLatestRun] = useState(null)
  const stagedRun = latestRun?.status === 'staged' ? latestRun : null

  const loadLatestRun = useCallback(async () => {
    try {
      const runs = await fetchPortSyncRuns({ limit: 1 })
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
      setReview(await fetchPortSyncRun(runId))
    } catch (e) {
      setError(e?.message || 'Failed to load the staged sync')
    }
  }, [])

  const handleSync = useCallback(async () => {
    setSyncing(true)
    setError(null)
    setSyncError(null)
    try {
      const resp = await startPortSyncRun()
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
      const hint = e?.body?.hint
      setError(
        hint ? `${e?.message || 'DataHub sync failed'} ${hint}` : e?.message || 'DataHub sync failed'
      )
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
        const result = await applyPortSyncRun(review.run.id, itemIds)
        logActivity({
          pageKey: PAGE_KEY,
          action: 'import',
          entityType: 'Port',
          entityLabel: `DataHub sync #${review.run.id}`,
        })
        setToast({
          message: `Applied DataHub sync: ${result.created} added, ${result.updated} updated.`,
          variant: 'success',
        })
        setReview(null)
        await Promise.all([loadPorts(), loadLatestRun()])
      } catch (e) {
        setSyncError(e?.message || 'Apply failed')
      } finally {
        setApplying(false)
      }
    },
    [review, logActivity, loadPorts, loadLatestRun]
  )

  const handleDiscard = useCallback(async () => {
    if (!review?.run?.id) return
    setApplying(true)
    try {
      await discardPortSyncRun(review.run.id)
      setReview(null)
      setToast({ message: 'Staged sync discarded.', variant: 'success' })
      await loadLatestRun()
    } catch (e) {
      setSyncError(e?.message || 'Discard failed')
    } finally {
      setApplying(false)
    }
  }, [review, loadLatestRun])

  const openAdd = useCallback(() => {
    setEditingId(null)
    setFormName('')
    setFormDescription('')
    setFormScheduleTimezone(DEFAULT_SCHEDULE_TIMEZONE)
    setFormOperationalDayStart(DEFAULT_OPERATIONAL_DAY_START)
    setFormAllowMultiJetyBerthing(false)
    setFormUnlocode('')
    setFormCountry('')
    setFormHubCode('')
    setFormIsActive(true)
    setModalOpen(true)
  }, [])

  const openEdit = useCallback((port) => {
    setEditingId(port.id)
    setFormName(port.name || '')
    setFormDescription(port.description ?? '')
    setFormScheduleTimezone(port.scheduleTimezone || DEFAULT_SCHEDULE_TIMEZONE)
    setFormOperationalDayStart(port.operationalDayStart || DEFAULT_OPERATIONAL_DAY_START)
    setFormAllowMultiJetyBerthing(port.allowMultiJetyBerthing === true)
    setFormUnlocode(port.unlocode ?? '')
    setFormCountry(port.country ?? '')
    setFormHubCode(port.hubCode ?? '')
    setFormIsActive(port.isActive !== false)
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEditingId(null)
    setFormName('')
    setFormDescription('')
    setFormScheduleTimezone(DEFAULT_SCHEDULE_TIMEZONE)
    setFormOperationalDayStart(DEFAULT_OPERATIONAL_DAY_START)
    setFormAllowMultiJetyBerthing(false)
    setFormUnlocode('')
    setFormCountry('')
    setFormHubCode('')
    setFormIsActive(true)
  }, [])

  const handleSubmit = useCallback(async () => {
    const name = (formName || '').trim()
    if (!name) return
    setSaving(true)
    setError(null)
    try {
      const opDayStart = (formOperationalDayStart || '').trim() || DEFAULT_OPERATIONAL_DAY_START
      if (editingId != null) {
        await updatePortApi(editingId, {
          name,
          description: (formDescription || '').trim() || null,
          scheduleTimezone: (formScheduleTimezone || '').trim() || DEFAULT_SCHEDULE_TIMEZONE,
          operationalDayStart: opDayStart,
          allowMultiJetyBerthing: formAllowMultiJetyBerthing,
          unlocode: (formUnlocode || '').trim() || null,
          country: (formCountry || '').trim() || null,
          isActive: formIsActive,
          hubCode: (formHubCode || '').trim() || null,
        })
        logActivity({ pageKey: PAGE_KEY, action: 'update', entityType: 'Port', entityLabel: name })
        setToast({ message: `Port saved: ${name}.`, variant: 'success' })
      } else {
        await createPort({
          name,
          description: (formDescription || '').trim() || null,
          scheduleTimezone: (formScheduleTimezone || '').trim() || DEFAULT_SCHEDULE_TIMEZONE,
          operationalDayStart: opDayStart,
          allowMultiJetyBerthing: formAllowMultiJetyBerthing,
          unlocode: (formUnlocode || '').trim() || null,
          country: (formCountry || '').trim() || null,
          isActive: formIsActive,
          hubCode: (formHubCode || '').trim() || null,
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
  }, [
    editingId,
    formName,
    formDescription,
    formScheduleTimezone,
    formOperationalDayStart,
    formAllowMultiJetyBerthing,
    formUnlocode,
    formCountry,
    formHubCode,
    formIsActive,
    closeModal,
    logActivity,
    loadPorts,
  ])

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

  const { displayRows, filters, updateFilter, sortState, handleSort } = useSortableFilterableRows(
    ports,
    PORT_COLUMNS,
    { key: 'name', dir: 'asc' }
  )

  return (
    <div className="allocation-page">
      <h1 className="page-title page-title-row">
        Master – Port
        <MasterSourceBadge kind="datahub" />
      </h1>
      <p className="allocation-page__intro">
        Operating ports in JPS, synced from DataHub <code>port_master</code> via review and apply.
        Schedule, operational day, multi-jetty, and description stay local-only and are not pushed to
        DataHub when you save.
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
                <SortableFilterableTableHead
                  columns={PORT_COLUMNS}
                  sortState={sortState}
                  onSort={handleSort}
                  filters={filters}
                  onFilterChange={updateFilter}
                  trailingBlankCols={1}
                />
              </thead>
              <tbody>
                {displayRows.map((p) => (
                  <tr key={p.id} className="allocation-table__row">
                    <td><strong>{p.name || '—'}</strong></td>
                    <td className="text-steel">{p.hubCode || '—'}</td>
                    <td className="text-steel">{p.unlocode || '—'}</td>
                    <td className="text-steel">{p.country || '—'}</td>
                    <td className="text-steel">{p.isActive === false ? 'No' : 'Yes'}</td>
                    <td className="text-steel">{p.scheduleTimezone || DEFAULT_SCHEDULE_TIMEZONE}</td>
                    <td className="text-steel">{p.operationalDayStart || DEFAULT_OPERATIONAL_DAY_START}</td>
                    <td>
                      {p.description
                        ? p.description.length > 60
                          ? `${p.description.slice(0, 60)}…`
                          : p.description
                        : '—'}
                    </td>
                    <td className="text-steel">{p.allowMultiJetyBerthing ? 'Yes' : 'No'}</td>
                    <td className="text-steel">{formatMasterCreatedLine(p)}</td>
                    <td className="text-steel">{formatMasterLastUpdatedLine(p)}</td>
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
            {displayRows.length === 0 && (
              <p className="text-steel" style={{ marginTop: 'var(--spacing-3)' }}>
                No entries match the current filters.
              </p>
            )}
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
              <label htmlFor="port-name" className="modal__label">
                <DataHubFieldCue>Port Name</DataHubFieldCue>
              </label>
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
              <label htmlFor="port-hub-code" className="modal__label">
                <DataHubFieldCue>Hub Code</DataHubFieldCue>
              </label>
              <input
                id="port-hub-code"
                type="text"
                className="modal__input"
                value={formHubCode}
                onChange={(e) => setFormHubCode(e.target.value)}
                placeholder="e.g. PORT-0001 (manual map to DataHub)"
                maxLength={64}
                disabled={saving || !canDoEdit}
              />
              <p className="text-steel" style={{ marginTop: '0.25rem', fontSize: '0.85em' }}>
                Optional. Set to the DHM port code to link this row; sync will match on this code first.
              </p>
            </div>
            <div className="modal__section">
              <label htmlFor="port-unlocode" className="modal__label">
                <DataHubFieldCue>UN/LOCODE</DataHubFieldCue>
              </label>
              <input
                id="port-unlocode"
                type="text"
                className="modal__input"
                value={formUnlocode}
                onChange={(e) => setFormUnlocode(e.target.value)}
                maxLength={16}
                placeholder="e.g. IDBTG"
                disabled={saving}
              />
            </div>
            <div className="modal__section">
              <label htmlFor="port-country" className="modal__label">
                <DataHubFieldCue>Country</DataHubFieldCue>
              </label>
              <input
                id="port-country"
                type="text"
                className="modal__input"
                value={formCountry}
                onChange={(e) => setFormCountry(e.target.value)}
                maxLength={128}
                placeholder="e.g. Indonesia"
                disabled={saving}
              />
            </div>
            <div className="modal__section">
              <label htmlFor="port-is-active" className="modal__checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  id="port-is-active"
                  type="checkbox"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  disabled={saving}
                />
                Active (inactive ports are hidden from port pickers elsewhere)
              </label>
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
              <label htmlFor="port-op-day-start" className="modal__label">
                Operational day start (HH:mm:ss)
              </label>
              <input
                id="port-op-day-start"
                type="text"
                className="modal__input"
                value={formOperationalDayStart}
                onChange={(e) => setFormOperationalDayStart(e.target.value)}
                placeholder={DEFAULT_OPERATIONAL_DAY_START}
                maxLength={8}
                disabled={saving}
                pattern="[0-2][0-9]:[0-5][0-9]:[0-5][0-9]"
              />
              <p className="text-steel" style={{ marginTop: '0.25rem', fontSize: '0.85em' }}>
                Daily progress rolls at this local time (default 06:00:00 → next day 05:59:59).
              </p>
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
            <div className="modal__section">
              <label htmlFor="port-allow-multi-jetty" className="modal__checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  id="port-allow-multi-jetty"
                  type="checkbox"
                  checked={formAllowMultiJetyBerthing}
                  onChange={(e) => setFormAllowMultiJetyBerthing(e.target.checked)}
                  disabled={saving}
                />
                Allow Multi-Jetty Berthing
              </label>
              <p className="text-steel" style={{ marginTop: '0.25rem', fontSize: '0.85em' }}>
                When enabled, operators can span a vessel across the primary jetty plus adjacent jetties
                configured in Master – Jetty.
              </p>
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
          recordNoun={DATAHUB_PORT_REVIEW_META.recordNoun}
          newHint={DATAHUB_PORT_REVIEW_META.newHint}
        />
      )}
    </div>
  )
}
