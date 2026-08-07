function StateChip({ state }) {
  const label = state === 'done' ? 'Completed' : state === 'active' ? 'In Progress' : 'Not Started'
  const cls =
    state === 'done' ? 'operator-state--done' : state === 'active' ? 'operator-state--active' : 'operator-state--pending'
  return <span className={`operator-state ${cls}`}>{label}</span>
}

export default function OperatorMilestoneCards({
  milestones,
  commodityType,
  canEdit,
  busy,
  onStart,
  onStopCargo,
  onCompleteOther,
  onEditTimestamp,
}) {
  return (
    <>
      {(milestones || []).map((m) => {
        const isCargo = m.key === 'cargo_operations'
        const isOther = m.key === 'other'
        const showStart =
          !isCargo && !isOther
            ? m.state === 'pending'
            : isCargo
              ? m.state !== 'active'
              : m.state === 'pending'
        const showStop = isCargo && m.state === 'active'
        const showComplete = isOther && m.state === 'active'

        return (
          <section key={m.key} className="operator-milestone">
            <div className="operator-milestone__head">
              <h2 className="operator-milestone__title">{m.label}</h2>
              <StateChip state={m.state} />
            </div>
            {m.detail ? <div className="operator-milestone__meta">{m.detail}</div> : null}
            {isCargo && m.state === 'pending' && commodityType === 'Liquid' ? (
              <div className="operator-milestone__meta">Tanks: (none yet)</div>
            ) : null}

            <div className={`operator-milestone__actions${isCargo ? ' operator-milestone__actions--split' : ''}`}>
              {showStart ? (
                <button
                  type="button"
                  className="op-btn op-btn--primary"
                  disabled={!canEdit || busy}
                  onClick={() => onStart(m)}
                >
                  {isCargo && m.state === 'done' ? 'Start next segment' : 'Start'}
                </button>
              ) : null}
              {isCargo ? (
                <button
                  type="button"
                  className="op-btn op-btn--danger"
                  disabled={!canEdit || busy || !showStop}
                  onClick={onStopCargo}
                >
                  Stop
                </button>
              ) : null}
              {showComplete ? (
                <button
                  type="button"
                  className="op-btn op-btn--primary"
                  disabled={!canEdit || busy}
                  onClick={onCompleteOther}
                >
                  Complete
                </button>
              ) : null}
            </div>

            {m.state !== 'pending' && m.activities?.[0] ? (
              <button
                type="button"
                className="op-btn op-btn--soft"
                disabled={!canEdit || busy}
                onClick={() => onEditTimestamp(m)}
              >
                Edit timestamp
              </button>
            ) : null}
          </section>
        )
      })}
    </>
  )
}
