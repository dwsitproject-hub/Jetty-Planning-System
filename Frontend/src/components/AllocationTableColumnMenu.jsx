import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Column visibility picker for the plan-centric allocation queue table.
 */
export default function AllocationTableColumnMenu({ columns, visibleKeys, onChange, getLabel }) {
  const { t: tAlloc } = useTranslation('allocation')
  const wrapRef = useRef(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const toggleColumn = useCallback(
    (key) => {
      const next = new Set(visibleKeys)
      if (next.has(key)) {
        if (next.size <= 1) return
        next.delete(key)
      } else {
        next.add(key)
      }
      onChange(next)
    },
    [onChange, visibleKeys]
  )

  return (
    <div className="allocation-column-menu" ref={wrapRef}>
      <button
        type="button"
        className="btn btn--small btn--ghost allocation-column-menu__trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={tAlloc('columnsMenuAria', { defaultValue: 'Choose visible table columns' })}
      >
        {tAlloc('columnsButton', { defaultValue: '⚙️ Columns' })}
      </button>

      {open ? (
        <div
          className="allocation-column-menu__panel"
          role="listbox"
          aria-multiselectable="true"
          aria-labelledby="allocation-column-menu-title"
        >
          <h3 className="allocation-column-menu__title" id="allocation-column-menu-title">
            {tAlloc('columnsMenuTitle', { defaultValue: 'Show columns' })}
          </h3>
          <ul className="allocation-column-menu__list">
            {columns.map((col) => (
              <li key={col.key} role="option" aria-selected={visibleKeys.has(col.key)}>
                <label className="allocation-column-menu__option">
                  <input
                    type="checkbox"
                    checked={visibleKeys.has(col.key)}
                    disabled={visibleKeys.has(col.key) && visibleKeys.size <= 1}
                    onChange={() => toggleColumn(col.key)}
                  />
                  <span>{getLabel(col.key, col.label)}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
