export default function OperatorPhaseTabs({ phase, onChange }) {
  return (
    <div className="operator-phase-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={phase === 'operational'}
        className={`operator-phase-tabs__btn${phase === 'operational' ? ' is-active' : ''}`}
        onClick={() => onChange('operational')}
      >
        Operational
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={phase === 'post'}
        className={`operator-phase-tabs__btn${phase === 'post' ? ' is-active' : ''}`}
        onClick={() => onChange('post')}
      >
        Post-Checking
      </button>
    </div>
  )
}
