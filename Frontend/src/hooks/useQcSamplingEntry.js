import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EMPTY_SAMPLING,
  deleteQcSamplingDocument,
  fetchQcSamplingOperation,
  loadQcSamplingSection,
  saveQcSamplingSection,
} from '../api/qc'
import { recordsDiffer, validateSummaryFields } from '../utils/qcSampling'
import { useQcSamplingDraft } from './useQcSamplingDraft'
import { useQcSamplingRecords } from './useQcSamplingRecords'

/**
 * State for one QC sampling entry screen: loads the shared sampling record, tracks summary edits
 * (mirrored to localStorage), and saves back through the same sub-process the Loading hub uses.
 * Individual samples are written through `useQcSamplingRecords`.
 */
export function useQcSamplingEntry(operationId) {
  const draftStore = useQcSamplingDraft(operationId)
  const draftRef = useRef(draftStore)
  draftRef.current = draftStore

  const [state, setState] = useState({ loading: true, error: '', header: null })
  const [sampling, setSampling] = useState(EMPTY_SAMPLING)
  const [dirty, setDirty] = useState(false)
  const [restored, setRestored] = useState(false)
  const [saving, setSaving] = useState(false)
  const [localSavedAt, setLocalSavedAt] = useState(null)
  /** Set when a save was refused because someone else changed the record: `{ mode }` of that save. */
  const [conflict, setConflict] = useState(null)

  /** Apply an edit; the effect below mirrors dirty state to localStorage. */
  const edit = useCallback((updater) => {
    setSampling((prev) => (typeof updater === 'function' ? updater(prev) : { ...prev, ...updater }))
    setDirty(true)
  }, [])

  const records = useQcSamplingRecords(operationId, { setSampling, edit })
  const { setUnsynced, unsynced } = records

  const load = useCallback(async () => {
    setState({ loading: true, error: '', header: null })
    setConflict(null)
    try {
      const [header, server] = await Promise.all([
        fetchQcSamplingOperation(operationId),
        loadQcSamplingSection(operationId),
      ])
      const local = draftRef.current.read()
      const serverMs = server.lastSavedAt ? new Date(server.lastSavedAt).getTime() : 0
      if (local && local.savedAt > serverMs) {
        setSampling({ ...server, ...local.sampling, documents: server.documents })
        setUnsynced(recordsDiffer(local.sampling.records, server.records))
        setDirty(true)
        setRestored(true)
        setLocalSavedAt(local.savedAt)
      } else {
        setSampling(server)
        setUnsynced(false)
        setDirty(false)
        setRestored(false)
        if (local) draftRef.current.clear()
      }
      setState({ loading: false, error: '', header })
    } catch (e) {
      setState({ loading: false, error: e?.message || 'load', header: null, status: e?.status })
    }
  }, [operationId, setUnsynced])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!dirty || state.loading) return
    draftRef.current.write(sampling)
    setLocalSavedAt(Date.now())
  }, [sampling, dirty, state.loading])

  const setField = useCallback((field, value) => edit({ [field]: value }), [edit])
  /** Replace the whole sampling draft (used by the extract review apply). */
  const replaceSampling = useCallback(
    (next) => {
      // Samples applied from an extract exist only locally until the next Save sends them.
      setUnsynced(true)
      edit(() => next)
    },
    [edit, setUnsynced]
  )

  const addFiles = useCallback(
    (files) => {
      const added = Array.from(files || []).map((f) => ({ name: f.name, url: URL.createObjectURL(f), file: f }))
      if (added.length) edit((p) => ({ ...p, documents: [...p.documents, ...added] }))
    },
    [edit]
  )

  /** Local files drop instantly; saved ones are deleted on the server first. */
  const removeDocument = useCallback(
    async (index) => {
      const doc = sampling.documents[index]
      if (!doc) return
      if (!doc.file && doc.id != null) await deleteQcSamplingDocument(operationId, doc.id)
      setSampling((p) => ({ ...p, documents: p.documents.filter((_, i) => i !== index) }))
    },
    [operationId, sampling.documents]
  )

  const discardLocalDraft = useCallback(async () => {
    draftRef.current.clear()
    await load()
  }, [load])

  /**
   * @param {'draft'|'final'} mode
   * @param {{ force?: boolean }} [options] force skips the "someone else saved" check (overwrite)
   * @returns {Promise<{ ok: boolean, errors?: object, message?: string, conflict?: boolean }>}
   */
  const save = useCallback(
    async (mode, { force = false } = {}) => {
      const errors = validateSummaryFields(sampling)
      if (Object.keys(errors).length > 0) return { ok: false, errors }
      setSaving(true)
      setConflict(null)
      try {
        const out = await saveQcSamplingSection(operationId, sampling, mode, {
          includeRecords: unsynced,
          expectedUpdatedAt: force ? undefined : sampling.lastSavedAt,
        })
        draftRef.current.clear()
        setSampling((p) => ({
          ...p,
          documents: out.documents,
          lastSavedAt: out.lastSavedAt ?? p.lastSavedAt,
          status: mode === 'draft' ? 'In Progress' : 'Done',
        }))
        setUnsynced(false)
        setDirty(false)
        setRestored(false)
        setLocalSavedAt(null)
        return { ok: true }
      } catch (e) {
        if (e?.status === 409) {
          setConflict({ mode })
          return { ok: false, conflict: true }
        }
        return { ok: false, message: e?.message }
      } finally {
        setSaving(false)
      }
    },
    [operationId, sampling, unsynced, setUnsynced]
  )

  return {
    ...state,
    sampling,
    dirty,
    restored,
    saving,
    localSavedAt,
    conflict,
    recordError: records.recordError,
    setField,
    addRecord: records.addRecord,
    updateRecord: records.updateRecord,
    removeRecord: records.removeRecord,
    replaceSampling,
    addFiles,
    removeDocument,
    discardLocalDraft,
    save,
    reload: load,
  }
}
