import { useTranslation } from 'react-i18next'
import { QC_FILTERS, QC_SAILED_SORTS, QC_SORTS } from '../../utils/qcQueue'

const FILTER_LABEL_KEYS = { needs: 'queue.filterNeeds', done: 'queue.filterDone', all: 'queue.filterAll' }
const SORT_LABEL_KEYS = {
  tb: 'queue.sortTb',
  castOff: 'queue.sortCastOff',
  vesselName: 'queue.sortVesselName',
  jetty: 'queue.sortJetty',
}

/** "At berth | Sailed": which vessels the list shows (berthed and editable, or sailed and view only). */
function ScopeSwitch({ queue, t }) {
  const options = [
    ['active', t('queue.scopeActive')],
    ['sailed', t('queue.filterSailed')],
  ]
  return (
    <div className="qc-scope" role="tablist" aria-label={t('queue.scopeLabel')}>
      {options.map(([scope, label]) => {
        const active = (scope === 'sailed') === queue.sailed
        return (
          <button
            key={scope}
            type="button"
            role="tab"
            aria-selected={active}
            className={`qc-scope__option${active ? ' qc-scope__option--active' : ''}`}
            onClick={() => queue.setScope(scope)}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

/** One line: "Cast off [from] – [to]" (defaults to the last 30 days). */
function SailedRangeFields({ queue, t }) {
  const { sailedRange, setSailedRange, rangeError } = queue
  const date = (key) => (
    <input
      type="date"
      className="qc-input qc-sailed-range__date"
      value={sailedRange[key]}
      aria-label={t(key === 'from' ? 'queue.sailedFrom' : 'queue.sailedTo')}
      aria-invalid={rangeError ? 'true' : undefined}
      onChange={(e) => setSailedRange((prev) => ({ ...prev, [key]: e.target.value }))}
    />
  )
  return (
    <div className="qc-sailed-range" role="group" aria-label={t('queue.sailedRange')}>
      <div className="qc-sailed-range__row">
        <span className="qc-sailed-range__label">{t('queue.castOffLabel')}</span>
        {date('from')}
        <span className="qc-sailed-range__dash" aria-hidden="true">
          –
        </span>
        {date('to')}
      </div>
      {rangeError ? (
        <p className="qc-field__error" role="alert">
          {t(`queue.sailedRangeError.${rangeError}`)}
        </p>
      ) : null}
    </div>
  )
}

/** Scope switch, status chips or sailed date range, then search / sort / refresh on one line. */
export default function QcQueueToolbar({ queue }) {
  const { t } = useTranslation(queue.ns)
  const { filter, setFilter, search, setSearch, sortBy, setSortBy, loading, reload, sailed } = queue
  const sorts = sailed ? QC_SAILED_SORTS : QC_SORTS

  return (
    <div className="qc-toolbar">
      <ScopeSwitch queue={queue} t={t} />

      {sailed ? (
        <SailedRangeFields queue={queue} t={t} />
      ) : (
        <div className="qc-filter-chips qc-filter-chips--compact" role="group" aria-label={t('queue.title')}>
          {QC_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              className={`qc-filter-chip${filter === f ? ' qc-filter-chip--active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {t(FILTER_LABEL_KEYS[f])}
            </button>
          ))}
        </div>
      )}

      <div className="qc-toolbar__row">
        <input
          type="search"
          className="qc-input qc-queue__search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('queue.searchPlaceholder')}
          aria-label={t('queue.searchLabel')}
        />
        <select
          className="qc-toolbar__sort"
          value={sortBy}
          aria-label={t('queue.sortBy')}
          title={t('queue.sortBy')}
          onChange={(e) => setSortBy(e.target.value)}
        >
          {sorts.map((s) => (
            <option key={s} value={s}>
              {t(SORT_LABEL_KEYS[s])}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="op-btn op-btn--soft qc-toolbar__refresh"
          onClick={reload}
          disabled={loading}
          aria-label={t('queue.refresh')}
          title={t('queue.refresh')}
        >
          <span aria-hidden="true">↻</span>
        </button>
      </div>
    </div>
  )
}
