import { useEffect, useState } from 'react'

export default function OperatorEditTimestampModal({ open, title, initialLocal, busy, onCancel, onSave }) {
  const [value, setValue] = useState(initialLocal || '')

  useEffect(() => {
    if (open) setValue(initialLocal || '')
  }, [open, initialLocal])

  if (!open) return null

  return (
    <div className="operator-modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="operator-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Edit timestamp'}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{title || 'Edit timestamp'}</h2>
        <div>
          <label htmlFor="operator-edit-ts">Date & time</label>
          <input
            id="operator-edit-ts"
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <div className="operator-modal__actions">
          <button type="button" className="op-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="op-btn op-btn--primary"
            disabled={busy || !value}
            onClick={() => onSave(value)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
