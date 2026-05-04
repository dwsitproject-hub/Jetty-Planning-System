import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'

/**
 * Single-select with search; panel rendered in a portal to avoid modal overflow clipping.
 * @param {Object} props
 * @param {string} [props.id]
 * @param {string} [props.label]
 * @param {{ value: string, label: string }[]} props.options
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {string} [props.placeholder]
 * @param {boolean} [props.disabled]
 * @param {string} [props.className]
 */
export default function SearchableSingleSelect({
  id,
  label,
  options = [],
  value,
  onChange,
  placeholder = 'Select…',
  disabled = false,
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [panelStyle, setPanelStyle] = useState(null)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const searchInputRef = useRef(null)

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) =>
        o.value.toLowerCase().includes(q) ||
        (o.label && o.label.toLowerCase().includes(q))
    )
  }, [options, filter])

  const selectedLabel = useMemo(() => {
    const hit = options.find((o) => o.value === value)
    if (hit) return hit.label
    if (value) return value
    return placeholder
  }, [options, value, placeholder])

  const updatePanelPosition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const maxH = Math.min(280, Math.max(120, window.innerHeight - r.bottom - 12))
    setPanelStyle({
      position: 'fixed',
      top: r.bottom + 4,
      left: r.left,
      width: Math.max(r.width, 220),
      maxHeight: maxH,
      zIndex: 1100,
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) {
      setPanelStyle(null)
      return
    }
    updatePanelPosition()
    window.addEventListener('scroll', updatePanelPosition, true)
    window.addEventListener('resize', updatePanelPosition)
    return () => {
      window.removeEventListener('scroll', updatePanelPosition, true)
      window.removeEventListener('resize', updatePanelPosition)
    }
  }, [open, updatePanelPosition])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e) => {
      if (triggerRef.current?.contains(e.target)) return
      if (panelRef.current?.contains(e.target)) return
      setOpen(false)
      setFilter('')
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setFilter('')
      }
    }
    document.addEventListener('mousedown', onDocMouseDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (open && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [open])

  const handleSelect = (v) => {
    onChange(v)
    setOpen(false)
    setFilter('')
  }

  const toggleOpen = () => {
    if (disabled) return
    setOpen((o) => !o)
    if (!open) setFilter('')
  }

  const portalContent =
    open &&
    panelStyle &&
    createPortal(
      <div
        ref={panelRef}
        className="searchable-select__portal-root"
        style={panelStyle}
        role="listbox"
        aria-labelledby={label && id ? `${id}-label` : undefined}
      >
        <div className="searchable-select__search-wrap">
          <input
            ref={searchInputRef}
            type="search"
            className="searchable-select__search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search…"
            aria-label="Filter options"
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        <ul className="searchable-select__list">
          {filtered.length === 0 ? (
            <li className="searchable-select__empty">No matches</li>
          ) : (
            filtered.map((opt) => (
              <li key={opt.value} role="option" aria-selected={opt.value === value}>
                <button
                  type="button"
                  className={`searchable-select__option${opt.value === value ? ' searchable-select__option--selected' : ''}`}
                  onClick={() => handleSelect(opt.value)}
                >
                  {opt.label}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>,
      document.body
    )

  return (
    <div className={`searchable-select ${className}`}>
      {label && (
        <label id={id ? `${id}-label` : undefined} htmlFor={id} className="dropdown-multi__label">
          {label}
        </label>
      )}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className="dropdown-multi__trigger searchable-select__trigger"
        onClick={toggleOpen}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={label && id ? `${id}-label` : undefined}
      >
        <span className="dropdown-multi__trigger-text">{selectedLabel}</span>
        <span className="dropdown-multi__chevron" aria-hidden>
          ▼
        </span>
      </button>
      {portalContent}
    </div>
  )
}
