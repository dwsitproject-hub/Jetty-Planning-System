/**
 * Historical ATG lookup for ICC sounding from tank_gauging_samples.
 */
import { observedVolumeToKl, resolveAtgMeasurementBasis } from './atg-measurement.js';
import { DEFAULT_TOLERANCE_MS } from './atg-window-rate.js';

export function resolveHistoricalToleranceMs() {
  const raw = Number(process.env.SOUNDING_HISTORICAL_TOLERANCE_MS ?? DEFAULT_TOLERANCE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TOLERANCE_MS;
}

function sampleAgeMs(soundedAt, sampledAt) {
  const a = new Date(soundedAt).getTime();
  const b = new Date(sampledAt).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs(a - b);
}

function classifyMatchQuality(ageMs, toleranceMs) {
  if (ageMs == null) return 'none';
  if (ageMs <= 60_000) return 'exact';
  if (ageMs <= toleranceMs) return 'near';
  return 'none';
}

async function nearestSample(db, tankId, at, toleranceMs, measurementBasis) {
  const valueCol = measurementBasis === 'volume' ? 'total_observed_volume' : 'total_mass';
  const r = await db.query(
    `SELECT id, tank_id, source_base_url, total_mass, total_observed_volume,
            level_mm, temperature_c, sampled_at, status_text
     FROM tank_gauging_samples
     WHERE tank_id = $1
       AND sampled_at <= $2
       AND sampled_at >= $2::timestamptz - ($3::bigint * INTERVAL '1 millisecond')
       AND ${valueCol} IS NOT NULL
     ORDER BY sampled_at DESC
     LIMIT 1`,
    [tankId, at.toISOString(), toleranceMs]
  );
  if (r.rows[0]) return r.rows[0];

  const r2 = await db.query(
    `SELECT id, tank_id, source_base_url, total_mass, total_observed_volume,
            level_mm, temperature_c, sampled_at, status_text
     FROM tank_gauging_samples
     WHERE tank_id = $1
       AND sampled_at > $2
       AND sampled_at <= $2::timestamptz + ($3::bigint * INTERVAL '1 millisecond')
       AND ${valueCol} IS NOT NULL
     ORDER BY sampled_at ASC
     LIMIT 1`,
    [tankId, at.toISOString(), toleranceMs]
  );
  return r2.rows[0] || null;
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ tankId: number, soundedAt: string|Date, siMetric?: string, toleranceMs?: number, sourceBaseUrl?: string|null }} opts
 */
export async function lookupHistoricalAtgReading(db, opts) {
  const tankId = Number(opts.tankId);
  const soundedAt = new Date(opts.soundedAt);
  if (!Number.isFinite(tankId) || tankId <= 0) {
    throw Object.assign(new Error('tankId is required'), { statusCode: 400 });
  }
  if (Number.isNaN(soundedAt.getTime())) {
    throw Object.assign(new Error('soundedAt is invalid'), { statusCode: 400 });
  }

  const siMetric = String(opts.siMetric || 'MT').trim().toUpperCase() || 'MT';
  const measurementBasis = resolveAtgMeasurementBasis(siMetric);
  const toleranceMs = Number.isFinite(opts.toleranceMs) ? opts.toleranceMs : resolveHistoricalToleranceMs();

  const sample = await nearestSample(db, tankId, soundedAt, toleranceMs, measurementBasis);

  if (!sample) {
    return {
      found: false,
      reason: 'no_sample',
      toleranceMs,
      soundedAt: soundedAt.toISOString(),
    };
  }

  if (opts.sourceBaseUrl && sample.source_base_url !== opts.sourceBaseUrl) {
    return {
      found: false,
      reason: 'no_sample',
      toleranceMs,
      soundedAt: soundedAt.toISOString(),
    };
  }

  const sampledAt = sample.sampled_at;
  const ageMs = sampleAgeMs(soundedAt, sampledAt);
  const matchQuality = classifyMatchQuality(ageMs, toleranceMs);
  if (matchQuality === 'none') {
    return {
      found: false,
      reason: 'outside_tolerance',
      toleranceMs,
      soundedAt: soundedAt.toISOString(),
      nearestSampleAt: sampledAt,
    };
  }

  const massMt = sample.total_mass != null ? Number(sample.total_mass) : null;
  const volumeKl =
    sample.total_observed_volume != null
      ? observedVolumeToKl(Number(sample.total_observed_volume))
      : null;
  const temperatureC =
    sample.temperature_c != null ? Number(sample.temperature_c) : null;

  return {
    found: true,
    reason: null,
    toleranceMs,
    soundedAt: soundedAt.toISOString(),
    matchQuality,
    sampleId: sample.id != null ? Number(sample.id) : null,
    sampledAt,
    sourceBaseUrl: sample.source_base_url ?? null,
    reading: {
      massMt,
      volumeKl,
      temperatureC,
      levelMm: sample.level_mm != null ? Number(sample.level_mm) : null,
      lockedAt: sampledAt,
      source: 'sample',
      sampleId: sample.id != null ? Number(sample.id) : null,
      matchQuality,
    },
  };
}
