import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultSailedRange, sailedRangeError, sailedRangeParams } from '../utils/fieldQueueRange'
import { filterQcGroups, groupQcQueue, isSailedFilter, sortQcGroups } from '../utils/qcQueue'

/** Filter and sailed range survive the phone's queue → entry → back trip (per tab, per menu). */
function readView(ns) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(`field-queue-view:${ns}`) || 'null')
    return saved && typeof saved === 'object' ? saved : null
  } catch {
    return null
  }
}

function writeView(ns, view) {
  try {
    sessionStorage.setItem(`field-queue-view:${ns}`, JSON.stringify(view))
  } catch {
    /* storage unavailable: the view simply resets next visit */
  }
}

/**
 * Queue state for a field menu (QC Sampling, Custom Clearance), shared by the phone queue page
 * and the desktop queue pane: loads berthed operations (or, on the "Sailed" filter, vessels cast
 * off inside a date range, view-only), groups them per vessel call and applies filter, search and sort.
 *
 * @param {(params?: object) => Promise<object[]>} fetchRows loads the queue rows
 * @param {{ statusOf: (row: object) => string, ns: string }} options
 */
export function useFieldQueue(fetchRows, { statusOf, ns }) {
  const { t } = useTranslation(ns)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
  const [saved] = useState(() => readView(ns))
  const [filter, setFilterState] = useState(saved?.filter || 'needs')
  const [sortBy, setSortBy] = useState(isSailedFilter(saved?.filter) ? 'castOff' : 'tb')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())
  const [sailedRange, setSailedRange] = useState(() => saved?.sailedRange || defaultSailedRange())

  const sailed = isSailedFilter(filter)
  /** Last status chip of the "At berth" scope, restored when switching back from "Sailed". */
  const lastStatusFilter = useRef(sailed ? 'needs' : filter)
  const rangeError = sailed ? sailedRangeError(sailedRange) : null

  const load = useCallback(async () => {
    if (rangeError) {
      setRows([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      setRows(await fetchRows(sailed ? sailedRangeParams(sailedRange) : undefined))
    } catch (e) {
      setError(e?.message || t('queue.errorLoad'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [fetchRows, t, sailed, sailedRange, rangeError])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => writeView(ns, { filter, sailedRange }), [ns, filter, sailedRange])

  /** Entering or leaving "Sailed" swaps the data set, so the time sort follows it. */
  const setFilter = useCallback(
    (next) => {
      if (isSailedFilter(next) !== isSailedFilter(filter)) {
        setSortBy(isSailedFilter(next) ? 'castOff' : 'tb')
        setExpanded(new Set())
      }
      if (!isSailedFilter(next)) lastStatusFilter.current = next
      setFilterState(next)
    },
    [filter]
  )

  const setScope = useCallback(
    (scope) => setFilter(scope === 'sailed' ? 'sailed' : lastStatusFilter.current),
    [setFilter]
  )

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
    sailed,
    setScope,
    sailedRange,
    setSailedRange,
    rangeError,
    sortBy,
    setSortBy,
    search,
    setSearch,
    expanded,
    toggleExpand,
    reload: load,
  }
}
