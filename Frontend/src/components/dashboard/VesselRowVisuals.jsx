/**
 * In-cell visuals for the By Vessel table: a bar behind Moved (MT), and a range line under a rate.
 */
const fmtNum = (n, d) => (n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d }))
const pct = (value, max) => (max > 0 ? Math.min(Math.max((value / max) * 100, 0), 100) : 0)

export function MovedBarCell({ total, scaleMax }) {
  if (total == null) return <span className="mgmt-vbar__num">—</span>
  return (
    <span className="mgmt-vbar" title={`${fmtNum(total, 0)} MT moved`}>
      <span className="mgmt-vbar__fill" style={{ width: `${Math.max(pct(total, scaleMax), 2)}%` }} />
      <span className="mgmt-vbar__num">{fmtNum(total, 0)}</span>
    </span>
  )
}

/** Average as a number, with a dot on a line from the slowest to the fastest voyage. */
export function RateRangeCell({ value, range, scaleMax }) {
  if (value == null) return '—'
  const many = range && range.n > 1
  const title = many
    ? `Average of ${range.n} voyages · slowest ${fmtNum(range.min, 1)} · fastest ${fmtNum(range.max, 1)} MT/h`
    : 'One voyage'
  return (
    <span className="mgmt-vrange" title={title}>
      <span className="mgmt-vrange__val">{fmtNum(value, 1)} MT/h</span>
      <span className="mgmt-vrange__track">
        {many ? (
          <span
            className="mgmt-vrange__line"
            style={{ left: `${pct(range.min, scaleMax)}%`, width: `${Math.max(pct(range.max, scaleMax) - pct(range.min, scaleMax), 1)}%` }}
          />
        ) : null}
        <span className="mgmt-vrange__dot" style={{ left: `${pct(value, scaleMax)}%` }} />
      </span>
    </span>
  )
}
