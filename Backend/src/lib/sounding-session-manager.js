/**
 * In-memory ATG sounding session manager — high-frequency poll for selected tanks.
 */
import crypto from 'node:crypto';
import { pool } from '../db.js';
import {
  TankStabilizationTracker,
  resolveSoundingStabilizationConfig,
} from './atg-stabilization.js';
import { observedVolumeToKl, resolveAtgMeasurementBasis } from './atg-measurement.js';
import { lookupHistoricalAtgReading } from './sounding-atg-historical.js';
import { resolveEnabledSources } from './tank-gauging-source-config.js';
import {
  fetchTankParameters,
  parseTankParameterResponse,
  trimBaseUrl,
} from './tankvision-client.js';

const config = resolveSoundingStabilizationConfig();

/** @type {Map<string, object>} */
const sessions = new Map();
/** @type {Map<number, string>} */
const sessionIdByOperation = new Map();

let cleanupTimer = null;

function startCleanupTimer() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions.entries()) {
      if (now > session.expiresAt) {
        destroySession(id, 'expired');
      }
    }
  }, 60_000);
  if (cleanupTimer.unref) cleanupTimer.unref();
}

function parseSoundedAt(raw) {
  if (raw == null || raw === '') return new Date();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw Object.assign(new Error('soundedAt is invalid'), { statusCode: 400 });
  }
  return d;
}

function resolveTankCaptureMode(soundedAt) {
  const ms = Math.abs(Date.now() - new Date(soundedAt).getTime());
  return ms <= config.liveWindowMs ? 'live' : 'historical';
}

function createTankRecord(row, soundedAtInput) {
  const soundedAt = parseSoundedAt(soundedAtInput).toISOString();
  return {
    tankId: Number(row.tank_id),
    code: row.code,
    name: row.name,
    externalTankId: Number(row.external_tank_id),
    sourceBaseUrl: row.source_base_url,
    sourceUnitName: row.source_unit_name,
    soundedAt,
    captureMode: resolveTankCaptureMode(soundedAt),
    manualMode: false,
    atgCaptured: null,
    atgSkipped: false,
    manualCaptured: null,
    historicalLookup: null,
    lastReading: null,
    tracker: new TankStabilizationTracker({
      windowSec: config.windowSec,
      stableThresholdPct: config.stableThresholdPct,
      stableHoldSec: config.stableHoldSec,
      minSamples: config.minSamples,
    }),
  };
}

function tankShouldPollLive(tank) {
  if (tank.atgCaptured || tank.atgSkipped) return false;
  if (tank.captureMode !== 'live') return false;
  return true;
}

async function loadTankMappings(db, tankIds, portId) {
  if (!tankIds.length) return [];
  const r = await db.query(
    `SELECT t.id AS tank_id, t.code, t.name,
            m.external_tank_id, m.source_base_url, m.source_unit_name
     FROM master_tanks t
     JOIN tank_gauging_tank_map m ON m.tank_id = t.id AND m.port_id = $2
     JOIN tank_gauging_sources s
       ON s.port_id = m.port_id
      AND s.base_url = m.source_base_url
      AND s.enabled = TRUE
     WHERE t.id = ANY($1::bigint[])
       AND t.port_id = $2
       AND t.deleted_at IS NULL
     ORDER BY t.sort_order ASC, LOWER(t.code) ASC, t.id ASC`,
    [tankIds, portId]
  );
  return r.rows;
}

function primaryValueFromReading(reading, measurementBasis) {
  if (measurementBasis === 'volume') {
    return observedVolumeToKl(reading.totalObservedVolume);
  }
  const mass = reading.totalMass != null ? Number(reading.totalMass) : null;
  return mass != null && Number.isFinite(mass) ? mass : null;
}

function hostFromUrl(baseUrl) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return String(baseUrl || '').replace(/^https?:\/\//i, '');
  }
}

