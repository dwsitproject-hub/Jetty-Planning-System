import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WINDOW_PRESETS } from './partnerActivityFormat.js'

const SEARCH_DEBOUNCE_MS = 400

function Chips({ label, options, value, onChange }) {
  return (
    <div className="partner-filters__group" role="group" aria-label={label}>
      <span className="partner-filters__label">{label}</span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`partner-chip${value === o.value ? ' is-active' : ''}`}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Shared filter bar for the Activity card panels.
 * chips: [{ value, label }] (value '' = All). selects: [{ id, label, value, options: [{ value, label }], onChange }].
 */
export default function ActivityFilterBar({
  windowHours,
  onWindowChange,
  chipsLabel,
  chips,
  chipValue,
  onChip,
  selects,
  search,
  onSearch,
  searchPlaceholder,
  autoRefresh,
  onAutoRefresh,
  updatedLabel,
}) {
  const { t } = useTranslation('pages')
  const [searchInput, setSearchInput] = useState(search)

  useEffect(() => {
    if (searchInput === search) return undefined
    const id = window.setTimeout(() => onSearch(searchInput), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [searchInput, search, onSearch])

  return (
    <div className="partner-filters">
      <div className="partner-filters__row">
        <Chips
          label={t('partnerActWindowLabel')}
          options={WINDOW_PRESETS.map((p) => ({ value: p.hours, label: p.label }))}
          value={windowHours}
          onChange={onWindowChange}
        />
        <Chips label={chipsLabel} options={chips} value={chipValue} onChange={onChip} />
      </div>
      <div className="partner-filters__row">
        {selects.map((s) => (
          <label key={s.id} className="partner-filters__field">
            <span className="partner-filters__label">{s.label}</span>
            <select value={s.value} onChange={(e) => s.onChange(e.target.value)}>
              {s.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="partner-filters__field partner-filters__field--grow">
          <span className="partner-filters__label">{t('partnerActSearch')}</span>
          <input
            type="search"
            value={searchInput}
            placeholder={searchPlaceholder}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </label>
        <label className="partner-filters__auto">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => onAutoRefresh(e.target.checked)} />
          {t('partnerActAutoRefresh')}
        </label>
        <span className="partner-filters__updated" aria-live="polite">
          {updatedLabel}
        </span>
      </div>
    </div>
  )
}
