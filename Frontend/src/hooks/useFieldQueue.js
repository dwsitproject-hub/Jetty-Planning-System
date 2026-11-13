import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { filterQcGroups, groupQcQueue, sortQcGroups } from '../utils/qcQueue'

/**
 * Queue state for a field menu (QC Sampling, Custom Clearance), shared by the phone queue page
 * and the desktop queue pane: loads berthed operations, groups them per vessel call and applies
 * filter, search and sort.
 *
 * @param {() => Promise<object[]>} fetchRows loads the queue rows
 * @param {{ statusOf: (row: object) => string, ns: string }} options
 */
export function useFieldQueue(fetchRows, { statusOf, ns }) {
  const { t } = useTranslation(ns)
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
      setRows(await fetchRows())
    } catch (e) {
      setError(e?.message || t('queue.errorLoad'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [fetchRows, t])

  useEffect(() => {
    load()
  }, [load])

  const groups = useMemo(() => groupQcQueue(rows, statusOf), [rows, statusOf])
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
    ns,
    statusOf,
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
