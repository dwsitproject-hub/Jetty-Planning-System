/**
 * Server-authoritative quantity for a cargo load line segment.
 *
 * While ATG resolves for the segment window the quantity always comes from the
 * gauge delta, so a client can never persist a hand-typed number under
 * atg_qty_mode = 'auto'. Manual entry is only reachable through
 * atg_qty_mode = 'manual', which in turn is only accepted when ATG has no
 * usable data for that window (or the same window was already manual).
 */

/** Rounding noise between the client autofill and the server recompute. */
const QTY_EPSILON = 1e-6;

/**
 * @param {{ ok?: boolean, incomplete?: boolean, sumDeltaMass?: number|string|null }|null|undefined} atg
 */
export function isAtgResolvable(atg) {
  if (!atg || atg.ok !== true || atg.incomplete === true) return false;
  const mass = Number(atg.sumDeltaMass);
  return atg.sumDeltaMass != null && Number.isFinite(mass) && mass > 0;
}

/**
 * @param {object} opts
 * @param {'Liquid'|'Solid'} opts.commodityType
 * @param {Array<number|string>} opts.atgTankIds
 * @param {Array<number|string>} opts.manualTankIds
 * @param {'auto'|'manual'} opts.atgQtyMode — as submitted by the client
 * @param {boolean} opts.hasEnd
 * @param {number|null} opts.submittedQty
 * @param {number|null} opts.manualQty
 * @param {{ ok?: boolean, incomplete?: boolean, sumDeltaMass?: number|null }|null} opts.atg
 * @param {boolean} [opts.grandfatheredManual] — an existing manual row covers this exact window
 * @returns {{ qty: number|null, atgQtyMode: 'auto'|'manual', coerced: string|null, error: string|null }}
 */
export function resolveCargoLineQty({
  commodityType,
  atgTankIds,
  manualTankIds,
  atgQtyMode,
  hasEnd,
  submittedQty,
  manualQty,
  atg,
  grandfatheredManual = false,
}) {
  const mode = atgQtyMode === 'manual' ? 'manual' : 'auto';
  const atgCount = Array.isArray(atgTankIds) ? atgTankIds.length : 0;
  const manualCount = Array.isArray(manualTankIds) ? manualTankIds.length : 0;
  const qty = submittedQty != null && Number.isFinite(Number(submittedQty)) ? Number(submittedQty) : null;
  const manual = manualQty != null && Number.isFinite(Number(manualQty)) ? Number(manualQty) : null;

  // Solid cargo and liquid lines without ATG tanks keep the submitted quantity.
  if (commodityType === 'Solid' || atgCount === 0) {
    if (hasEnd && qty == null) {
      return { qty: null, atgQtyMode: mode, coerced: null, error: 'qty is required when endAt is set' };
    }
    return { qty, atgQtyMode: mode, coerced: null, error: null };
  }

  // In-progress segment: quantity is derived live, never stored.
  if (!hasEnd) {
    return { qty: null, atgQtyMode: mode, coerced: null, error: null };
  }

  if (isAtgResolvable(atg)) {
    const atgPart = Number(atg.sumDeltaMass);

    if (mode === 'manual') {
      if (!grandfatheredManual) {
        return {
          qty: null,
          atgQtyMode: 'manual',
          coerced: null,
          error:
            'ATG data is available for this segment; manual quantity override is not allowed. Untick "ATG not available" to use the ATG quantity.',
        };
      }
      if (qty == null) {
        return {
          qty: null,
          atgQtyMode: 'manual',
          coerced: null,
          error: 'qty is required for a manual override segment',
        };
      }
      return { qty, atgQtyMode: 'manual', coerced: null, error: null };
    }

    if (manualCount > 0) {
      if (manual == null || manual <= 0) {
        return {
          qty: null,
          atgQtyMode: 'auto',
          coerced: null,
          error: 'manualQty is required for non-ATG tanks on this line',
        };
      }
      return { qty: atgPart + manual, atgQtyMode: 'auto', coerced: null, error: null };
    }

    const coerced = qty != null && Math.abs(qty - atgPart) > QTY_EPSILON ? 'qty_from_atg' : null;
    return { qty: atgPart, atgQtyMode: 'auto', coerced, error: null };
  }

  // No usable ATG data for this window.
  if (mode === 'manual') {
    if (qty == null) {
      return {
        qty: null,
        atgQtyMode: 'manual',
        coerced: null,
        error: 'qty is required for a manual override segment',
      };
    }
    return { qty, atgQtyMode: 'manual', coerced: null, error: null };
  }

  if (qty != null) {
    // Cannot be verified against ATG, so record it honestly as a manual override
    // instead of storing an ATG-labelled number nobody can reconcile.
    return { qty, atgQtyMode: 'manual', coerced: 'manual_no_atg', error: null };
  }

  return {
    qty: null,
    atgQtyMode: 'auto',
    coerced: null,
    error:
      'ATG quantity is unavailable for this segment; mark "ATG not available" and enter the quantity manually',
  };
}
