/** Assigned on submit when a child has no external shipping instruction number. */
export const INTERNAL_SI_REFERENCE_RE = /^INT-SI-\d{2,}-\d{4}-\d{2}-\d+$/

/**
 * @param {unknown} referenceNumber
 * @returns {boolean}
 */
export function isInternalSiReference(referenceNumber) {
  return INTERNAL_SI_REFERENCE_RE.test(String(referenceNumber ?? '').trim())
}
