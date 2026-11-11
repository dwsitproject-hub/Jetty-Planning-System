/**
 * By Voyage commodity chips: multi-select, top groups as chips, the rest under "More".
 */
const TOP_CHIPS = 7

export default function VoyageCommodityFilter({ options, selected, onChange, shown, total }) {
  if (!options.length) return null
  const top = options.slice(0, TOP_CHIPS)
  const extra = options.slice(TOP_CHIPS)

  const toggle = (label) => {
    const next = new Set(selected)
    if (next.has(label)) next.delete(label)
    else next.add(label)
    onChange(next)
  }

  return (
    <div className="mgmt-voyage-filter" role="group" aria-label="Filter voyages by commodity">
      <span className="mgmt-voyage-filter__lbl">Commodity</span>
      <button
        type="button"
        className={`mgmt-voyage-filter__chip${selected.size ? '' : ' is-on'}`}
        aria-pressed={!selected.size}
        onClick={() => onChange(new Set())}
      >
        All <span className="mgmt-voyage-filter__n">{total}</span>
      </button>
      {top.map((o) => (
        <button
          key={o.label}
          type="button"
          className={`mgmt-voyage-filter__chip${selected.has(o.label) ? ' is-on' : ''}`}
          aria-pressed={selected.has(o.label)}
          onClick={() => toggle(o.label)}
        >
          {o.label} <span className="mgmt-voyage-filter__n">{o.count}</span>
        </button>
      ))}
      {extra.length ? (
        <select
          className="mgmt-voyage-filter__more"
          value=""
          aria-label="More commodities"
          onChange={(e) => e.target.value && toggle(e.target.value)}
        >
          <option value="">More ({extra.length})</option>
          {extra.map((o) => (
            <option key={o.label} value={o.label}>
              {selected.has(o.label) ? '✓ ' : ''}
              {o.label} ({o.count})
            </option>
          ))}
        </select>
      ) : null}
      <span className="mgmt-voyage-filter__count">
        Showing {shown} of {total} voyages
        {selected.size ? (
          <>
            {' · '}
            <button type="button" className="mgmt-voyage-filter__clear" onClick={() => onChange(new Set())}>
              Clear
            </button>
          </>
        ) : null}
      </span>
    </div>
  )
}
