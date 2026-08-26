/** User-facing message when SI reference fails berthing validation. */
export const SI_REFERENCE_BERTHING_ERROR =
  'Shipping Instructions No. is required before berthing and cannot be blank, a single quote, or the same as the vessel name.';

/** Tooltip when plan has SIs but reference number is not valid for berthing. */
export const BERTHING_INVALID_SI_REF_TOOLTIP =
  'Enter a valid Shipping Instructions No. on the shipment plan before berthing.';

/**
 * @param {unknown} ref
 * @returns {string}
 */
export function normalizeSiReference(ref) {
  if (ref == null) return '';
  return String(ref).trim();
}

/**
 * Synthetic fallback label from formatListRow when reference_number is empty.
 * @param {unknown} label
 * @returns {boolean}
 */
export function isSyntheticSiLabel(label) {
  return /^SI-\d+$/.test(normalizeSiReference(label));
}

/**
 * @param {unknown} referenceNumber
 * @param {unknown} vesselName
 * @returns {string|null}
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
 * Resolve the reference string used for berthing validation from a queue entry or row field.
 * @param {{ referenceNumber?: unknown, label?: unknown, shippingInstruction?: unknown }} entry
 * @returns {string}
 */
export function resolveSiReferenceForBerthingCheck(entry) {
  const explicit = entry?.referenceNumber;
  if (explicit != null && normalizeSiReference(explicit) !== '') return normalizeSiReference(explicit);
  const label = normalizeSiReference(entry?.label ?? entry?.shippingInstruction);
  if (!label || isSyntheticSiLabel(label)) return '';
  return label;
}

/**
 * Collect SI reference strings from an allocation queue row for berthing checks.
 * @param {object|null|undefined} row
 * @returns {string[]}
 */
export function siReferencesFromQueueRow(row) {
  if (!row) return [];
  if (Array.isArray(row.planQueueSiEntries) && row.planQueueSiEntries.length > 0) {
    return row.planQueueSiEntries.map((e) => resolveSiReferenceForBerthingCheck(e));
  }
  const single = resolveSiReferenceForBerthingCheck({
    referenceNumber: row.shippingInstructionReference,
    shippingInstruction: row.shippingInstruction,
  });
  return single !== '' || row.shippingInstructionId != null ? [single] : [];
}

/**
 * @param {object|null|undefined} row
 * @returns {string|null}
 */
export function validateQueueRowSiReferencesForBerthing(row) {
  const vesselName = row?.vesselName;
  const refs = siReferencesFromQueueRow(row);
  if (refs.length === 0) return null;
  for (const ref of refs) {
    const err = validateSiReferenceForBerthing(ref, vesselName);
    if (err) return err;
  }
  return null;
}
