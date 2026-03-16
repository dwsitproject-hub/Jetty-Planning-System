import { useState, useRef, useEffect } from 'react'

/**
 * Dropdown multi-select: trigger shows selected labels (or placeholder); click opens panel with checkboxes.
 * @param {Object} props
 * @param {Array<{ value: string, label: string }>} props.options
 * @param {string[]} props.selectedValues
 * @param {function(string[]): void} props.onChange
 * @param {string} [props.placeholder] - e.g. "Select jetty..."
 * @param {string} [props.label] - for aria
 * @param {string} [props.id] - for aria
 * @param {string} [props.className]
 */
export default function DropdownMultiSelect({
  options = [],
  selectedValues = [],
  onChange,
  placeholder = 'Select...',
  label,
  id,
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

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

  const selectedLabels = selectedValues
    .map((v) => options.find((o) => o.value === v)?.label ?? v)
    .filter(Boolean)
  const displayText = selectedLabels.length > 0 ? selectedLabels.join(', ') : placeholder

  const toggleOption = (value) => {
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
        className="dropdown-multi__trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={label && id ? `${id}-label` : undefined}
        id={id}
      >
        <span className="dropdown-multi__trigger-text">{displayText}</span>
        <span className="dropdown-multi__chevron" aria-hidden>▼</span>
      </button>
      {open && (
        <div
          className="dropdown-multi__panel"
          role="listbox"
          aria-multiselectable="true"
        >
          {options.length === 0 ? (
            <div className="dropdown-multi__empty">No options</div>
          ) : (
            <ul className="dropdown-multi__list">
              {options.map((opt) => (
                <li key={opt.value} role="option" aria-selected={selectedValues.includes(opt.value)}>
                  <label className="dropdown-multi__option">
                    <input
                      type="checkbox"
                      checked={selectedValues.includes(opt.value)}
                      onChange={() => toggleOption(opt.value)}
                    />
                    <span>{opt.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
