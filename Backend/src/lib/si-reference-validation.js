/** User-facing message when SI reference fails berthing validation. */
export const SI_REFERENCE_BERTHING_ERROR =
  'Shipping Instructions No. is required before berthing and cannot be blank, a single quote, or the same as the vessel name.';

/**
 * Normalize reference for berthing validation.
 * @param {unknown} ref
 * @returns {string}
 */
export function normalizeSiReference(ref) {
  if (ref == null) return '';
  return String(ref).trim();
}

/**
 * @param {unknown} referenceNumber
 * @param {unknown} vesselName
 * @returns {string|null} error message or null when valid
 */
export function validateSiReferenceForBerthing(referenceNumber, vesselName) {
  const ref = normalizeSiReference(referenceNumber);
  if (!ref) return SI_REFERENCE_BERTHING_ERROR;
  if (ref === "'") return SI_REFERENCE_BERTHING_ERROR;
  const vessel = normalizeSiReference(vesselName);
  if (vessel && ref.toLowerCase() === vessel.toLowerCase()) return SI_REFERENCE_BERTHING_ERROR;
  return null;
}

/**
 * @param {unknown} referenceNumber
 * @param {unknown} vesselName
 * @returns {boolean}
 */
export function isSiReferenceValidForBerthing(referenceNumber, vesselName) {
  return validateSiReferenceForBerthing(referenceNumber, vesselName) == null;
}

/**
 * @param {Array<{ reference_number?: unknown, vessel_name?: unknown }>} sis
 * @returns {string|null}
 */
export function validatePlanSiReferencesForBerthing(sis, vesselName) {
  if (!Array.isArray(sis) || sis.length === 0) {
    return 'At least one shipping instruction is required before berthing.';
  }
  for (const si of sis) {
    const err = validateSiReferenceForBerthing(
      si.reference_number ?? si.referenceNumber,
      vesselName ?? si.vessel_name ?? si.vesselName
    );
    if (err) return err;
  }
  return null;
}
