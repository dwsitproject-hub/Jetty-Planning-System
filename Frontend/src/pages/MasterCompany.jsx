import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import MasterSourceBadge from '../components/MasterSourceBadge.jsx'
import MasterWorkingPortBar from '../components/MasterWorkingPortBar.jsx'
import DataHubFieldCue from '../components/DataHubFieldCue.jsx'
import DataHubSyncReviewModal from '../components/DataHubSyncReviewModal.jsx'
import DataHubRecordSyncButton from '../components/DataHubRecordSyncButton.jsx'
import AppToast from '../components/AppToast.jsx'
import SortableFilterableTableHead from '../components/SortableFilterableTableHead.jsx'
import { useSortableFilterableRows } from '../hooks/useSortableFilterableRows.js'
import { useActivityLog } from '../context/ActivityLogContext'
import { useRbac } from '../context/RbacContext'
import { usePortScope } from '../context/PortScopeContext'
import {
  applyCompanySyncRun,
  DATAHUB_COMPANY_REVIEW_META,
  discardCompanySyncRun,
  fetchCompanyPortMap,
  fetchCompanySyncRun,
  fetchCompanySyncRuns,
  fetchMasterCompanies,
  saveCompanyPortMap,
  startCompanySyncRun,
  startCompanyRecordSync,
} from '../api/masterCompanies.js'
import {
  formatMasterCreatedLine,
  formatMasterLastUpdatedLine,
  MASTER_AUDIT_COLUMNS,
} from '../utils/formatMasterAudit.js'
import '../styles/allocation.css'
import '../styles/datahub-sync.css'

const PAGE_KEY = 'master-company'

const COMPANY_COLUMNS = [
  {
    key: 'name',
    label: <DataHubFieldCue>Name</DataHubFieldCue>,
    labelText: 'Name',
    getSortValue: (row) => (row.name || '').toLowerCase(),
  },
  {
    key: 'shortName',
    label: <DataHubFieldCue>Short name</DataHubFieldCue>,
    labelText: 'Short name',
    getSortValue: (row) => (row.shortName || '').toLowerCase(),
    getFilterValue: (row) => row.shortName || '',
  },
  {
    key: 'companyCodeSap',
    label: <DataHubFieldCue>SAP code</DataHubFieldCue>,
    labelText: 'SAP code',
    getSortValue: (row) => (row.companyCodeSap || '').toLowerCase(),
    getFilterValue: (row) => row.companyCodeSap || '',
  },
  {
    key: 'country',
    label: <DataHubFieldCue>Country</DataHubFieldCue>,
    labelText: 'Country',
    getSortValue: (row) => (row.country || '').toLowerCase(),
    getFilterValue: (row) => row.country || '',
  },
  {
    key: 'hubCode',
    label: <DataHubFieldCue>Hub code</DataHubFieldCue>,
    labelText: 'Hub code',
    getSortValue: (row) => (row.hubCode || '').toLowerCase(),
    getFilterValue: (row) => row.hubCode || '',
  },
  {
    key: 'isActive',
    label: 'Active',
    labelText: 'Active',
    filterType: 'select',
    selectOptions: ['Yes', 'No'],
    getSortValue: (row) => (row.isActive === false ? 0 : 1),
    getFilterValue: (row) => (row.isActive === false ? 'No' : 'Yes'),
  },
  ...MASTER_AUDIT_COLUMNS,
]

