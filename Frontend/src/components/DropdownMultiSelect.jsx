import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'

/**
 * Dropdown multi-select: trigger shows selected labels (or placeholder); click opens panel with checkboxes.
 * Optional in-panel Search… filter (case-insensitive on option labels).
 * @param {Object} props
 * @param {Array<{ value: string, label: string, keywords?: string }>} props.options
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
 * @param {string} [props.ariaLabel]
 * @param {boolean} [props.portal] - render the panel on document.body so overflow clipping does not hide it
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
  ariaLabel,
  portal = false,
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [panelStyle, setPanelStyle] = useState(null)
  const containerRef = useRef(null)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const searchRef = useRef(null)

  const updatePanelPosition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPanelStyle({
      position: 'fixed',
      top: rect.bottom + 2,
      left: rect.left,
      width: Math.max(rect.width, 180),
      maxHeight: Math.min(220, Math.max(120, window.innerHeight - rect.bottom - 12)),
      zIndex: 1100,
    })
  }, [])

  useLayoutEffect(() => {
    if (!open || !portal) return undefined
    updatePanelPosition()
    window.addEventListener('scroll', updatePanelPosition, true)
    window.addEventListener('resize', updatePanelPosition)
    return () => {
      window.removeEventListener('scroll', updatePanelPosition, true)
      window.removeEventListener('resize', updatePanelPosition)
    }
  }, [open, portal, updatePanelPosition])

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
    if (!open) return undefined
    const handleClickOutside = (e) => {
      if (containerRef.current?.contains(e.target)) return
      if (panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const handleKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('click', handleClickOutside)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('click', handleClickOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const filteredOptions = useMemo(() => {
    if (!searchable) return options
    const term = search.trim().toLowerCase()
    if (!term) return options
    return options.filter((opt) => {
      const hay = `${opt.label || ''} ${opt.keywords || ''}`.toLowerCase()
      return hay.includes(term)
    })
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

  const panel = (
    <div
      ref={panelRef}
      className={`dropdown-multi__panel${open ? ' is-open' : ''}${searchable ? ' dropdown-multi__panel--searchable' : ''}${panelClassName ? ` ${panelClassName}` : ''}`}
      style={portal ? panelStyle || undefined : undefined}
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
  )

  return (
    <div className={`dropdown-multi ${className}`} ref={containerRef}>
      {label && (
        <label id={id ? `${id}-label` : undefined} className="dropdown-multi__label">
          {label}
        </label>
      )}
      <button
        ref={triggerRef}
        type="button"
        className={`dropdown-multi__trigger${hasSelection ? ' is-active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-labelledby={!ariaLabel && label && id ? `${id}-label` : undefined}
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
      {portal ? open && panelStyle && createPortal(panel, document.body) : panel}
    </div>
  )
}
