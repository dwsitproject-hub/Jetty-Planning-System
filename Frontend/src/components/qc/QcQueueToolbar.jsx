import { useTranslation } from 'react-i18next'
import { QC_FILTERS, QC_SORTS } from '../../utils/qcQueue'

const FILTER_LABEL_KEYS = { needs: 'queue.filterNeeds', done: 'queue.filterDone', all: 'queue.filterAll' }
const SORT_LABEL_KEYS = { tb: 'queue.sortTb', vesselName: 'queue.sortVesselName', jetty: 'queue.sortJetty' }

/** Filter chips, search, sort and refresh for the queue (phone page and desktop pane). */
export default function QcQueueToolbar({ queue }) {
  const { t } = useTranslation('qc')
  const { filter, setFilter, search, setSearch, sortBy, setSortBy, loading, reload } = queue

  return (
    <>
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
          <button type="button" className="op-btn op-btn--soft qc-queue__refresh" onClick={reload} disabled={loading}>
            {t('queue.refresh')}
          </button>
        </div>
      </div>
    </>
  )
}
