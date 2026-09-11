/**
 * Column header from/to date filter (Clearance CAST Off / Sailed At pattern).
 */
export default function ColumnDateRangeFilter({ from, to, onChange, fromAria, toAria }) {
  return (
    <div className="clearance-date-range-filter">
      <input
        type="date"
        className="allocation-table__filter clearance-date-range-filter__input"
        value={from || ''}
        onChange={(e) => onChange('from', e.target.value)}
        onClick={(e) => e.stopPropagation()}
        aria-label={fromAria}
      />
      <input
        type="date"
        className="allocation-table__filter clearance-date-range-filter__input"
        value={to || ''}
        onChange={(e) => onChange('to', e.target.value)}
        onClick={(e) => e.stopPropagation()}
        aria-label={toAria}
      />
    </div>
  )
}
