import { apiPostForm, apiPost } from './client.js'

/** OCR on a first-time image can take a while; keep the same ceiling as SI extraction. */
const EXTRACT_TIMEOUT_MS = 180000

/**
 * Extract per-palka quality values from a file still staged in the browser
 * (not yet uploaded with the sampling section).
 * @param {File} file
 */
export function extractSamplingFromFile(file) {
  const fd = new FormData()
  fd.append('file', file)
  return apiPostForm('/sampling-document-extract', fd, EXTRACT_TIMEOUT_MS)
}

/**
 * Extract from a sampling document that was already saved to the operation.
 * @param {number} documentId
 */
export function extractSamplingFromSavedDocument(documentId) {
  return apiPost(`/sub-process-documents/${documentId}/extract-sampling`, {}, EXTRACT_TIMEOUT_MS)
}
