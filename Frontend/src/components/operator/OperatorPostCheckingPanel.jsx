function StateChip({ state }) {
  const label = state === 'done' ? 'Completed' : state === 'active' ? 'In Progress' : 'Not Started'
  const cls =
    state === 'done' ? 'operator-state--done' : state === 'active' ? 'operator-state--active' : 'operator-state--pending'
  return <span className={`operator-state ${cls}`}>{label}</span>
}

export default function OperatorPostCheckingPanel({ steps, canEdit, busy, onMarkDone, onEditTimestamp }) {
  return (
    <>
      {(steps || []).map((s) => (
        <section key={s.uiKey} className="operator-post-card">
          <div className="operator-milestone__head">
            <h2 className="operator-milestone__title">{s.label}</h2>
            <StateChip state={s.state} />
          </div>
          {s.detail ? <div className="operator-milestone__meta">{s.detail}</div> : null}
          {s.state !== 'done' ? (
            <button
              type="button"
              className="op-btn op-btn--primary op-btn--block"
              disabled={!canEdit || busy}
              onClick={() => onMarkDone(s)}
            >
              Mark Done
            </button>
          ) : (
            <button
              type="button"
              className="op-btn op-btn--soft"
              disabled={!canEdit || busy}
              onClick={() => onEditTimestamp(s)}
            >
              Edit timestamp
            </button>
          )}
        </section>
      ))}
    </>
  )
}
