/** Form rules and API payload for the Custom Clearance menu (Post-Checking `custom_clearance`). */

export const CLEARANCE_PHASE = 'Post-Checking'
export const CLEARANCE_KEY = 'custom_clearance'

export const EMPTY_CLEARANCE = Object.freeze({
  startTime: '',
  endTime: '',
  remark: '',
  documents: [],
  status: null,
  lastSavedAt: null,
})

/** Queue status accessor for `groupQcQueue` / `useFieldQueue`. */
export const clearanceStatusOf = (row) => row?.clearance?.status

/** Entry status chip: an explicit Done is final, any other saved row is a draft. */
export function clearanceEntryStatus(form) {
  if (form?.status === 'Done') return 'done'
  return form?.status ? 'draft' : 'not_started'
}

/**
 * Field errors for a save. Both modes reject an end before the start;
 * Save final also needs both times and at least one document (saved or about to upload).
 * Times are `datetime-local` strings, so they compare as text.
 * @returns {Record<string, 'required'|'beforeStart'>}
 */
export function validateClearance(form, mode) {
  const errors = {}
  const start = String(form?.startTime || '')
  const end = String(form?.endTime || '')
  if (start && end && end < start) errors.endTime = 'beforeStart'
  if (mode !== 'final') return errors
  if (!start) errors.startTime = 'required'
  if (!end && !errors.endTime) errors.endTime = 'required'
  if ((form?.documents || []).length === 0) errors.documents = 'required'
  return errors
}

/** Body for `upsertSubProcess`: 'draft' saves as In Progress, 'final' as Done. */
export function buildClearancePayload(form, mode, { expectedUpdatedAt } = {}) {
  const startTime = form?.startTime || null
  return {
    phase: CLEARANCE_PHASE,
    status: mode === 'final' ? 'Done' : 'In Progress',
    occurredAt: startTime,
    startAt: startTime,
    endAt: form?.endTime || null,
    remark: String(form?.remark || '').trim(),
    source: 'custom-clearance',
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
  }
}
