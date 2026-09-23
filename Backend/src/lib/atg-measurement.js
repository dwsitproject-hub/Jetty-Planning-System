/**
 * ATG measurement basis (MT mass vs KL volume) and flat-movement threshold defaults.
 */

export const DEFAULT_FLAT_RATE_THRESHOLD_MT = 2.0;
export const DEFAULT_MIN_QTY_MOVED_MT = 1.0;
export const DEFAULT_FLAT_RATE_THRESHOLD_KL = 2.0;
export const DEFAULT_MIN_QTY_MOVED_KL = 1.0;

/**
 * @param {string|null|undefined} siMetric
 * @returns {'mass'|'volume'}
 */
export function resolveAtgMeasurementBasis(siMetric) {
  return String(siMetric || 'MT').toUpperCase() === 'KL' ? 'volume' : 'mass';
}

/**
 * NXA PARAM 717 may be stored as m³ or liters — match Tank Farm display heuristic.
 * @param {number|string|null|undefined} v
 * @returns {number|null}
 */
export function observedVolumeToLiters(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n < 100000 ? n * 1000 : n;
}

/**
 * @param {number|null|undefined} liters
 * @returns {number|null}
 */
export function litersToKl(liters) {
  if (liters == null) return null;
  const n = Number(liters);
  if (!Number.isFinite(n)) return null;
  return n / 1000;
}

/**
 * @param {number|string|null|undefined} observedVolume raw total_observed_volume
 * @returns {number|null} kiloliters
 */
export function observedVolumeToKl(observedVolume) {
  const liters = observedVolumeToLiters(observedVolume);
  return litersToKl(liters);
}

/**
 * @param {string|null|undefined} siMetric
 * @returns {{
 *   flatRateThreshold: number,
 *   minQtyMoved: number,
 *   flatRateThresholdTph: number,
 *   minQtyMovedT: number,
 *   rateUnit: string,
 *   qtyUnit: string,
 *   measurementBasis: 'mass'|'volume',
 * }}
 */
export function resolveFlatThresholds(siMetric) {
  const isKl = String(siMetric || 'MT').toUpperCase() === 'KL';
  if (isKl) {
    return {
      flatRateThreshold: DEFAULT_FLAT_RATE_THRESHOLD_KL,
      minQtyMoved: DEFAULT_MIN_QTY_MOVED_KL,
      flatRateThresholdTph: DEFAULT_FLAT_RATE_THRESHOLD_KL,
      minQtyMovedT: DEFAULT_MIN_QTY_MOVED_KL,
      rateUnit: 'KL/h',
      qtyUnit: 'KL',
      measurementBasis: 'volume',
    };
  }
  return {
    flatRateThreshold: DEFAULT_FLAT_RATE_THRESHOLD_MT,
    minQtyMoved: DEFAULT_MIN_QTY_MOVED_MT,
    flatRateThresholdTph: DEFAULT_FLAT_RATE_THRESHOLD_MT,
    minQtyMovedT: DEFAULT_MIN_QTY_MOVED_MT,
    rateUnit: 'MT/h',
    qtyUnit: 'MT',
    measurementBasis: 'mass',
  };
}

/**
 * Canonical ATG delta qty from a window compute result.
 * @param {{ sumAtgQty?: number|null, sumDeltaMass?: number|null, sumDeltaVolumeKl?: number|null }|null|undefined} result
 * @returns {number|null}
 */
export function readAtgQtyFromResult(result) {
  if (!result) return null;
  if (result.sumAtgQty != null && Number.isFinite(Number(result.sumAtgQty))) {
    return Number(result.sumAtgQty);
  }
  if (result.sumDeltaVolumeKl != null && Number.isFinite(Number(result.sumDeltaVolumeKl))) {
    return Number(result.sumDeltaVolumeKl);
  }
  if (result.sumDeltaMass != null && Number.isFinite(Number(result.sumDeltaMass))) {
    return Number(result.sumDeltaMass);
  }
  return null;
}

/**
 * Attach sumAtgQty (+ legacy sumDeltaMass for MT) to an ATG window result.
 * @param {object} result
 * @param {'mass'|'volume'} measurementBasis
 * @returns {object}
 */
export function attachAtgQtyFields(result, measurementBasis) {
  const qty = readAtgQtyFromResult(result);
  const out = { ...result, sumAtgQty: qty, measurementBasis };
  if (measurementBasis === 'mass' && qty != null) {
    out.sumDeltaMass = qty;
  }
  return out;
}
