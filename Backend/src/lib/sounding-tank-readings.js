/**
 * Validate and normalize ICC sounding tank readings persisted in payload_json.
 */
import { resolveAtgMeasurementBasis } from './atg-measurement.js';

function normalizeReadingSide(item, measurementBasis, sideLabel, opts = {}) {
  const requireTimestamp = opts.requireTimestamp !== false;
  if (!item || typeof item !== 'object') {
    throw Object.assign(new Error(`${sideLabel} reading must be an object`), { statusCode: 400 });
  }
  const temperatureC = Number(item.temperatureC ?? item.temperature_c);
  if (!Number.isFinite(temperatureC)) {
    throw Object.assign(new Error(`${sideLabel} temperatureC is required`), { statusCode: 400 });
  }

  const massMtRaw = item.massMt ?? item.mass_mt;
  const volumeKlRaw = item.volumeKl ?? item.volume_kl;
  let massMt = massMtRaw != null && massMtRaw !== '' ? Number(massMtRaw) : null;
  let volumeKl = volumeKlRaw != null && volumeKlRaw !== '' ? Number(volumeKlRaw) : null;

  if (measurementBasis === 'mass') {
    if (massMt == null || !Number.isFinite(massMt)) {
      throw Object.assign(new Error(`${sideLabel} massMt is required`), { statusCode: 400 });
    }
  } else if (volumeKl == null || !Number.isFinite(volumeKl)) {
    throw Object.assign(new Error(`${sideLabel} volumeKl is required`), { statusCode: 400 });
  }

  if (massMt != null && !Number.isFinite(massMt)) massMt = null;
  if (volumeKl != null && !Number.isFinite(volumeKl)) volumeKl = null;

  const timestamp = item.lockedAt ?? item.locked_at ?? item.capturedAt ?? item.captured_at ?? null;
  if (requireTimestamp && !timestamp) {
    throw Object.assign(new Error(`${sideLabel} timestamp is required`), { statusCode: 400 });
  }

  return {
    massMt,
    volumeKl,
    temperatureC,
    levelMm: item.levelMm ?? item.level_mm ?? null,
    observedDensityKgM3: item.observedDensityKgM3 ?? item.observed_density_kg_m3 ?? null,
    lockedAt: item.lockedAt ?? item.locked_at ?? null,
    capturedAt: item.capturedAt ?? item.captured_at ?? null,
    stabilization:
      item.stabilization && typeof item.stabilization === 'object' ? item.stabilization : null,
    variancePct: item.variancePct ?? item.variance_pct ?? null,
    source: item.source ?? null,
    sampleId: item.sampleId ?? item.sample_id ?? null,
    matchQuality: item.matchQuality ?? item.match_quality ?? null,
  };
}

function normalizeAtgSide(item, measurementBasis) {
  if (item == null) return null;
  return normalizeReadingSide(item, measurementBasis, 'ATG');
}

/**
 * @param {unknown} raw
 * @param {{ siMetric?: string|null, requireReadings?: boolean }} [opts]
 */
