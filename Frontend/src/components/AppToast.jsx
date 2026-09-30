/**
 * Fixed bottom-right toast (see .toast in allocation.css). Used on Master and ops pages.
 * @param {{ message: string, variant?: 'success'|'warning'|'error' }} toast
 */
export default function AppToast({ toast, onDismiss, dismissLabel = 'Dismiss notification' }) {
  if (!toast?.message) return null

  const variant = toast.variant || 'success'
  const isAlert = variant === 'error' || variant === 'warning'
  const className = `toast ${isAlert ? 'toast--warning' : 'toast--success'}`

  return (
    <div
      className={className}
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      <span className="toast__icon" aria-hidden>
        {isAlert ? '!' : '✓'}
      </span>
      <p className="toast__message">{toast.message}</p>
      <button type="button" className="toast__close" onClick={onDismiss} aria-label={dismissLabel}>
        ×
      </button>
    </div>
  )
}
