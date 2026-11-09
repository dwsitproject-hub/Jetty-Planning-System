/**
 * Slide-over panel for Avg flow detail inside the commodity modal.
 */
import { useCallback, useEffect, useId, useRef } from 'react'
import FlowEvidencePanel from './FlowEvidencePanel.jsx'

export default function MgmtFlowEvidenceDrawer({
  row,
  productKey,
  timelineEvents,
  onClose,
}) {
  const titleId = useId()
  const closeRef = useRef(null)
  const open = Boolean(row)

  const handleClose = useCallback(() => {
    onClose?.()
  }, [onClose])

  useEffect(() => {
    if (!open) return undefined
    closeRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, handleClose])

  if (!open) return null

  return (
    <div className="mgmt-flow-drawer-root" role="presentation">
      <button
        type="button"
        className="mgmt-flow-drawer__backdrop"
        aria-label="Close flow detail"
        onClick={handleClose}
      />
      <div
        className="mgmt-flow-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="mgmt-flow-drawer__header">
          <div className="mgmt-flow-drawer__header-text">
            <h3 id={titleId} className="mgmt-flow-drawer__title">
              Avg flow
            </h3>
            <p className="mgmt-flow-drawer__sub text-steel">
              {row?.vessel || '—'}
              {row?.jetty ? ` · ${row.jetty}` : ''}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="mgmt-flow-drawer__close"
            onClick={handleClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="mgmt-flow-drawer__body">
          <FlowEvidencePanel
            row={row}
            productKey={productKey}
            timelineEvents={timelineEvents}
          />
        </div>
      </div>
    </div>
  )
}
