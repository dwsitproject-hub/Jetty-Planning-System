import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchQcSamplingQueue } from '../api/qc'
import { filterQcGroups, groupQcQueue, sortQcGroups } from '../utils/qcQueue'

/**
 * Queue state shared by the phone queue page and the desktop queue pane:
 * loads berthed operations, groups them per vessel call and applies filter, search and sort.
 */
export function useQcSamplingQueue() {
  const { t } = useTranslation('qc')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('needs')
  const [sortBy, setSortBy] = useState('tb')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setRows(await fetchQcSamplingQueue())
    } catch (e) {
      setError(e?.message || t('queue.errorLoad'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  const groups = useMemo(() => groupQcQueue(rows), [rows])
  const visible = useMemo(
    () => sortQcGroups(filterQcGroups(groups, filter, search), sortBy),
    [groups, filter, search, sortBy]
  )

  const toggleExpand = useCallback(
    (key) =>
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      }),
    []
  )

  return {
    loading,
    error,
    rows,
    visible,
    filter,
    setFilter,
    sortBy,
    setSortBy,
    search,
    setSearch,
    expanded,
    toggleExpand,
    reload: load,
  }
}
