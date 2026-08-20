/**
 * Downsample tank gauging sample series for port-wide mass curves.
 */

/**
 * @param {Array<{ sampledAt: string, totalMass: number }>} samples — sorted ASC by sampledAt
 * @param {number} maxPoints
 * @returns {Array<{ sampledAt: string, totalMass: number }>}
 */
export function downsampleTankGaugingSamples(samples, maxPoints) {
  if (!Array.isArray(samples) || samples.length <= maxPoints || maxPoints < 2) {
    return samples;
  }

  const startMs = Date.parse(samples[0].sampledAt);
  const endMs = Date.parse(samples[samples.length - 1].sampledAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return samples.slice(0, maxPoints);
  }

  const bucketMs = (endMs - startMs) / maxPoints;
  const out = [];
  let bucketStart = 0;

  for (let b = 0; b < maxPoints; b += 1) {
    const lo = startMs + b * bucketMs;
    const hi = b === maxPoints - 1 ? endMs + 1 : startMs + (b + 1) * bucketMs;

    while (bucketStart < samples.length && Date.parse(samples[bucketStart].sampledAt) < lo) {
      bucketStart += 1;
    }

    let i = bucketStart;
    let min = null;
    let max = null;
    let last = null;

    while (i < samples.length) {
      const t = Date.parse(samples[i].sampledAt);
      if (t >= hi) break;
      const pt = samples[i];
      if (!min || pt.totalMass < min.totalMass) min = pt;
      if (!max || pt.totalMass > max.totalMass) max = pt;
      last = pt;
      i += 1;
    }

    bucketStart = i;

    const seen = new Set();
    for (const pt of [min, max, last]) {
      if (!pt || seen.has(pt.sampledAt)) continue;
      seen.add(pt.sampledAt);
      out.push(pt);
    }
  }

  out.sort((a, b) => Date.parse(a.sampledAt) - Date.parse(b.sampledAt));
  return out.length > maxPoints ? out.slice(-maxPoints) : out;
}

/**
 * @param {Array<object>} rows
 * @param {number} maxPoints
 * @param {boolean} [detail=false]
 */
export function mapSampleRow(row, detail = false) {
  const base = {
    sampledAt: new Date(row.sampled_at).toISOString(),
    totalMass: Number(row.total_mass),
  };
  if (!detail) return base;
  return {
    ...base,
    levelMm: row.level_mm != null ? Number(row.level_mm) : null,
    temperatureC: row.temperature_c != null ? Number(row.temperature_c) : null,
    observedDensityKgM3:
      row.observed_density_kg_m3 != null ? Number(row.observed_density_kg_m3) : null,
    totalObservedVolume:
      row.total_observed_volume != null ? Number(row.total_observed_volume) : null,
    statusText: row.status_text ?? null,
    productName: row.product_name ?? null,
  };
}

/**
 * @param {Array<object>} rows
 * @param {number} maxPoints
 * @param {object} [opts]
 * @param {boolean} [opts.detail=false]
 */
export function groupAndDownsampleSampleRows(rows, maxPoints, { detail = false } = {}) {
  const byTank = new Map();

  for (const row of rows) {
    const tankId = String(row.tank_id);
    if (!byTank.has(tankId)) byTank.set(tankId, []);
    byTank.get(tankId).push(mapSampleRow(row, detail));
  }

  const samples = {};
  for (const [tankId, pts] of byTank.entries()) {
    pts.sort((a, b) => Date.parse(a.sampledAt) - Date.parse(b.sampledAt));
    samples[tankId] = downsampleTankGaugingSamples(pts, maxPoints);
  }

  return samples;
}