async function applyHistoricalAtgToTank(session, tank) {
  const result = await lookupHistoricalAtgReading(pool, {
    tankId: tank.tankId,
    soundedAt: tank.soundedAt,
    siMetric: session.siMetric,
    sourceBaseUrl: tank.sourceBaseUrl,
  });
  tank.historicalLookup = {
    found: result.found,
    reason: result.reason ?? null,
    matchQuality: result.matchQuality ?? null,
    sampledAt: result.sampledAt ?? null,
  };
  if (result.found && result.reading) {
    tank.atgCaptured = {
      ...result.reading,
      stabilization: { state: 'sample', matchQuality: result.matchQuality },
    };
  }
}

async function pollSessionOnce(session) {
  if (!session.active) return;
  const sources = await resolveEnabledSources(pool, { portId: session.portId });
  const authByBase = new Map(sources.map((s) => [trimBaseUrl(s.baseUrl), s.auth]));

  const groups = new Map();
  for (const tank of session.tanks.values()) {
    if (!tankShouldPollLive(tank)) continue;
    if (tank.tracker.state === 'locked' || tank.tracker.state === 'manual') continue;
    if (tank.manualMode) continue;
    const base = trimBaseUrl(tank.sourceBaseUrl);
    if (!groups.has(base)) groups.set(base, { externalIds: [], tankIds: [] });
    const g = groups.get(base);
    g.externalIds.push(tank.externalTankId);
    g.tankIds.push(tank.tankId);
  }

  if (!groups.size) return;

  let hadSuccess = false;
  for (const [baseUrl, group] of groups.entries()) {
    const auth = authByBase.get(baseUrl) || { type: 'none' };
    const tankList = [...new Set(group.externalIds)].join('|');
    try {
      const res = await fetchTankParameters({ baseUrl, auth, tankList });
      if (!res.ok || !res.text) {
        session.consecutiveErrors += 1;
        for (const tankId of group.tankIds) {
          const tank = session.tanks.get(tankId);
          if (tank && session.consecutiveErrors >= config.maxConsecutiveErrors) {
            tank.tracker.setError(`Tankvision HTTP ${res.status || 'error'}`);
          }
        }
        continue;
      }
      hadSuccess = true;
      session.consecutiveErrors = 0;
      const { readings } = parseTankParameterResponse(res.text);
      const byExternal = new Map(readings.map((rd) => [Number(rd.externalTankId), rd]));
      const sampledAt = new Date().toISOString();
      for (const tankId of group.tankIds) {
        const tank = session.tanks.get(tankId);
        if (!tank) continue;
        const reading = byExternal.get(tank.externalTankId);
        if (!reading) continue;
        tank.tracker.clearError();
        const value = primaryValueFromReading(reading, session.measurementBasis);
        if (value == null) continue;
        tank.lastReading = {
          levelMm: reading.levelMm != null ? Number(reading.levelMm) : null,
          observedDensityKgM3:
            reading.observedDensityKgM3 != null ? Number(reading.observedDensityKgM3) : null,
          totalObservedVolume:
            reading.totalObservedVolume != null ? Number(reading.totalObservedVolume) : null,
          totalMass: reading.totalMass != null ? Number(reading.totalMass) : null,
          recordedAt: reading.recordedAt ?? sampledAt,
        };
        tank.tracker.addSample({
          value,
          temperatureC: reading.temperatureC != null ? Number(reading.temperatureC) : null,
          sampledAt,
        });
      }
    } catch (err) {
      session.consecutiveErrors += 1;
      const msg = err?.message || 'ATG poll failed';
      for (const tankId of group.tankIds) {
        const tank = session.tanks.get(tankId);
        if (tank && session.consecutiveErrors >= config.maxConsecutiveErrors) {
          tank.tracker.setError(msg);
        }
      }
    }
  }

  if (hadSuccess) {
    session.lastPollAt = new Date().toISOString();
  }
  session.updatedAt = Date.now();
}

function startPollLoop(session) {
  if (session.pollTimer) return;
  const tick = async () => {
    if (!session.active) return;
    await pollSessionOnce(session);
  };
  tick();
  session.pollTimer = setInterval(tick, config.pollIntervalMs);
  if (session.pollTimer.unref) session.pollTimer.unref();
}

