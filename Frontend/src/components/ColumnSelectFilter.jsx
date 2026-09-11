/**
 * Column header dropdown for exact-match filters (commodity short name, purpose).
 */
export default function ColumnSelectFilter({
  value,
  onChange,
  options = [],
  allLabel = 'All',
  ariaLabel,
}) {
  return (
    <select
      className="allocation-table__filter"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      aria-label={ariaLabel}
    >
      <option value="">{allLabel}</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  )
}