export function validateAndNormalizeTankReadings(raw, opts = {}) {
  const siMetric = String(opts.siMetric || 'MT').trim().toUpperCase() || 'MT';
  const measurementBasis = resolveAtgMeasurementBasis(siMetric);
  const requireReadings = opts.requireReadings !== false;

  if (raw == null || raw === '') {
    if (requireReadings) {
      throw Object.assign(new Error('At least one shore tank sounding reading is required'), {
        statusCode: 400,
      });
    }
    return [];
  }

  if (!Array.isArray(raw)) {
    throw Object.assign(new Error('tankReadings must be an array'), { statusCode: 400 });
  }

  if (requireReadings && raw.length === 0) {
    throw Object.assign(new Error('At least one shore tank sounding reading is required'), {
      statusCode: 400,
    });
  }

  const out = [];
  const seenTankIds = new Set();

  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      throw Object.assign(new Error('Each tank reading must be an object'), { statusCode: 400 });
    }
    const tankId = Number(item.tankId ?? item.tank_id);
    if (!Number.isFinite(tankId) || tankId <= 0) {
      throw Object.assign(new Error('Each tank reading requires a valid tankId'), { statusCode: 400 });
    }
    if (seenTankIds.has(tankId)) {
      throw Object.assign(new Error(`Duplicate tank reading for tankId ${tankId}`), { statusCode: 400 });
    }
    seenTankIds.add(tankId);

    const captureMode = String(item.captureMode ?? item.capture_mode ?? 'auto').toLowerCase();
    const soundedAt = item.soundedAt ?? item.sounded_at ?? null;
    const atgSkipped = Boolean(item.atgSkipped ?? item.atg_skipped);

    if (captureMode === 'dual') {
      const manual = normalizeReadingSide(item.manual, measurementBasis, 'Manual');
      const atgRaw = item.atg;
      const atg = atgRaw ? normalizeAtgSide(atgRaw, measurementBasis) : null;
      if (!atg && !atgSkipped) {
        throw Object.assign(
          new Error(`dual capture requires atg or atgSkipped for tank ${tankId}`),
          { statusCode: 400 }
        );
      }
      const lockedAt = item.lockedAt ?? item.locked_at ?? null;
      if (!lockedAt) {
        throw Object.assign(new Error(`lockedAt is required for tank ${tankId}`), { statusCode: 400 });
      }
      const row = {
        tankId,
        tankCode: item.tankCode ?? item.tank_code ?? null,
        captureMode: 'dual',
        measurementBasis,
        soundedAt,
        atgSkipped: false,
        manual: {
          massMt: manual.massMt,
          volumeKl: manual.volumeKl,
          temperatureC: manual.temperatureC,
          capturedAt: manual.capturedAt ?? manual.lockedAt,
        },
        lockedAt,
        atgSourceBaseUrl: item.atgSourceBaseUrl ?? item.atg_source_base_url ?? null,
        sessionId: item.sessionId ?? item.session_id ?? null,
      };
      if (atg) {
        row.atg = {
          massMt: atg.massMt,
          volumeKl: atg.volumeKl,
          temperatureC: atg.temperatureC,
          levelMm: atg.levelMm,
          observedDensityKgM3: atg.observedDensityKgM3,
          lockedAt: atg.lockedAt ?? atg.capturedAt,
          stabilization: atg.stabilization ?? { state: 'locked' },
          variancePct: atg.variancePct,
          source: atg.source ?? 'live',
          sampleId: atg.sampleId,
          matchQuality: atg.matchQuality,
        };
      }
      out.push(row);
      continue;
    }

    if (captureMode === 'manual') {
      const manual = normalizeReadingSide(item.manual ?? item, measurementBasis, 'Manual');
      const lockedAt = item.lockedAt ?? item.locked_at ?? manual.lockedAt ?? manual.capturedAt ?? null;
      if (!lockedAt) {
        throw Object.assign(new Error(`lockedAt is required for tank ${tankId}`), { statusCode: 400 });
      }
      out.push({
        tankId,
        tankCode: item.tankCode ?? item.tank_code ?? null,
        captureMode: 'manual',
        measurementBasis,
        soundedAt,
        atgSkipped: true,
        manual: {
          massMt: manual.massMt,
          volumeKl: manual.volumeKl,
          temperatureC: manual.temperatureC,
          capturedAt: manual.capturedAt ?? manual.lockedAt,
        },
        lockedAt,
        atgSourceBaseUrl: item.atgSourceBaseUrl ?? item.atg_source_base_url ?? null,
        sessionId: item.sessionId ?? item.session_id ?? null,
      });
      continue;
    }

    if (captureMode !== 'auto') {
      throw Object.assign(new Error('captureMode must be auto, manual, or dual'), { statusCode: 400 });
    }

    const side = normalizeReadingSide(item, measurementBasis, 'ATG');
    const lockedAt = item.lockedAt ?? item.locked_at ?? side.lockedAt ?? side.capturedAt ?? null;
    if (!lockedAt) {
      throw Object.assign(new Error(`lockedAt is required for tank ${tankId}`), { statusCode: 400 });
    }

    out.push({
      tankId,
      tankCode: item.tankCode ?? item.tank_code ?? null,
      captureMode: 'auto',
      measurementBasis,
      soundedAt,
      massMt: side.massMt,
      volumeKl: side.volumeKl,
      temperatureC: side.temperatureC,
      levelMm: side.levelMm,
      observedDensityKgM3: side.observedDensityKgM3,
      lockedAt,
      stabilization: item.stabilization && typeof item.stabilization === 'object'
        ? item.stabilization
        : { state: 'locked' },
      atgSourceBaseUrl: item.atgSourceBaseUrl ?? item.atg_source_base_url ?? null,
      sessionId: item.sessionId ?? item.session_id ?? null,
    });
  }

  return out;
}
