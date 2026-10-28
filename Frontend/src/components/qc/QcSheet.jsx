import { useEffect } from 'react'

/** Bottom sheet for thumb-reach editing. Closes on backdrop tap or Escape. */
export default function QcSheet({ open, title, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="qc-sheet-backdrop" onClick={onClose}>
      <div
        className="qc-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="qc-sheet__title">{title}</h2>
        {children}
      </div>
    </div>
  )
}
