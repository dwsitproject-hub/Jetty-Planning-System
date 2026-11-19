import { useTranslation } from 'react-i18next'
import { QC_FILTERS, QC_SAILED_SORTS, QC_SORTS } from '../../utils/qcQueue'

const FILTER_LABEL_KEYS = {
  needs: 'queue.filterNeeds',
  done: 'queue.filterDone',
  all: 'queue.filterAll',
  sailed: 'queue.filterSailed',
}
const SORT_LABEL_KEYS = {
  tb: 'queue.sortTb',
  castOff: 'queue.sortCastOff',
  vesselName: 'queue.sortVesselName',
  jetty: 'queue.sortJetty',
}

/** Cast-off From / To days for the "Sailed" filter (defaults to the last 30 days). */
function SailedRangeFields({ queue, t }) {
  const { sailedRange, setSailedRange, rangeError } = queue
  const idPrefix = `${queue.ns}-sailed`
  const field = (key) => (
    <div className="qc-field">
      <label className="qc-field__label" htmlFor={`${idPrefix}-${key}`}>
        {t(key === 'from' ? 'queue.sailedFrom' : 'queue.sailedTo')}
      </label>
      <input
        id={`${idPrefix}-${key}`}
        type="date"
        className="qc-input"
        value={sailedRange[key]}
        aria-invalid={rangeError ? 'true' : undefined}
        onChange={(e) => setSailedRange((prev) => ({ ...prev, [key]: e.target.value }))}
      />
    </div>
  )
  return (
    <div className="qc-sailed-range" role="group" aria-label={t('queue.sailedRange')}>
      <p className="qc-sailed-range__hint">{t('queue.sailedHint')}</p>
      <div className="qc-sailed-range__fields">
        {field('from')}
        {field('to')}
      </div>
      {rangeError ? (
        <p className="qc-field__error" role="alert">
          {t(`queue.sailedRangeError.${rangeError}`)}
        </p>
      ) : null}
    </div>
  )
}

/** Filter chips, search, sort and refresh for the queue (phone page and desktop pane). */
export default function QcQueueToolbar({ queue }) {
  const { t } = useTranslation(queue.ns)
  const { filter, setFilter, search, setSearch, sortBy, setSortBy, loading, reload, sailed } = queue
  const sorts = sailed ? QC_SAILED_SORTS : QC_SORTS

  return (
    <>
      <div className="qc-filter-chips" role="tablist" aria-label={t('queue.title')}>
        {QC_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            className={`qc-filter-chip${f === 'sailed' ? ' qc-filter-chip--sailed' : ''}${filter === f ? ' qc-filter-chip--active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {t(FILTER_LABEL_KEYS[f])}
          </button>
        ))}
      </div>

      {sailed ? <SailedRangeFields queue={queue} t={t} /> : null}

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
          <label htmlFor={`${queue.ns}-queue-sort`}>{t('queue.sortBy')}</label>
          <select id={`${queue.ns}-queue-sort`} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {sorts.map((s) => (
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
