import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  createKurasRule,
  deleteKurasRule,
  fetchKurasRules,
  recheckKurasRules,
  updateKurasRule,
} from '../api/masterKurasRules'
import { fetchSiLookups } from '../api/siLookups'
import { usePortScope } from '../context/PortScopeContext'
import { useRbac } from '../context/RbacContext'
import MasterSourceBadge from '../components/MasterSourceBadge.jsx'
import MasterWorkingPortBar from '../components/MasterWorkingPortBar.jsx'
import KurasRuleFormModal from '../components/master/KurasRuleFormModal.jsx'
import SortableFilterableTableHead from '../components/SortableFilterableTableHead.jsx'
import { useSortableFilterableRows } from '../hooks/useSortableFilterableRows.js'
import { formatMasterCreatedLine, formatMasterLastUpdatedLine, MASTER_AUDIT_COLUMNS } from '../utils/formatMasterAudit.js'
import '../styles/allocation.css'
import '../styles/modal.css'

const PAGE_KEY = 'master-kuras-rules'

export default function MasterKurasRules() {
  const { t } = useTranslation('pages')
  const { canEdit, canDelete } = useRbac()
  const canDoEdit = canEdit(PAGE_KEY)
  const canDoDelete = canDelete(PAGE_KEY)
  const { selectedPortId, noPortAssigned, requiresSelection } = usePortScope()
  const portId = selectedPortId != null ? String(selectedPortId) : ''
  const canManage = Boolean(portId) && !requiresSelection && !noPortAssigned

  const [rules, setRules] = useState([])
  const [commodities, setCommodities] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const [editing, setEditing] = useState(undefined)

  const loadRules = useCallback(async () => {
    if (!portId) {
      setRules([])
      setLoading(false)
      return
    }
    setError(null)
    setLoading(true)
    try {
      setRules(await fetchKurasRules(portId))
    } catch (e) {
      setRules([])
      setError(e?.message || t('kurasRuleLoadFailed'))
    } finally {
      setLoading(false)
    }
  }, [portId, t])

  useEffect(() => {
    loadRules()
  }, [loadRules])

  useEffect(() => {
    fetchSiLookups()
      .then((lk) =>
        setCommodities(
          (lk?.commodities || []).map((c) => ({ id: String(c.id), label: c.shortName || c.name || String(c.id) }))
        )
      )
      .catch(() => setCommodities([]))
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 5500)
    return () => window.clearTimeout(timer)
  }, [toast])

  const commodityLabel = useCallback(
    (r) => (r.isDefault ? t('kurasRuleAllOthers') : r.commodities.map((c) => c.label).join(', ')),
    [t]
  )

  const columns = useMemo(
    () => [
      { key: 'commodities', label: t('kurasRuleColCommodities'), getSortValue: (r) => (r.isDefault ? '~' : commodityLabel(r)), getFilterValue: commodityLabel },
      { key: 'remaining', label: t('kurasRuleColRemaining'), getSortValue: (r) => r.remainingPctBelow, getFilterValue: (r) => `${r.remainingPctBelow}%` },
      { key: 'rate', label: t('kurasRuleColRate'), getSortValue: (r) => r.rateMtPerHourBelow, getFilterValue: (r) => `${r.rateMtPerHourBelow} MT/h` },
      { key: 'match', label: t('kurasRuleColMatch'), getSortValue: (r) => r.matchMode, getFilterValue: (r) => r.matchMode.toUpperCase() },
      { key: 'active', label: t('kurasRuleColActive'), getSortValue: (r) => (r.isActive ? 1 : 0), getFilterValue: (r) => (r.isActive ? t('kurasRuleYes') : t('kurasRuleNo')) },
      ...MASTER_AUDIT_COLUMNS,
    ],
    [t, commodityLabel]
  )

  const { displayRows, filters, updateFilter, sortState, handleSort } = useSortableFilterableRows(rules, columns, {
    key: 'commodities',
    dir: 'asc',
  })

  const run = async (fn, successMessage) => {
    setBusy(true)
    setError(null)
    try {
      const result = await fn()
      await loadRules()
      setToast(typeof successMessage === 'function' ? successMessage(result) : successMessage)
      return true
    } catch (e) {
      setError(e?.message || t('kurasRuleSaveFailed'))
      return false
    } finally {
      setBusy(false)
    }
  }

  const handleSave = async (values) => {
    const ok = await run(
      () => (editing ? updateKurasRule(editing.id, values) : createKurasRule(Number(portId), values)),
      t('kurasRuleSaved')
    )
    if (ok) setEditing(undefined)
  }

  const handleDelete = (rule) => {
    if (!window.confirm(t('kurasRuleDeleteConfirm', { name: commodityLabel(rule) }))) return
    run(() => deleteKurasRule(rule.id), t('kurasRuleDeleted'))
  }

  const handleRecheck = () => {
    if (!window.confirm(t('kurasRuleRecheckConfirm'))) return
    run(() => recheckKurasRules(Number(portId)), (r) => t('kurasRuleRecheckDone', { count: r?.updated ?? 0, voyages: r?.operations ?? 0 }))
  }

  return (
    <div className="allocation-page">
      <h1 className="page-title page-title-row">
        {t('masterHubKurasRulesTitle')}
        <MasterSourceBadge kind="local" />
      </h1>
      <p className="allocation-page__intro">{t('masterHubKurasRulesDesc')}</p>
      <p className="text-steel">
        <Link to="/master" className="link">← {t('masterBackToMenu')}</Link>
      </p>
      <MasterWorkingPortBar />

      {error && (
        <p className="allocation-page__intro" style={{ color: 'var(--color-danger, #c00)' }} role="alert">{error}</p>
      )}
      {toast && (
        <p className="allocation-page__intro" style={{ color: 'var(--color-success, #0a7)' }} role="status">{toast}</p>
      )}

      <section className="card at-berth-list-section">
        <div className="card__header-row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <h2 className="card__title">{t('kurasRuleListTitle')}</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--secondary btn--small" onClick={loadRules} disabled={loading || !canManage}>
              {t('kurasRuleRefresh')}
            </button>
            <button type="button" className="btn btn--secondary btn--small" onClick={handleRecheck} disabled={!canDoEdit || !canManage || busy}>
              {t('kurasRuleRecheck')}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => setEditing(null)} disabled={!canDoEdit || !canManage}>
              {t('kurasRuleAdd')}
            </button>
          </div>
        </div>
        <p className="text-steel">{t('kurasRuleHint')}</p>
        {loading ? (
          <p className="text-steel">{t('kurasRuleLoading')}</p>
        ) : !canManage ? (
          <p className="text-steel">{t('masterNeedWorkingPort')}</p>
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
                        <button type="button" className="btn btn--small btn--secondary" onClick={() => setEditing(r)} disabled={!canDoEdit}>
                          {t('kurasRuleEdit')}
                        </button>
                        <button type="button" className="btn btn--small btn--secondary" onClick={() => handleDelete(r)}
                          disabled={!canDoDelete || busy || r.isDefault} title={r.isDefault ? t('kurasRuleDefaultNoDelete') : undefined}>
                          {t('kurasRuleDelete')}
                        </button>
                      </div>
                    </td>
                    <td className={r.isDefault ? 'text-steel' : undefined}><strong>{commodityLabel(r)}</strong></td>
                    <td>{r.remainingPctBelow}%</td>
                    <td>{r.rateMtPerHourBelow} MT/h</td>
                    <td>{r.matchMode === 'or' ? t('kurasRuleMatchOr') : t('kurasRuleMatchAnd')}</td>
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
        <KurasRuleFormModal
          rule={editing}
          rules={rules}
          commodities={commodities}
          saving={busy}
          onSave={handleSave}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  )
}
