import { useCallback, useRef, useState } from 'react'
import { addQcSamplingRecord, removeQcSamplingRecord, updateQcSamplingRecord } from '../api/qc'

function newRecordId() {
  return `sampling-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Per-sample writes for the QC entry screen. Each add/edit/remove goes straight to the server
 * (row-locked there), and the server's full list replaces the local one, so samples another
 * editor added meanwhile show up and are never overwritten.
 *
 * If the server cannot be reached the change is kept on the device only (`unsynced`); from then on
 * edits stay local and the next Save sends the whole list.
 *
 * @param {{ setSampling: Function, edit: Function }} sampling state setters from the entry hook
 */
export function useQcSamplingRecords(operationId, { setSampling, edit }) {
  const [unsynced, setUnsyncedState] = useState(false)
  const [recordError, setRecordError] = useState('')
  const unsyncedRef = useRef(false)
  const appliedAtRef = useRef(0)

  const setUnsynced = useCallback((value) => {
    unsyncedRef.current = value
    setUnsyncedState(value)
  }, [])

  const run = useCallback(
    async (request, applyLocal) => {
      if (unsyncedRef.current) return edit(applyLocal)
      setRecordError('')
      try {
        const out = await request()
        const at = new Date(out.updatedAt).getTime()
        // Responses can arrive out of order; the newest write carries the most complete list.
        if (at < appliedAtRef.current) return undefined
        appliedAtRef.current = at
        setSampling((p) => ({ ...p, records: out.records, lastSavedAt: out.updatedAt }))
      } catch (e) {
        // The server answered (validation, permission, ...): surface it. No answer: keep the work locally.
        if (e?.status > 0) setRecordError(e.message)
        else {
          setUnsynced(true)
          edit(applyLocal)
        }
      }
      return undefined
    },
    [edit, setSampling, setUnsynced]
  )

  const addRecord = useCallback(
    (record) =>
      run(
        () => addQcSamplingRecord(operationId, record),
        (p) => ({ ...p, records: [...p.records, { ...record, id: record.id ?? newRecordId() }] })
      ),
    [operationId, run]
  )

  const updateRecord = useCallback(
    (id, patch) =>
      run(
        () => updateQcSamplingRecord(operationId, id, patch),
        (p) => ({ ...p, records: p.records.map((r) => (r.id === id ? { ...r, ...patch } : r)) })
      ),
    [operationId, run]
  )

  const removeRecord = useCallback(
    (id) =>
      run(
        () => removeQcSamplingRecord(operationId, id),
        (p) => ({ ...p, records: p.records.filter((r) => r.id !== id) })
      ),
    [operationId, run]
  )

  return { unsynced, setUnsynced, recordError, addRecord, updateRecord, removeRecord }
}
