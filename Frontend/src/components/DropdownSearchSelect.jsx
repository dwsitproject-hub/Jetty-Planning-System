import { useState, useRef, useEffect, useMemo } from 'react'

/**
 * Searchable single-select dropdown (same styling as DropdownMultiSelect).
 * @param {Object} props
 * @param {Array<{ value: string, label: string }>} props.options
 * @param {string} [props.value] - selected option value
 * @param {function(string): void} props.onChange - empty string when cleared
 */
export default function DropdownSearchSelect({
  options = [],
  value = '',
  onChange,
  placeholder = 'Select...',
  label,
  id,
  className = '',
  panelClassName = '',
  emptyText = 'No options',
  disabled = false,
  searchable = true,
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

  const selectedLabel = value
    ? options.find((o) => o.value === value)?.label ?? value
    : ''
  const hasSelection = Boolean(value)
  const displayText = selectedLabel || placeholder

  const pickOption = (optValue) => {
    if (disabled) return
    onChange(optValue)
    setOpen(false)
  }

  return (
    <div className={`dropdown-multi ${className}`} ref={containerRef}>
      {label ? (
        <label id={id ? `${id}-label` : undefined} className="dropdown-multi__label">
          {label}
        </label>
      ) : null}
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
        <span className="dropdown-multi__trigger-text">{displayText}</span>
        <span className="dropdown-multi__chevron" aria-hidden>
          ▼
        </span>
      </button>
      <div
        className={`dropdown-multi__panel${open ? ' is-open' : ''}${searchable ? ' dropdown-multi__panel--searchable' : ''}${panelClassName ? ` ${panelClassName}` : ''}`}
        role="listbox"
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
              <li key={opt.value} role="option" aria-selected={value === opt.value}>
                <button
                  type="button"
                  className={`dropdown-multi__option dropdown-multi__option--single${value === opt.value ? ' is-selected' : ''}`}
                  onClick={() => pickOption(opt.value)}
                  disabled={disabled}
                >
                  {opt.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
