import { useState, useRef, useEffect, useMemo } from 'react'

/**
 * Dropdown multi-select: trigger shows selected labels (or placeholder); click opens panel with checkboxes.
 * Optional in-panel Search… filter (case-insensitive on option labels).
 * @param {Object} props
 * @param {Array<{ value: string, label: string }>} props.options
 * @param {string[]} props.selectedValues
 * @param {function(string[]): void} props.onChange
 * @param {string} [props.placeholder] - e.g. "Select jetty..."
 * @param {string} [props.titleLabel] - when set, active trigger shows "Title (n)" instead of joined labels
 * @param {string} [props.label] - for aria
 * @param {string} [props.id] - for aria
 * @param {string} [props.className]
 * @param {string} [props.panelClassName]
 * @param {string} [props.emptyText]
 * @param {boolean} [props.searchable] - show Search… input in the panel
 * @param {string} [props.searchPlaceholder]
 */
export default function DropdownMultiSelect({
  options = [],
  selectedValues = [],
  onChange,
  placeholder = 'Select...',
  titleLabel,
  label,
  id,
  className = '',
  panelClassName = '',
  emptyText = 'No options',
  disabled = false,
  searchable = false,
  searchPlaceholder = 'Search...',
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef(null)
  const searchRef = useRef(null)

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!open) {
      setSearch('')
      return
    }
    if (searchable) {
      const t = window.setTimeout(() => searchRef.current?.focus(), 0)
      return () => window.clearTimeout(t)
    }
  }, [open, searchable])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [open])

  const filteredOptions = useMemo(() => {
    if (!searchable) return options
    const term = search.trim().toLowerCase()
    if (!term) return options
    return options.filter((opt) => String(opt.label || '').toLowerCase().includes(term))
  }, [options, search, searchable])

  const selectedLabels = selectedValues
    .map((v) => options.find((o) => o.value === v)?.label ?? v)
    .filter(Boolean)

  const hasSelection = selectedValues.length > 0
  let displayText = placeholder
  if (titleLabel && hasSelection) {
    displayText = `${titleLabel} (${selectedValues.length})`
  } else if (selectedLabels.length > 0) {
    displayText = selectedLabels.join(', ')
  }

  const toggleOption = (value) => {
    if (disabled) return
    const next = selectedValues.includes(value)
      ? selectedValues.filter((x) => x !== value)
      : [...selectedValues, value]
    onChange(next)
  }

  return (
    <div className={`dropdown-multi ${className}`} ref={containerRef}>
      {label && (
        <label id={id ? `${id}-label` : undefined} className="dropdown-multi__label">
          {label}
        </label>
      )}
      <button
        type="button"
        className={`dropdown-multi__trigger${hasSelection ? ' is-active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={label && id ? `${id}-label` : undefined}
        id={id}
        disabled={disabled}
      >
        <span className="dropdown-multi__trigger-text">
          {titleLabel && hasSelection ? (
            <>
              {titleLabel}{' '}
              <span className="dropdown-multi__count">({selectedValues.length})</span>
            </>
          ) : (
            displayText
          )}
        </span>
        <span className="dropdown-multi__chevron" aria-hidden>▼</span>
      </button>
      <div
        className={`dropdown-multi__panel${open ? ' is-open' : ''}${searchable ? ' dropdown-multi__panel--searchable' : ''}${panelClassName ? ` ${panelClassName}` : ''}`}
        role="listbox"
        aria-multiselectable="true"
        aria-hidden={!open}
      >
        {searchable ? (
          <div className="dropdown-multi__search-wrap" onClick={(e) => e.stopPropagation()}>
            <input
              ref={searchRef}
              type="search"
              className="dropdown-multi__search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              autoComplete="off"
              aria-label={searchPlaceholder}
            />
          </div>
        ) : null}
        {options.length === 0 ? (
          <div className="dropdown-multi__empty">{emptyText}</div>
        ) : filteredOptions.length === 0 ? (
          <div className="dropdown-multi__empty">No matches</div>
        ) : (
          <ul className="dropdown-multi__list">
            {filteredOptions.map((opt) => (
              <li key={opt.value} role="option" aria-selected={selectedValues.includes(opt.value)}>
                <label className="dropdown-multi__option">
                  <input
                    type="checkbox"
                    checked={selectedValues.includes(opt.value)}
                    disabled={disabled}
                    onChange={() => toggleOption(opt.value)}
                  />
                  <span>{opt.label}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
