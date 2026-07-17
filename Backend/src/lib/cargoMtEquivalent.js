/**
 * KL → MT equivalent cargo totals for DWT / vessel_capacity.
 * Mirrors Frontend/src/utils/planCargoMtTotal.js.
 */

function metricCodeForRow(row, metrics) {
  if (row?.metricCode) return String(row.metricCode).toUpperCase();
  const mid = row?.metricId ?? row?.metric_id;
  if (mid == null || mid === '') return null;
  const m = (metrics || []).find((x) => String(x.id) === String(mid));
  return m?.code ? String(m.code).toUpperCase() : null;
}

function getKlToMtFactorForRow(row, { commodities } = {}) {
  const cid = row?.commodityId ?? row?.commodity_id;
  if (cid == null || cid === '') return null;
  const c = (commodities || []).find((x) => String(x.id) === String(cid));
  const f = c?.klToMtFactor ?? c?.kl_to_mt_factor;
  if (f == null || f === '') return null;
  const n = Number(f);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function klQtyToMtEquivalent(klQty, factor) {
  const q = Number(klQty);
  const f = Number(factor);
  if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(f) || f <= 0) return 0;
  return q * f;
}

export function getKlToMtFactorForBreakdownRow(row, lookups) {
  return getKlToMtFactorForRow(row, lookups);
}

export function sumBreakdownMtEquivalent(formsOrBreakdowns, lookups) {
  let total = 0;
  const metrics = lookups?.metrics;
  const commodities = lookups?.commodities;
  for (const item of formsOrBreakdowns || []) {
    const rows = Array.isArray(item?.breakdown) ? item.breakdown : Array.isArray(item) ? item : [];
    for (const row of rows) {
      const qty = Number(row.qty);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const code = metricCodeForRow(row, metrics);
      if (code === 'MT') {
        total += qty;
      } else if (code === 'KL') {
        const factor = getKlToMtFactorForRow(row, { commodities });
        if (factor != null) total += klQtyToMtEquivalent(qty, factor);
      }
    }
  }
  return total;
}

export function breakdownHasUnconvertedKl(formsOrBreakdowns, lookups) {
  const metrics = lookups?.metrics;
  const commodities = lookups?.commodities;
  for (const item of formsOrBreakdowns || []) {
    const rows = Array.isArray(item?.breakdown) ? item.breakdown : Array.isArray(item) ? item : [];
    for (const row of rows) {
      const code = metricCodeForRow(row, metrics);
      const qty = Number(row.qty);
      if (code !== 'KL' || !Number.isFinite(qty) || qty <= 0) continue;
      if (getKlToMtFactorForRow(row, { commodities }) == null) return true;
    }
  }
  return false;
}
