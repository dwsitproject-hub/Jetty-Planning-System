/** User-facing message when SI reference fails berthing validation. */
export const SI_REFERENCE_BERTHING_ERROR =
  'Shipping Instructions No. is required before berthing and cannot be blank, a single quote, the same as the vessel name, or the vessel name followed by NO SI or SI.';

/**
 * Normalize reference for berthing validation.
 * @param {unknown} ref
 * @returns {string}
 */
export function normalizeSiReference(ref) {
  if (ref == null) return '';
  return String(ref).trim();
}

function collapsedReference(ref) {
  return normalizeSiReference(ref).replace(/\s+/g, ' ');
}

/**
 * Vessel name decorated as a fake SI, such as "BG MARINA NO SI" or "BG MARINA SI".
 * An exact vessel-name match is handled separately.
 * @param {unknown} referenceNumber
 * @param {unknown} vesselName
 * @returns {boolean}
 */
export function isVesselNameAliasReference(referenceNumber, vesselName) {
  const ref = collapsedReference(referenceNumber);
  const vessel = collapsedReference(vesselName);
  if (!ref || !vessel) return false;
  const lower = ref.toLowerCase();
  const v = vessel.toLowerCase();
  if (lower === v) return false;
  let stripped = lower.replace(/\s+no\s+si$/i, '');
  if (stripped === lower) stripped = lower.replace(/\s+si$/i, '');
  stripped = stripped.trim();
  return stripped === v;
}

/**
 * Reject a newly typed vessel-name alias. An unchanged stored alias is left in place.
 * @param {unknown} referenceNumber
 * @param {unknown} vesselName
 * @param {unknown} [previousReference]
 * @returns {string|null}
 */
export function validateFreshSiReference(referenceNumber, vesselName, previousReference) {
  if (!isVesselNameAliasReference(referenceNumber, vesselName)) return null;
  const next = collapsedReference(referenceNumber).toLowerCase();
  const prev = collapsedReference(previousReference).toLowerCase();
  if (prev && prev === next) return null;
  return SI_REFERENCE_BERTHING_ERROR;
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
  if (isVesselNameAliasReference(ref, vessel)) return SI_REFERENCE_BERTHING_ERROR;
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
