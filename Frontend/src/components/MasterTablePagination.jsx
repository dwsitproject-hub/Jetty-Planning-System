/**
 * Pagination bar for master data tables. Uses the same layout as Clearance /
 * Shipment Plans list pagination.
 */
export default function MasterTablePagination({
  range,
  page,
  totalPages,
  onPageChange,
  ariaLabel = 'Table pages',
}) {
  if (!range?.total) return null

  return (
    <div className="clearance-pagination" role="navigation" aria-label={ariaLabel}>
      <p className="text-steel clearance-pagination__summary">
        Showing {range.from}–{range.to} of {range.total}
      </p>
      <div className="clearance-pagination__controls">
        <button
          type="button"
          className="btn btn--secondary btn--small"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          Previous
        </button>
        <span className="text-steel clearance-pagination__page">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          className="btn btn--secondary btn--small"
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        >
          Next
        </button>
      </div>
    </div>
  )
}
