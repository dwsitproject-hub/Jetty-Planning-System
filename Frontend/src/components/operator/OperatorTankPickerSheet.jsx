import { useEffect, useState } from 'react'

export default function OperatorTankPickerSheet({
  open,
  purpose,
  options,
  initialSelected = [],
  busy,
  onCancel,
  onConfirm,
}) {
  const [selected, setSelected] = useState(() => new Set(initialSelected.map(String)))

  useEffect(() => {
    if (open) setSelected(new Set(initialSelected.map(String)))
  }, [open, initialSelected])

  if (!open) return null

  const title = purpose === 'Unloading' ? 'Select source tanks' : 'Select destination tanks'

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <>
      <div className="operator-sheet-backdrop" onClick={onCancel} aria-hidden />
      <div className="operator-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="operator-sheet__header">
          <h2>{title}</h2>
          <p>Required before Start</p>
        </div>
        <div className="operator-sheet__body">
          {options.length === 0 ? (
            <p className="operator-queue__status">No tanks available for this port.</p>
          ) : (
            options.map((tk) => {
              const id = String(tk.id)
              const isOn = selected.has(id)
              return (
                <button
                  key={id}
                  type="button"
                  className={`operator-tank-chip${isOn ? ' is-selected' : ''}`}
                  onClick={() => toggle(id)}
                >
                  <span className="operator-tank-chip__check">{isOn ? '✓' : ''}</span>
                  <span>{tk.label}</span>
                </button>
              )
            })
          )}
        </div>
        <div className="operator-sheet__footer">
          <button type="button" className="op-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="op-btn op-btn--primary"
            disabled={busy || selected.size === 0}
            onClick={() => onConfirm([...selected])}
          >
            Confirm Start
          </button>
        </div>
      </div>
    </>
  )
}
