import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  createNoFlowReason,
  deleteNoFlowReason,
  fetchNoFlowReasons,
  updateNoFlowReason,
} from '../api/masterNoFlowReasons'
import { usePortScope } from '../context/PortScopeContext'
import { useRbac } from '../context/RbacContext'
import MasterSourceBadge from '../components/MasterSourceBadge.jsx'
import MasterWorkingPortBar from '../components/MasterWorkingPortBar.jsx'
import NoFlowReasonFormModal from '../components/master/NoFlowReasonFormModal.jsx'
import NoFlowPortSettingCard from '../components/master/NoFlowPortSettingCard.jsx'
import SortableFilterableTableHead from '../components/SortableFilterableTableHead.jsx'
import { useSortableFilterableRows } from '../hooks/useSortableFilterableRows.js'
import { formatMasterCreatedLine, formatMasterLastUpdatedLine, MASTER_AUDIT_COLUMNS } from '../utils/formatMasterAudit.js'
import '../styles/allocation.css'
import '../styles/modal.css'

const PAGE_KEY = 'master-no-flow-reasons'

export default function MasterNoFlowReasons() {
  const { t } = useTranslation('pages')
  const { canEdit, canDelete } = useRbac()
  const canDoEdit = canEdit(PAGE_KEY)
  const canDoDelete = canDelete(PAGE_KEY)
  const { selectedPortId, noPortAssigned, requiresSelection } = usePortScope()
  const portId = selectedPortId != null && !requiresSelection && !noPortAssigned ? String(selectedPortId) : ''

  const [reasons, setReasons] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const [editing, setEditing] = useState(undefined)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setReasons(await fetchNoFlowReasons())
    } catch (e) {
      setError(e?.message || t('noFlowLoadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 5500)
    return () => window.clearTimeout(timer)
  }, [toast])

  const columns = useMemo(
    () => [
      { key: 'code', label: t('noFlowReasonColCode'), getSortValue: (r) => r.code, getFilterValue: (r) => r.code },
      { key: 'nameEn', label: t('noFlowReasonColNameEn'), getSortValue: (r) => r.nameEn.toLowerCase(), getFilterValue: (r) => r.nameEn },
      { key: 'nameId', label: t('noFlowReasonColNameId'), getSortValue: (r) => r.nameId.toLowerCase(), getFilterValue: (r) => r.nameId },
      { key: 'category', label: t('noFlowReasonColCategory'), getSortValue: (r) => r.category, getFilterValue: (r) => t(`noFlowCategory_${r.category}`) },
      { key: 'requiresNote', label: t('noFlowReasonColNote'), getSortValue: (r) => (r.requiresNote ? 1 : 0), getFilterValue: (r) => (r.requiresNote ? t('kurasRuleYes') : t('kurasRuleNo')) },
      { key: 'sortOrder', label: t('noFlowReasonColSort'), getSortValue: (r) => r.sortOrder },
      { key: 'active', label: t('kurasRuleColActive'), getSortValue: (r) => (r.isActive ? 1 : 0), getFilterValue: (r) => (r.isActive ? t('kurasRuleYes') : t('kurasRuleNo')) },
      ...MASTER_AUDIT_COLUMNS,
    ],
    [t]
  )

  const { displayRows, filters, updateFilter, sortState, handleSort } = useSortableFilterableRows(reasons, columns, {
    key: 'sortOrder',
    dir: 'asc',
  })

  const run = async (fn, message) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
      setToast(message)
      return true
    } catch (e) {
      setError(e?.message || t('kurasRuleSaveFailed'))
      return false
    } finally {
      setBusy(false)
    }
  }

  const handleSave = async (values) => {
    const ok = await run(() => (editing ? updateNoFlowReason(editing.id, values) : createNoFlowReason(values)), t('noFlowReasonSaved'))
    if (ok) setEditing(undefined)
  }

  const handleDelete = (r) => {
    if (!window.confirm(t('noFlowReasonDeleteConfirm', { name: r.nameEn }))) return
    run(() => deleteNoFlowReason(r.id), t('noFlowReasonDeleted'))
  }

  return (
    <div className="allocation-page">
      <h1 className="page-title page-title-row">
        {t('masterHubNoFlowReasonsTitle')}
        <MasterSourceBadge kind="local" />
      </h1>
      <p className="allocation-page__intro">{t('masterHubNoFlowReasonsDesc')}</p>
      <p className="text-steel">
        <Link to="/master" className="link">← {t('masterBackToMenu')}</Link>
      </p>
      <MasterWorkingPortBar />
      {error && <p className="allocation-page__intro" style={{ color: 'var(--color-danger, #c00)' }} role="alert">{error}</p>}
      {toast && <p className="allocation-page__intro" style={{ color: 'var(--color-success, #0a7)' }} role="status">{toast}</p>}

      <NoFlowPortSettingCard portId={portId} canEdit={canDoEdit} />

      <section className="card at-berth-list-section">
        <div className="card__header-row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <h2 className="card__title">{t('noFlowReasonListTitle')}</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--secondary btn--small" onClick={load} disabled={loading}>{t('kurasRuleRefresh')}</button>
            <button type="button" className="btn btn--primary" onClick={() => setEditing(null)} disabled={!canDoEdit}>{t('noFlowReasonAdd')}</button>
          </div>
        </div>
        {loading ? (
          <p className="text-steel">{t('noFlowLoading')}</p>
        ) : (
          <div className="table-wrap table-wrap--pin-actions table-wrap--pin-actions--pair">
            <table className="data-table allocation-table">
              <thead>
                <SortableFilterableTableHead
                  columns={columns}
                  sortState={sortState}
                  onSort={handleSort}
                  filters={filters}
                  onFilterChange={updateFilter}
                  leadingBlankCols={1}
                  leadingBlankLabel={t('kurasRuleColActions')}
                />
              </thead>
              <tbody>
                {displayRows.map((r) => (
                  <tr key={r.id} className="allocation-table__row">
                    <td className="allocation-table__action-col">
                      <div className="allocation-table__action-btns">
                        <button type="button" className="btn btn--small btn--secondary" onClick={() => setEditing(r)} disabled={!canDoEdit}>{t('kurasRuleEdit')}</button>
                        <button type="button" className="btn btn--small btn--secondary" onClick={() => handleDelete(r)} disabled={!canDoDelete || busy}>{t('kurasRuleDelete')}</button>
                      </div>
                    </td>
                    <td><strong>{r.code}</strong></td>
                    <td>{r.nameEn}</td>
                    <td>{r.nameId}</td>
                    <td>{t(`noFlowCategory_${r.category}`)}</td>
                    <td>{r.requiresNote ? t('kurasRuleYes') : t('kurasRuleNo')}</td>
                    <td>{r.sortOrder}</td>
                    <td>{r.isActive ? t('kurasRuleYes') : t('kurasRuleNo')}</td>
                    <td className="text-steel">{formatMasterCreatedLine(r)}</td>
                    <td className="text-steel">{formatMasterLastUpdatedLine(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {displayRows.length === 0 && <p className="text-steel">{t('kurasRuleNoMatch')}</p>}
          </div>
        )}
      </section>

      {editing !== undefined && (
        <NoFlowReasonFormModal reason={editing} saving={busy} onSave={handleSave} onClose={() => setEditing(undefined)} />
      )}
    </div>
  )
}