function stopPollLoop(session) {
  if (session.pollTimer) {
    clearInterval(session.pollTimer);
    session.pollTimer = null;
  }
}

function destroySession(sessionId, reason = 'cancelled') {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.active = false;
  stopPollLoop(session);
  sessions.delete(sessionId);
  if (sessionIdByOperation.get(session.operationId) === sessionId) {
    sessionIdByOperation.delete(session.operationId);
  }
  session.destroyReason = reason;
  return true;
}

function buildAtgCaptured(session, tank, snapshot, source = 'live') {
  const base = {
    source,
    temperatureC: snapshot.temperatureC,
    levelMm: tank.lastReading?.levelMm ?? null,
    observedDensityKgM3: tank.lastReading?.observedDensityKgM3 ?? null,
    lockedAt: snapshot.lockedAt,
    stabilization: snapshot.stabilization,
    variancePct: snapshot.stabilization?.variancePct ?? null,
  };
  if (session.measurementBasis === 'mass') {
    return {
      ...base,
      massMt: snapshot.value,
      volumeKl:
        tank.lastReading?.totalObservedVolume != null
          ? observedVolumeToKl(tank.lastReading.totalObservedVolume)
          : null,
    };
  }
  return {
    ...base,
    massMt: tank.lastReading?.totalMass ?? null,
    volumeKl: snapshot.value,
  };
}

function buildManualCaptured(session, body) {
  const temperatureC = Number(body.temperatureC);
  if (!Number.isFinite(temperatureC)) {
    throw Object.assign(new Error('temperatureC is required for manual reading'), { statusCode: 400 });
  }
  const capturedAt =
    body.capturedAt && !Number.isNaN(new Date(body.capturedAt).getTime())
      ? new Date(body.capturedAt).toISOString()
      : new Date().toISOString();
  if (session.measurementBasis === 'volume') {
    const volumeKl = body.volumeKl != null ? Number(body.volumeKl) : null;
    if (volumeKl == null || !Number.isFinite(volumeKl)) {
      throw Object.assign(new Error('volumeKl is required for manual reading'), { statusCode: 400 });
    }
    return {
      massMt: body.massMt != null ? Number(body.massMt) : null,
      volumeKl,
      temperatureC,
      capturedAt,
    };
  }
  const massMt = body.massMt != null ? Number(body.massMt) : null;
  if (massMt == null || !Number.isFinite(massMt)) {
    throw Object.assign(new Error('massMt is required for manual reading'), { statusCode: 400 });
  }
  return {
    massMt,
    volumeKl: body.volumeKl != null ? Number(body.volumeKl) : null,
    temperatureC,
    capturedAt,
  };
}

function tankIsComplete(tank) {
  return Boolean(tank.manualCaptured && (tank.atgCaptured || tank.atgSkipped));
}

export function buildTankReadingRow(session, tank) {
  if (!tankIsComplete(tank)) return null;
  const manual = tank.manualCaptured;
  const atg = tank.atgCaptured;
  const timestamps = [tank.soundedAt, manual?.capturedAt, atg?.lockedAt].filter(Boolean);
  const lockedAt =
    timestamps.length > 0
      ? new Date(Math.max(...timestamps.map((t) => new Date(t).getTime()))).toISOString()
      : null;

  if (tank.atgSkipped || !atg) {
    return {
      tankId: tank.tankId,
      tankCode: tank.code,
      captureMode: 'manual',
      measurementBasis: session.measurementBasis,
      soundedAt: tank.soundedAt,
      atgSkipped: true,
      manual: {
        massMt: manual.massMt,
        volumeKl: manual.volumeKl,
        temperatureC: manual.temperatureC,
        capturedAt: manual.capturedAt,
      },
      lockedAt,
      atgSourceBaseUrl: tank.sourceBaseUrl,
      sessionId: session.sessionId,
    };
  }

  return {
    tankId: tank.tankId,
    tankCode: tank.code,
    captureMode: 'dual',
    measurementBasis: session.measurementBasis,
    soundedAt: tank.soundedAt,
    atgSkipped: false,
    atg: {
      massMt: atg.massMt,
      volumeKl: atg.volumeKl,
      temperatureC: atg.temperatureC,
      levelMm: atg.levelMm ?? null,
      observedDensityKgM3: atg.observedDensityKgM3 ?? null,
      lockedAt: atg.lockedAt,
      stabilization: atg.stabilization,
      variancePct: atg.variancePct ?? null,
      source: atg.source ?? 'live',
      sampleId: atg.sampleId ?? null,
      matchQuality: atg.matchQuality ?? null,
    },
    manual: {
      massMt: manual.massMt,
      volumeKl: manual.volumeKl,
      temperatureC: manual.temperatureC,
      capturedAt: manual.capturedAt,
    },
    lockedAt,
    atgSourceBaseUrl: tank.sourceBaseUrl,
    sessionId: session.sessionId,
  };
}

