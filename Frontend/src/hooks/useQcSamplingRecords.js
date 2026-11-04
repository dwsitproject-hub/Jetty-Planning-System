import { useCallback, useRef, useState } from 'react'
import { addQcSamplingRecord, removeQcSamplingRecord, updateQcSamplingRecord } from '../api/qc'

function newRecordId() {
  return `sampling-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function patchLocalRecords(sampling, commodityId, change) {
  if (commodityId == null) return { ...sampling, records: change(sampling.records || []) }
  const target = Number(commodityId)
  return {
    ...sampling,
    commodities: (sampling.commodities || []).map((card) =>
      Number(card.commodityId) === target ? { ...card, records: change(card.records || []) } : card
    ),
  }
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
    async (request, applyLocal, commodityId = null) => {
      if (unsyncedRef.current) return edit(applyLocal)
      setRecordError('')
      try {
        const out = await request()
        const at = new Date(out.updatedAt).getTime()
        // Responses can arrive out of order; the newest write carries the most complete list.
        if (at < appliedAtRef.current) return undefined
        appliedAtRef.current = at
        setSampling((p) => {
          if (commodityId == null) return { ...p, records: out.records, lastSavedAt: out.updatedAt }
          const target = Number(commodityId)
          return {
            ...p,
            lastSavedAt: out.updatedAt,
            records: (p.commodities || []).length === 1 ? out.records : p.records,
            commodities: (p.commodities || []).map((card) =>
              Number(card.commodityId) === target ? { ...card, records: out.records } : card
            ),
          }
        })
      } catch (e) {
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
    (record, commodityId = null) =>
      run(
        () => addQcSamplingRecord(operationId, { ...record, commodityId }),
        (p) => patchLocalRecords(p, commodityId, (rows) => [...rows, { ...record, id: record.id ?? newRecordId() }]),
        commodityId
      ),
    [operationId, run]
  )

  const updateRecord = useCallback(
    (id, patch, commodityId = null) =>
      run(
        () => updateQcSamplingRecord(operationId, id, { ...patch, commodityId }),
        (p) => patchLocalRecords(p, commodityId, (rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r))),
        commodityId
      ),
    [operationId, run]
  )

  const removeRecord = useCallback(
    (id, commodityId = null) =>
      run(
        () => removeQcSamplingRecord(operationId, id, commodityId),
        (p) => patchLocalRecords(p, commodityId, (rows) => rows.filter((r) => r.id !== id)),
        commodityId
      ),
    [operationId, run]
  )

  return { unsynced, setUnsynced, recordError, addRecord, updateRecord, removeRecord }
}
