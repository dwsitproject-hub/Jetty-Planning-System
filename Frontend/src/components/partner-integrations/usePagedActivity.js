import { useCallback, useEffect, useRef, useState } from 'react'

const AUTO_REFRESH_MS = 30000
const HOUR_MS = 3600 * 1000

/**
 * Cursor-paged activity list with a rolling time window and optional auto-refresh.
 * `params` must contain only serialisable filters; the `from` timestamp is derived from `windowHours` at fetch time.
 * Everything in the response other than items and nextCursor is returned as `extra`.
 */
export default function usePagedActivity(fetchPage, params, windowHours, autoRefresh) {
  const [items, setItems] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [extra, setExtra] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const requestSeq = useRef(0)
  const paramsKey = JSON.stringify(params)

  const run = useCallback(
    async (cursor, append, silent = false) => {
      const seq = ++requestSeq.current
      if (append) setLoadingMore(true)
      else if (!silent) setLoading(true)
      setError(null)
      try {
        const from = new Date(Date.now() - windowHours * HOUR_MS).toISOString()
        const res = await fetchPage({ ...JSON.parse(paramsKey), from, cursor: cursor || undefined, limit: 50 })
        if (seq !== requestSeq.current) return
        const { items: list = [], nextCursor: next = null, ...rest } = res || {}
        setItems((prev) => (append ? [...prev, ...list] : list))
        setNextCursor(next)
        if (!append) setExtra(rest)
        setUpdatedAt(new Date())
      } catch (e) {
        if (seq !== requestSeq.current) return
        setError(e?.message || 'Failed to load')
        if (!append && !silent) setItems([])
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [fetchPage, paramsKey, windowHours]
  )

  const reload = useCallback(() => run(null, false), [run])
  const loadMore = useCallback(() => (nextCursor ? run(nextCursor, true) : undefined), [run, nextCursor])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    if (!autoRefresh) return undefined
    const id = window.setInterval(() => run(null, false, true), AUTO_REFRESH_MS)
    return () => window.clearInterval(id)
  }, [autoRefresh, run])

  return { items, nextCursor, extra, loading, loadingMore, error, updatedAt, reload, loadMore }
}
