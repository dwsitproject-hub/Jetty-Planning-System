function normalizePurpose(purpose) {
  const p = String(purpose || '').trim().toLowerCase()
  if (!p) return 'loading'
  if (p === 'unloading' || p.startsWith('unload') || p.startsWith('disch')) return 'unloading'
  return 'loading'
}

export default function FlowPill({ purpose, className = '', size = 'md' }) {
  const norm = normalizePurpose(purpose)
  const isUnloading = norm === 'unloading'
  const label = isUnloading ? 'Unloading' : 'Loading'
  const icon = isUnloading ? '↓' : '↑'
  return (
    <span
      className={`flow-pill flow-pill--${isUnloading ? 'unloading' : 'loading'} flow-pill--${size}${className ? ` ${className}` : ''}`}
      role="status"
      aria-live="polite"
      title={`Flow: ${label}`}
    >
      <span className="flow-pill__icon" aria-hidden="true">{icon}</span>
      <span className="flow-pill__text">{label.toUpperCase()}</span>
    </span>
  )
}

