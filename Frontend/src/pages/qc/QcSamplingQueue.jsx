import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchQcSamplingQueue } from '../../api/qc'
import QcVesselCard from '../../components/qc/QcVesselCard'
import { useRbac } from '../../context/RbacContext'
import { QC_FILTERS, QC_SORTS, filterQcGroups, groupQcQueue, sortQcGroups } from '../../utils/qcQueue'

const FILTER_LABEL_KEYS = { needs: 'queue.filterNeeds', done: 'queue.filterDone', all: 'queue.filterAll' }
const SORT_LABEL_KEYS = { tb: 'queue.sortTb', vesselName: 'queue.sortVesselName', jetty: 'queue.sortJetty' }

export default function QcSamplingQueue() {
  const navigate = useNavigate()
  const { t } = useTranslation('qc')
  const { loading: rbacLoading, canView } = useRbac()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('needs')
  const [sortBy, setSortBy] = useState('tb')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setRows(await fetchQcSamplingQueue())
    } catch (e) {
      setError(e?.message || t('queue.errorLoad'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  const groups = useMemo(() => groupQcQueue(rows), [rows])
  const visible = useMemo(
    () => sortQcGroups(filterQcGroups(groups, filter, search), sortBy),
    [groups, filter, search, sortBy]
  )

  const toggleExpand = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  if (rbacLoading) return <div className="operator-queue__status">{t('queue.loadingPermissions')}</div>
  if (!canView('quality-control')) {
    return (
      <div className="operator-queue">
        <p className="operator-error-banner">{t('queue.noAccess')}</p>
      </div>
    )
  }

  const emptyMessage = rows.length === 0 ? t('queue.noVessels') : t('queue.noMatches')

  return (
    <div className="operator-queue qc-queue">
      <h1 className="operator-queue__title">{t('queue.title')}</h1>
      <p className="operator-queue__sub">{t('queue.sub')}</p>

      <div className="qc-filter-chips" role="tablist" aria-label={t('queue.title')}>
        {QC_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            className={`qc-filter-chip${filter === f ? ' qc-filter-chip--active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {t(FILTER_LABEL_KEYS[f])}
          </button>
        ))}
      </div>

      <div className="qc-queue__tools">
        <input
          type="search"
          className="qc-input qc-queue__search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('queue.searchPlaceholder')}
          aria-label={t('queue.searchLabel')}
        />
        <div className="operator-queue__sort">
          <label htmlFor="qc-queue-sort">{t('queue.sortBy')}</label>
          <select id="qc-queue-sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {QC_SORTS.map((s) => (
              <option key={s} value={s}>
                {t(SORT_LABEL_KEYS[s])}
              </option>
            ))}
          </select>
          <button type="button" className="op-btn op-btn--soft qc-queue__refresh" onClick={load} disabled={loading}>
            {t('queue.refresh')}
          </button>
        </div>
      </div>

      {loading ? <p className="operator-queue__status">{t('queue.loading')}</p> : null}
      {error ? (
        <div className="operator-error-banner qc-error-row" role="alert">
          <span>{error}</span>
          <button type="button" className="op-btn op-btn--soft" onClick={load}>
            {t('queue.retry')}
          </button>
        </div>
      ) : null}
      {!loading && !error && visible.length === 0 ? (
        <p className="operator-queue__status">{emptyMessage}</p>
      ) : null}

      {visible.map((group) => (
        <QcVesselCard
          key={group.key}
          group={group}
          expanded={expanded.has(group.key)}
          onToggle={toggleExpand}
          onOpen={(row) => navigate(`/qc/sampling/${row.operationId}`)}
        />
      ))}
    </div>
  )
}
