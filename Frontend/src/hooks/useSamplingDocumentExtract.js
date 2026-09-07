import { useCallback, useState } from 'react'
import {
  extractSamplingFromFile,
  extractSamplingFromSavedDocument,
} from '../api/samplingDocuments'
import {
  proposeSamplingExtractMerge,
  applySamplingExtractMerge,
  summarizeSamplingExtractApply,
} from '../utils/samplingExtractMerge'

/** Types the parser can read; other attachments get no extract button. */
const EXTRACTABLE_RE = /\.(xlsx|pdf|png|jpe?g|gif|webp)$/i

/** @param {{ name?: string, mimeType?: string|null }} doc */
export function samplingDocumentIsExtractable(doc) {
  if (!doc) return false
  if (doc.file || doc.id != null) {
    return EXTRACTABLE_RE.test(String(doc.name || '')) || /pdf|image|spreadsheet/i.test(String(doc.mimeType || ''))
  }
  return false
}

/**
 * Extract per-palka quality values from a sampling attachment on demand.
 *
 * Extraction is explicit rather than automatic: the sampling upload field also holds
 * surveyor letters and site photos, and OCR on an image is slow.
 *
 * The draft is never mutated until the operator confirms in the review modal.
 */
export function useSamplingDocumentExtract() {
  const [extractingKey, setExtractingKey] = useState(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [pending, setPending] = useState(null)

  const requestExtract = useCallback(async ({ doc, docKey, sampling, context, onError }) => {
    if (!doc) return
    setExtractingKey(docKey)
    try {
      const out = doc.file
        ? await extractSamplingFromFile(doc.file)
        : await extractSamplingFromSavedDocument(doc.id)
      const fields = out?.fields || {}
      const source = out?.source || ''
      setPending({
        proposal: proposeSamplingExtractMerge(sampling || {}, fields, {
          ...(context || {}),
          source,
        }),
        fileName: doc.name || '',
        source,
      })
      setReviewOpen(true)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sampling document extract]', err)
      const status = typeof err?.status === 'number' && err.status > 0 ? ` (HTTP ${err.status})` : ''
      onError?.(`${err?.message || 'Could not extract data from this document.'}${status}`)
    } finally {
      setExtractingKey(null)
    }
  }, [])

  const cancelReview = useCallback(() => {
    setReviewOpen(false)
    setPending(null)
  }, [])

  /**
   * @param {object} choices selections from the review modal
   * @param {(sampling: object) => object} getSampling reads the latest sampling draft
   * @returns {{ nextSampling: object, message: string }|null}
   */
  const applyReview = useCallback(
    (choices, sampling) => {
      if (!pending) return null
      const { nextSampling, summary } = applySamplingExtractMerge(sampling || {}, pending.proposal, choices)
      const message = summarizeSamplingExtractApply(summary, pending.fileName)
      setReviewOpen(false)
      setPending(null)
      return { nextSampling, message }
    },
    [pending]
  )

  return {
    extractingKey,
    reviewOpen,
    proposal: pending?.proposal || null,
    fileName: pending?.fileName || '',
    source: pending?.source || '',
    requestExtract,
    applyReview,
    cancelReview,
  }
}
