import { useEffect, useMemo, useState } from 'react'

/** Same page size as Shipment Plans list and Clearance list. */
export const MASTER_TABLE_PAGE_SIZE = 20

/**
 * Client-side pagination for master tables after sort/filter.
 * Pass a `resetKey` that changes when filters or sort change so the page
 * returns to 1.
 *
 * @param {Array} rows
 * @param {{ pageSize?: number, resetKey?: unknown }} [options]
 */
export function useMasterTablePagination(rows, { pageSize = MASTER_TABLE_PAGE_SIZE, resetKey } = {}) {
  const [page, setPage] = useState(1)

  useEffect(() => {
    setPage(1)
  }, [resetKey])

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(rows.length / pageSize)),
    [rows.length, pageSize]
  )

  useEffect(() => {
    setPage((p) => Math.min(p, totalPages))
  }, [totalPages])

  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize
    return rows.slice(start, start + pageSize)
  }, [rows, page, pageSize])

  const range = useMemo(() => {
    const total = rows.length
    if (total === 0) return { from: 0, to: 0, total: 0 }
    return {
      from: (page - 1) * pageSize + 1,
      to: Math.min(page * pageSize, total),
      total,
    }
  }, [rows.length, page, pageSize])

  return { page, setPage, totalPages, pagedRows, range }
}
