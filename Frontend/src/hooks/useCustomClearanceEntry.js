import { useCallback, useEffect, useState } from 'react'
import {
  deleteCustomClearanceDocument,
  fetchCustomClearanceOperation,
  loadCustomClearance,
  saveCustomClearance,
} from '../api/customClearance'
import { EMPTY_CLEARANCE, validateClearance } from '../utils/customClearance'

/**
 * State for one Custom Clearance entry: loads the shared Post-Checking step, tracks edits,
 * and saves back through the same sub-process the Loading hub uses.
 */
export function useCustomClearanceEntry(operationId) {
  const [state, setState] = useState({ loading: true, error: '', header: null, status: null })
  const [form, setForm] = useState(EMPTY_CLEARANCE)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  /** Set when a save was refused because someone else changed the record: `{ mode }` of that save. */
  const [conflict, setConflict] = useState(null)

  const load = useCallback(async () => {
    setState({ loading: true, error: '', header: null, status: null })
    setConflict(null)
    try {
      const header = await fetchCustomClearanceOperation(operationId)
      setForm(await loadCustomClearance(operationId, header))
      setDirty(false)
      setState({ loading: false, error: '', header, status: null })
    } catch (e) {
      setState({ loading: false, error: e?.message || 'load', header: null, status: e?.status })
    }
  }, [operationId])

  useEffect(() => {
    load()
  }, [load])

  const setField = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setDirty(true)
  }, [])

  const addFiles = useCallback((files) => {
    const added = Array.from(files || []).map((f) => ({ name: f.name, url: URL.createObjectURL(f), file: f }))
    if (!added.length) return
    setForm((prev) => ({ ...prev, documents: [...prev.documents, ...added] }))
    setDirty(true)
  }, [])

  const removeDocument = useCallback(
    async (index) => {
      const doc = form.documents[index]
      if (!doc) return
      if (!doc.file && doc.id != null) await deleteCustomClearanceDocument(operationId, doc.id)
      setForm((prev) => ({ ...prev, documents: prev.documents.filter((_, i) => i !== index) }))
    },
    [operationId, form.documents]
  )

  /**
   * @param {'draft'|'final'} mode
   * @param {{ force?: boolean }} [options] force skips the "someone else saved" check (overwrite)
   * @returns {Promise<{ ok: boolean, errors?: object, message?: string, conflict?: boolean }>}
   */
  const save = useCallback(
    async (mode, { force = false } = {}) => {
      const errors = validateClearance(form, mode)
      if (Object.keys(errors).length > 0) return { ok: false, errors }
      setSaving(true)
      setConflict(null)
      try {
        const out = await saveCustomClearance(operationId, form, mode, {
          expectedUpdatedAt: force ? undefined : form.lastSavedAt,
        })
        setForm((prev) => ({
          ...prev,
          documents: out.documents,
          lastSavedAt: out.lastSavedAt ?? prev.lastSavedAt,
          status: mode === 'final' ? 'Done' : 'In Progress',
        }))
        setDirty(false)
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
    [operationId, form]
  )

  return {
    ...state,
    form,
    dirty,
    saving,
    conflict,
    setField,
    addFiles,
    removeDocument,
    save,
    reload: load,
  }
}