function tankToDto(session, tank) {
  const status = tank.tracker.getStatus();
  const isComplete = tankIsComplete(tank);
  const isLiveAtg = tank.captureMode === 'live' && !tank.atgCaptured && !tank.atgSkipped;
  return {
    tankId: String(tank.tankId),
    tankCode: tank.code,
    tankName: tank.name,
    sourceBaseUrl: tank.sourceBaseUrl,
    sourceHost: hostFromUrl(tank.sourceBaseUrl),
    soundedAt: tank.soundedAt,
    captureMode: tank.captureMode,
    isComplete,
    atgCaptured: tank.atgCaptured,
    atgSkipped: Boolean(tank.atgSkipped),
    manualCaptured: tank.manualCaptured,
    historicalLookup: tank.historicalLookup,
    manualMode: Boolean(tank.manualMode),
    state: isLiveAtg ? status.state : tank.atgCaptured ? 'locked' : tank.atgSkipped ? 'manual' : status.state,
    measurementBasis: session.measurementBasis,
    massMt:
      session.measurementBasis === 'mass'
        ? isLiveAtg
          ? status.latestValue
          : tank.atgCaptured?.massMt ?? null
        : tank.lastReading?.totalMass ?? tank.atgCaptured?.massMt ?? null,
    volumeKl:
      session.measurementBasis === 'volume'
        ? isLiveAtg
          ? status.latestValue
          : tank.atgCaptured?.volumeKl ?? null
        : tank.lastReading?.totalObservedVolume != null
          ? observedVolumeToKl(tank.lastReading.totalObservedVolume)
          : tank.atgCaptured?.volumeKl ?? null,
    temperatureC: isLiveAtg ? status.latestTemperatureC : tank.atgCaptured?.temperatureC ?? status.latestTemperatureC,
    levelMm: tank.lastReading?.levelMm ?? tank.atgCaptured?.levelMm ?? null,
    observedDensityKgM3: tank.lastReading?.observedDensityKgM3 ?? tank.atgCaptured?.observedDensityKgM3 ?? null,
    variancePct: status.variancePct,
    stableDurationSec: status.stableDurationSec,
    stableHoldSec: status.stableHoldSec,
    sampleCount: status.sampleCount,
    minSamples: status.minSamples,
    lastSampleAt: status.lastSampleAt,
    errorMessage: status.errorMessage,
    canCaptureAtg: isLiveAtg && status.state === 'stable',
    canLock: isLiveAtg && status.state === 'stable',
    canSkipAtg: !tank.atgCaptured && !tank.atgSkipped && !isComplete,
  };
}

function sessionToDto(session) {
  const tanks = [...session.tanks.values()].map((t) => tankToDto(session, t));
  const lockedCount = tanks.filter((t) => t.isComplete).length;
  return {
    sessionId: session.sessionId,
    operationId: String(session.operationId),
    portId: String(session.portId),
    siMetric: session.siMetric,
    measurementBasis: session.measurementBasis,
    active: session.active,
    pollIntervalMs: config.pollIntervalMs,
    liveWindowMs: config.liveWindowMs,
    expiresAt: new Date(session.expiresAt).toISOString(),
    lastPollAt: session.lastPollAt,
    tanks,
    lockedCount,
    totalTanks: tanks.length,
    consecutiveErrors: session.consecutiveErrors,
  };
}

