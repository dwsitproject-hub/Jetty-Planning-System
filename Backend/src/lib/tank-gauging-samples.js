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
 * @param {Array<{ tank_id: number|string, sampled_at: Date|string, total_mass: number|string }>} rows
 * @param {number} maxPoints
 */
export function groupAndDownsampleSampleRows(rows, maxPoints) {
  const byTank = new Map();

  for (const row of rows) {
    const tankId = String(row.tank_id);
    if (!byTank.has(tankId)) byTank.set(tankId, []);
    byTank.get(tankId).push({
      sampledAt: new Date(row.sampled_at).toISOString(),
      totalMass: Number(row.total_mass),
    });
  }

  const samples = {};
  for (const [tankId, pts] of byTank.entries()) {
    pts.sort((a, b) => Date.parse(a.sampledAt) - Date.parse(b.sampledAt));
    samples[tankId] = downsampleTankGaugingSamples(pts, maxPoints);
  }

  return samples;
}