export default function MasterCompany() {
  const { t } = useTranslation('pages')
  const { logActivity } = useActivityLog()
  const { canEdit } = useRbac()
  const canDoEdit = canEdit(PAGE_KEY)
  const { selectedPortId, requiresSelection, noPortAssigned } = usePortScope()
  const canMap = selectedPortId != null && !requiresSelection && !noPortAssigned && canDoEdit

  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const [checkedIds, setCheckedIds] = useState([])
  const [mapLoading, setMapLoading] = useState(false)
  const [savingMap, setSavingMap] = useState(false)

  const [syncing, setSyncing] = useState(false)
  const [syncingRecordId, setSyncingRecordId] = useState(null)
  const [applying, setApplying] = useState(false)
  const [syncError, setSyncError] = useState(null)
  const [review, setReview] = useState(null)
  const [latestRun, setLatestRun] = useState(null)
  const [directoryOpen, setDirectoryOpen] = useState(true)
  const stagedRun = latestRun?.status === 'staged' ? latestRun : null

  const loadCompanies = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const list = await fetchMasterCompanies()
      setCompanies(Array.isArray(list) ? list : [])
    } catch (e) {
      setCompanies([])
      setError(e?.message || 'Failed to load companies')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadLatestRun = useCallback(async () => {
    try {
      const runs = await fetchCompanySyncRuns({ limit: 1 })
      setLatestRun(Array.isArray(runs) ? (runs[0] ?? null) : null)
    } catch {
      setLatestRun(null)
    }
  }, [])

  const loadMap = useCallback(async () => {
    if (selectedPortId == null || requiresSelection || noPortAssigned) {
      setCheckedIds([])
      return
    }
    setMapLoading(true)
    try {
      const map = await fetchCompanyPortMap(selectedPortId)
      setCheckedIds(Array.isArray(map?.companyIds) ? map.companyIds.map(Number) : [])
    } catch (e) {
      setCheckedIds([])
      setError(e?.message || 'Failed to load companies for this port')
    } finally {
      setMapLoading(false)
    }
  }, [selectedPortId, requiresSelection, noPortAssigned])

  useEffect(() => {
    loadCompanies()
    loadLatestRun()
  }, [loadCompanies, loadLatestRun])

  useEffect(() => {
    loadMap()
  }, [loadMap])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 5500)
    return () => window.clearTimeout(timer)
  }, [toast])

  const openReview = useCallback(async (runId) => {
    setSyncError(null)
    try {
      setReview(await fetchCompanySyncRun(runId))
    } catch (e) {
      setError(e?.message || 'Failed to load the staged sync')
    }
  }, [])

  const handleSync = useCallback(async () => {
    setSyncing(true)
    setError(null)
    setSyncError(null)
    try {
      const resp = await startCompanySyncRun()
      await loadLatestRun()
      if (resp?.noChanges) {
        setToast({ message: 'DataHub matches JPS — nothing new or changed to review.', variant: 'success' })
        return
      }
      if (resp?.run?.id) await openReview(resp.run.id)
    } catch (e) {
      const hint = e?.body?.hint
      setError(hint ? `${e?.message || 'DataHub sync failed'} ${hint}` : e?.message || 'DataHub sync failed')
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
      const resp = await startCompanyRecordSync(row.id)
      await loadLatestRun()
      if (resp?.noChanges) {
        setToast({ message: 'This record already matches DataHub.', variant: 'success' })
        return
      }
      if (resp?.run?.id) await openReview(resp.run.id)
    } catch (e) {
      const hint = e?.body?.hint
      setError(hint ? `${e?.message || 'DataHub sync failed'} ${hint}` : e?.message || 'DataHub sync failed')
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
        const result = await applyCompanySyncRun(review.run.id, itemIds)
        logActivity({
          pageKey: PAGE_KEY,
          action: 'import',
          entityType: 'Company',
          entityLabel: `DataHub sync #${review.run.id}`,
        })
        setToast({
          message: `Applied DataHub sync: ${result.created} added, ${result.updated} updated.`,
          variant: 'success',
        })
        setReview(null)
        await Promise.all([loadCompanies(), loadLatestRun()])
      } catch (e) {
        setSyncError(e?.message || 'Apply failed')
      } finally {
        setApplying(false)
      }
    },
    [review, logActivity, loadCompanies, loadLatestRun]
  )

  const handleDiscard = useCallback(async () => {
    if (!review?.run?.id) return
    setApplying(true)
    try {
      await discardCompanySyncRun(review.run.id)
      setReview(null)
      setToast({ message: 'Staged sync discarded.', variant: 'success' })
      await loadLatestRun()
    } catch (e) {
      setSyncError(e?.message || 'Discard failed')
    } finally {
      setApplying(false)
    }
  }, [review, loadLatestRun])

  const toggleCompany = (id) => {
    setCheckedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const saveMap = async () => {
    if (!canMap) return
    setSavingMap(true)
    setError(null)
    try {
      const activeIds = new Set(companies.filter((c) => c.isActive !== false).map((c) => c.id))
      const companyIds = checkedIds.filter((id) => activeIds.has(id))
      const result = await saveCompanyPortMap(selectedPortId, companyIds)
      setCheckedIds(Array.isArray(result?.companyIds) ? result.companyIds : companyIds)
      const extra = result?.backfilled > 0 ? ` ${result.backfilled} existing instruction(s) set to that company.` : ''
      setToast({ message: `Companies for this port saved.${extra}`, variant: 'success' })
    } catch (e) {
      setError(e?.message || 'Failed to save port companies')
    } finally {
      setSavingMap(false)
    }
  }

  const { displayRows, filters, updateFilter, sortState, handleSort } = useSortableFilterableRows(
    companies,
    COMPANY_COLUMNS,
    { key: 'name', dir: 'asc' }
  )
  const activeCompanies = companies.filter((c) => c.isActive !== false)

  return (
    <div className="allocation-page">
      <h1 className="page-title page-title-row">
        Company
        <MasterSourceBadge kind="datahub" />
      </h1>
      <p className="allocation-page__intro">
        Company names come from DataHub. Tick the companies this port uses. A shipping instruction can name one of those companies.
      </p>
      <p className="text-steel">
        <Link to="/master" className="link">← Back to Master Menu</Link>
      </p>
      {toast && <AppToast toast={toast} onDismiss={() => setToast(null)} />}
      {error && (
        <p className="allocation-page__intro" style={{ color: 'var(--color-danger, #c00)' }} role="alert">
          {error}
        </p>
      )}
      {stagedRun && !review && (
        <p className="allocation-page__intro">
          A DataHub sync is staged and waiting for review
          {stagedRun.source === 'webhook' ? ' (from webhook)' : ''} ({stagedRun.newCount} new, {stagedRun.changedCount} changed).{' '}
          <button type="button" className="btn btn--small btn--secondary" onClick={() => openReview(stagedRun.id)}>
            Resume review
          </button>
        </p>
      )}

      <section className="card at-berth-list-section">
        <div className="card__header-row">
          <h2 className="card__title">
            <button
              type="button"
              className="master-company-directory__toggle"
              aria-expanded={directoryOpen}
              aria-controls="company-directory-panel"
              onClick={() => setDirectoryOpen((open) => !open)}
            >
              <span className="master-company-directory__chevron" aria-hidden="true">
                {directoryOpen ? '▾' : '▸'}
              </span>
              Company directory
            </button>
          </h2>
          <div className="card__toolbar">
            <button type="button" className="btn btn--secondary" onClick={loadCompanies} disabled={loading}>
              Refresh
            </button>
            <button type="button" className="btn btn--secondary" onClick={handleSync} disabled={!canDoEdit || syncing}>
              {syncing && syncingRecordId == null ? 'Reading DataHub…' : 'Sync from DataHub'}
            </button>
          </div>
        </div>
        {directoryOpen && loading ? (
          <p id="company-directory-panel" className="text-steel">Loading companies…</p>
        ) : null}
        {directoryOpen && !loading ? (
          <div id="company-directory-panel" className="table-wrap">
            <table className="data-table allocation-table">
              <thead>
                <SortableFilterableTableHead
                  columns={COMPANY_COLUMNS}
                  sortState={sortState}
                  onSort={handleSort}
                  filters={filters}
                  onFilterChange={updateFilter}
                  trailingBlankCols={1}
                />
              </thead>
              <tbody>
                {displayRows.length === 0 ? (
                  <tr>
                    <td colSpan={COMPANY_COLUMNS.length + 1} className="text-steel">No companies yet. Sync from DataHub.</td>
                  </tr>
                ) : (
                  displayRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.shortName || '—'}</td>
                      <td>{row.companyCodeSap || '—'}</td>
                      <td>{row.country || '—'}</td>
                      <td>{row.hubCode ? row.hubCode : <MasterSourceBadge kind="local" />}</td>
                      <td>{row.isActive === false ? 'No' : 'Yes'}</td>
                      <td>{formatMasterCreatedLine(row)}</td>
                      <td>{formatMasterLastUpdatedLine(row)}</td>
                      <td className="allocation-table__action-col">
                        <DataHubRecordSyncButton
                          hubCode={row.hubCode}
                          canEdit={canDoEdit}
                          busy={syncing}
                          syncing={syncingRecordId === row.id}
                          onClick={() => handleRecordSync(row)}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="card at-berth-list-section">
        <div className="card__header-row">
          <h2 className="card__title">Companies at this port</h2>
        </div>
        <MasterWorkingPortBar meta={mapLoading ? 'Loading…' : `${checkedIds.length} selected`} />
        {selectedPortId == null || requiresSelection ? (
          <p className="text-steel">{t('masterNeedWorkingPort')}</p>
        ) : (
          <>
            <p className="text-steel">Unchecked companies stay in the directory and do not appear on shipping instructions at this port.</p>
            {activeCompanies.length === 0 ? (
              <p className="text-steel">No active companies to assign.</p>
            ) : (
              <ul className="master-company-port-list">
                {activeCompanies.map((company) => (
                  <li key={company.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={checkedIds.includes(company.id)}
                        onChange={() => toggleCompany(company.id)}
                        disabled={!canMap || savingMap}
                      />{' '}
                      {company.shortName || company.name}
                      {company.shortName ? <span className="text-steel"> — {company.name}</span> : null}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="btn btn--primary" onClick={saveMap} disabled={!canMap || savingMap}>
              {savingMap ? 'Saving…' : 'Save companies for this port'}
            </button>
          </>
        )}
      </section>

      {review && (
        <DataHubSyncReviewModal
          run={review.run}
          items={review.items}
          applying={applying}
          error={syncError}
          onApply={handleApply}
          onDiscard={handleDiscard}
          onClose={() => setReview(null)}
          recordNoun={DATAHUB_COMPANY_REVIEW_META.recordNoun}
          newHint={DATAHUB_COMPANY_REVIEW_META.newHint}
        />
      )}
    </div>
  )
}