function touchSession(session) {
  session.updatedAt = Date.now();
  session.expiresAt = Date.now() + config.sessionTtlMs;
}

async function initTankInSession(session, row, soundedAt) {
  const tank = createTankRecord(row, soundedAt);
  if (tank.captureMode === 'historical') {
    await applyHistoricalAtgToTank(session, tank);
  }
  session.tanks.set(tank.tankId, tank);
  return tank;
}

function maybeRemoveCompletedTank(session, tank) {
  if (!tankIsComplete(tank)) return false;
  session.tanks.delete(tank.tankId);
  if (session.tanks.size === 0) {
    stopPollLoop(session);
  }
  return true;
}

function getSessionOrThrow(sessionId) {
  const session = sessions.get(String(sessionId));
  if (!session) {
    throw Object.assign(new Error('Sounding session not found'), { statusCode: 404 });
  }
  if (Date.now() > session.expiresAt) {
    destroySession(String(sessionId), 'expired');
    throw Object.assign(new Error('Sounding session not found'), { statusCode: 404 });
  }
  touchSession(session);
  return session;
}

function getTankOrThrow(session, tankId) {
  const tank = session.tanks.get(Number(tankId));
  if (!tank) {
    throw Object.assign(new Error('Tank not in session'), { statusCode: 404 });
  }
  return tank;
}

export async function createSoundingSession(input) {
  startCleanupTimer();
  const operationId = Number(input.operationId);
  const portId = Number(input.portId);
  const tankIds = [...new Set((input.tankIds || []).map(Number).filter((n) => n > 0))];
  if (!operationId || !portId) {
    throw Object.assign(new Error('operationId and portId are required'), { statusCode: 400 });
  }

  const existingId = sessionIdByOperation.get(operationId);
  if (existingId && input.reuse !== false) {
    const existing = sessions.get(existingId);
    if (existing && existing.active && Date.now() <= existing.expiresAt) {
      touchSession(existing);
      if (tankIds.length) {
        for (const tankId of tankIds) {
          if (!existing.tanks.has(tankId)) {
            await addTankToSoundingSession(existingId, { tankId, soundedAt: input.soundedAt });
          }
        }
      }
      return sessionToDto(existing);
    }
  }

  if (existingId) destroySession(existingId, 'replaced');

  const siMetric = String(input.siMetric || 'MT').trim().toUpperCase() || 'MT';
  const measurementBasis = resolveAtgMeasurementBasis(siMetric);
  const sessionId = crypto.randomUUID();
  const now = Date.now();

  const session = {
    sessionId,
    operationId,
    portId,
    siMetric,
    measurementBasis,
    userId: input.userId ?? null,
    tanks: new Map(),
    active: true,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + config.sessionTtlMs,
    lastPollAt: null,
    consecutiveErrors: 0,
    pollTimer: null,
  };

  sessions.set(sessionId, session);
  sessionIdByOperation.set(operationId, sessionId);

  if (tankIds.length) {
    const rows = await loadTankMappings(pool, tankIds, portId);
    if (!rows.length) {
      throw Object.assign(new Error('No ATG-mapped tanks found for selection'), { statusCode: 400 });
    }
    for (const row of rows) {
      await initTankInSession(session, row, input.soundedAt);
    }
  }

  startPollLoop(session);
  return sessionToDto(session);
}

export async function addTankToSoundingSession(sessionId, input) {
  const session = getSessionOrThrow(sessionId);
  const tankId = Number(input.tankId);
  if (!Number.isFinite(tankId) || tankId <= 0) {
    throw Object.assign(new Error('tankId is required'), { statusCode: 400 });
  }
  if (session.tanks.has(tankId)) {
    throw Object.assign(new Error('Tank already in session'), { statusCode: 409 });
  }

  const rows = await loadTankMappings(pool, [tankId], session.portId);
  if (!rows.length) {
    throw Object.assign(new Error('Tank not ATG-mapped or not found'), { statusCode: 400 });
  }

  const tank = await initTankInSession(session, rows[0], input.soundedAt);
  startPollLoop(session);
  touchSession(session);
  return tankToDto(session, tank);
}

