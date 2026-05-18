import { useState, useCallback } from 'react'
import { uploadSiDocumentAndExtract } from '../api/siDocuments'
import {
  proposeSiExtractMerge,
  applySiExtractMergeWithPlan,
  buildSiExtractReport,
  getSiScopedConflicts,
} from '../utils/siExtractMerge'
import { nextDocId } from '../utils/siPlanLinkedDraft'

/**
 * Shared SI document upload + OCR merge (empty fields only; conflicts open modal).
 */
export function useSiDocumentExtract({ lookups, t, getPlanForm, onApplyPlanFields }) {
  const [extractBusy, setExtractBusy] = useState(false)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [pending, setPending] = useState(null)
  const [reportsByDraftKey, setReportsByDraftKey] = useState({})

  const setReportForDraft = useCallback((draftKey, report) => {
    if (!draftKey) return
    setReportsByDraftKey((prev) => ({ ...prev, [draftKey]: report }))
  }, [])

  const clearReport = useCallback((draftKey) => {
    if (!draftKey) return
    setReportsByDraftKey((prev) => {
      const next = { ...prev }
      delete next[draftKey]
      return next
    })
  }, [])

  const getReport = useCallback(
    (draftKey) => (draftKey ? reportsByDraftKey[draftKey] : null),
    [reportsByDraftKey]
  )

  const applyMerge = useCallback((form, proposal, overwriteKeys) => {
    const planForm = getPlanForm?.() || {}
    return applySiExtractMergeWithPlan(form, { ...proposal, overwriteKeys }, planForm)
  }, [getPlanForm])

  const publishReport = useCallback(
    (draftKey, proposal, fields, fileName, overwriteKeys = []) => {
      setReportForDraft(
        draftKey,
        buildSiExtractReport({
          proposal,
          fields,
          fileName: fileName || '',
          lookups,
          overwriteKeys,
        })
      )
    },
    [lookups, setReportForDraft]
  )

  const handleFilesForDraft = useCallback(
    async ({ files, form, setForm, draftKey, shipmentPlanId, onToast }) => {
      if (!lookups) {
        onToast?.({ message: t('siExtractLookupsMissing'), variant: 'error' })
        return
      }
      const list = Array.from(files || [])
      if (!list.length) return

      setExtractBusy(true)
      let workingForm = { ...form }

      try {
        for (const file of list) {
          const pendingDoc = {
            id: nextDocId(),
            name: file.name,
            documentId: null,
            downloadUrl: null,
            pending: true,
          }
          workingForm = {
            ...workingForm,
            documents: [...(workingForm.documents || []), pendingDoc],
          }
          setForm(workingForm)

          const out = await uploadSiDocumentAndExtract(file, { draftKey, shipmentPlanId })
          const fields = out.extract?.fields || {}
          const planForm = getPlanForm?.() || {}
          const proposal = proposeSiExtractMerge(workingForm, fields, lookups, { planForm })

          workingForm = {
            ...workingForm,
            documents: (workingForm.documents || []).map((d) =>
              d.id === pendingDoc.id
                ? {
                    ...d,
                    pending: false,
                    documentId: out.document?.id ?? null,
                    downloadUrl: out.document?.downloadUrl ?? null,
                  }
                : d
            ),
          }

          const { nextForm, nextPlan } = applyMerge(workingForm, proposal, [])
          workingForm = nextForm
          setForm(workingForm)
          if (nextPlan && onApplyPlanFields) {
            queueMicrotask(() => onApplyPlanFields(nextPlan))
          }

          publishReport(draftKey, proposal, fields, file.name, [])

          const siConflicts = getSiScopedConflicts(proposal.conflicts)
          if (siConflicts.length) {
            setPending({
              proposal: { ...proposal, conflicts: siConflicts },
              form: workingForm,
              setForm,
              fields,
              draftKey,
              fileName: file.name,
            })
            setConflictOpen(true)
          }
        }
      } catch (err) {
        const st = err?.status
        const suffix = typeof st === 'number' && st > 0 ? ` (HTTP ${st})` : ''
        // eslint-disable-next-line no-console
        console.error('[SI document extract]', err)
        onToast?.({
          message: `${err?.message || t('siExtractFailed')}${suffix}`,
          variant: 'error',
        })
        setForm((f) => ({
          ...f,
          documents: (f.documents || []).map((d) =>
            d.pending ? { ...d, pending: false, failed: true } : d
          ),
        }))
      } finally {
        queueMicrotask(() => setExtractBusy(false))
      }
    },
    [lookups, t, getPlanForm, applyMerge, publishReport]
  )

  const resolveConflict = useCallback(
    (overwriteKeys) => {
      if (!pending) return
      const { nextForm, nextPlan } = applyMerge(pending.form, pending.proposal, overwriteKeys)
      pending.setForm(nextForm)
      if (nextPlan && onApplyPlanFields) {
        queueMicrotask(() => onApplyPlanFields(nextPlan))
      }
      setConflictOpen(false)
      const { fields, draftKey, fileName, proposal } = pending
      publishReport(draftKey, proposal, fields, fileName || '', overwriteKeys)
      setPending(null)
    },
    [pending, applyMerge, publishReport, onApplyPlanFields]
  )

  const cancelConflict = useCallback(() => {
    setConflictOpen(false)
    setPending(null)
  }, [])

  return {
    extractBusy,
    conflictOpen,
    conflictList: pending?.proposal?.conflicts || [],
    conflictWarnings: pending?.proposal?.warnings || [],
    conflictPartialApply: Boolean(pending),
    handleFilesForDraft,
    resolveConflict,
    cancelConflict,
    getReport,
    clearReport,
  }
}