export function getSoundingSession(sessionId) {
  const session = sessions.get(String(sessionId));
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    destroySession(sessionId, 'expired');
    return null;
  }
  touchSession(session);
  return sessionToDto(session);
}

export function cancelSoundingSession(sessionId) {
  return destroySession(String(sessionId), 'cancelled');
}

export function lockSoundingTank(sessionId, tankId) {
  const session = getSessionOrThrow(sessionId);
  const tank = getTankOrThrow(session, tankId);
  if (tank.captureMode !== 'live') {
    throw Object.assign(new Error('Live ATG capture is not available for historical sounding time'), {
      statusCode: 409,
    });
  }
  const snapshot = tank.tracker.buildStableSnapshot({ captureMode: 'auto' });
  tank.atgCaptured = buildAtgCaptured(session, tank, snapshot, 'live');
  tank.atgSkipped = false;
  touchSession(session);
  const dto = tankToDto(session, tank);
  maybeRemoveCompletedTank(session, tank);
  return dto;
}

export function skipAtgSoundingTank(sessionId, tankId) {
  const session = getSessionOrThrow(sessionId);
  const tank = getTankOrThrow(session, tankId);
  if (tank.atgCaptured) {
    throw Object.assign(new Error('ATG already captured for this tank'), { statusCode: 409 });
  }
  tank.atgSkipped = true;
  tank.atgCaptured = null;
  touchSession(session);
  const dto = tankToDto(session, tank);
  maybeRemoveCompletedTank(session, tank);
  return dto;
}

export function unlockSoundingTank(sessionId, tankId) {
  const session = getSessionOrThrow(sessionId);
  const tank = getTankOrThrow(session, tankId);
  tank.manualMode = false;
  tank.atgCaptured = null;
  tank.atgSkipped = false;
  tank.manualCaptured = null;
  tank.historicalLookup = null;
  tank.captureMode = resolveTankCaptureMode(tank.soundedAt);
  tank.tracker.unlock();
  touchSession(session);
  return tankToDto(session, tank);
}

export function setSoundingTankManualMode(sessionId, tankId, enabled) {
  const session = getSessionOrThrow(sessionId);
  const tank = getTankOrThrow(session, tankId);
  tank.manualMode = Boolean(enabled);
  if (tank.manualMode) {
    tank.tracker.unlock();
  }
  touchSession(session);
  return tankToDto(session, tank);
}

export function confirmManualSoundingReading(sessionId, tankId, body) {
  const session = getSessionOrThrow(sessionId);
  const tank = getTankOrThrow(session, tankId);
  if (!tank.atgCaptured && !tank.atgSkipped && tank.captureMode === 'live') {
    throw Object.assign(new Error('Capture or skip ATG before saving manual reading'), {
      statusCode: 409,
    });
  }
  if (!tank.atgCaptured && !tank.atgSkipped && tank.captureMode === 'historical') {
    throw Object.assign(new Error('Historical ATG unavailable — skip ATG or pick another time'), {
      statusCode: 409,
    });
  }
  tank.manualCaptured = buildManualCaptured(session, {
    ...body,
    capturedAt: body.capturedAt ?? tank.soundedAt,
  });
  tank.manualMode = false;
  touchSession(session);
  const dto = tankToDto(session, tank);
  maybeRemoveCompletedTank(session, tank);
  return dto;
}

export function buildTankReadingsFromSession(sessionId) {
  const session = sessions.get(String(sessionId));
  if (!session) return [];
  const out = [];
  for (const tank of session.tanks.values()) {
    const row = buildTankReadingRow(session, tank);
    if (row) out.push(row);
  }
  return out;
}

export function _resetSoundingSessionsForTests() {
  for (const id of [...sessions.keys()]) {
    destroySession(id, 'test_reset');
  }
}
