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

/**
 * @param {import('pg').Pool} db
 * @param {number[]} tankIds
 * @param {number} portId
 */
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

/**
 * @param {object} session
 */
async function pollSessionOnce(session) {
  if (!session.active) return;
  const sources = await resolveEnabledSources(pool, { portId: session.portId });
  const authByBase = new Map(sources.map((s) => [trimBaseUrl(s.baseUrl), s.auth]));

  /** @type {Map<string, { externalIds: number[], tankIds: number[] }>} */
  const groups = new Map();
  for (const tank of session.tanks.values()) {
    if (tank.atgCaptured) continue;
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
          temperatureC:
            reading.temperatureC != null ? Number(reading.temperatureC) : null,
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

function buildAtgCaptured(session, tank, snapshot) {
  if (session.measurementBasis === 'mass') {
    return {
      massMt: snapshot.value,
      volumeKl:
        tank.lastReading?.totalObservedVolume != null
          ? observedVolumeToKl(tank.lastReading.totalObservedVolume)
          : null,
      temperatureC: snapshot.temperatureC,
      levelMm: tank.lastReading?.levelMm ?? null,
      observedDensityKgM3: tank.lastReading?.observedDensityKgM3 ?? null,
      lockedAt: snapshot.lockedAt,
      stabilization: snapshot.stabilization,
      variancePct: snapshot.stabilization?.variancePct ?? null,
    };
  }
  return {
    massMt: tank.lastReading?.totalMass ?? null,
    volumeKl: snapshot.value,
    temperatureC: snapshot.temperatureC,
    levelMm: tank.lastReading?.levelMm ?? null,
    observedDensityKgM3: tank.lastReading?.observedDensityKgM3 ?? null,
    lockedAt: snapshot.lockedAt,
    stabilization: snapshot.stabilization,
    variancePct: snapshot.stabilization?.variancePct ?? null,
  };
}

function buildManualCaptured(session, body) {
  const temperatureC = Number(body.temperatureC);
  if (!Number.isFinite(temperatureC)) {
    throw Object.assign(new Error('temperatureC is required for manual reading'), { statusCode: 400 });
  }
  const capturedAt = new Date().toISOString();
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
  return Boolean(tank.atgCaptured && tank.manualCaptured);
}

function tankToDto(session, tank) {
  const status = tank.tracker.getStatus();
  const isComplete = tankIsComplete(tank);
  return {
    tankId: String(tank.tankId),
    tankCode: tank.code,
    tankName: tank.name,
    sourceBaseUrl: tank.sourceBaseUrl,
    sourceHost: hostFromUrl(tank.sourceBaseUrl),
    isComplete,
    atgCaptured: tank.atgCaptured,
    manualCaptured: tank.manualCaptured,
    manualMode: Boolean(tank.manualMode),
    state: status.state,
    measurementBasis: session.measurementBasis,
    massMt:
      session.measurementBasis === 'mass'
        ? status.latestValue
        : tank.lastReading?.totalMass ?? null,
    volumeKl:
      session.measurementBasis === 'volume'
        ? status.latestValue
        : tank.lastReading?.totalObservedVolume != null
          ? observedVolumeToKl(tank.lastReading.totalObservedVolume)
          : null,
    temperatureC: status.latestTemperatureC,
    levelMm: tank.lastReading?.levelMm ?? null,
    observedDensityKgM3: tank.lastReading?.observedDensityKgM3 ?? null,
    variancePct: status.variancePct,
    stableDurationSec: status.stableDurationSec,
    stableHoldSec: status.stableHoldSec,
    sampleCount: status.sampleCount,
    minSamples: status.minSamples,
    lastSampleAt: status.lastSampleAt,
    errorMessage: status.errorMessage,
    canCaptureAtg: status.state === 'stable',
    canLock: status.state === 'stable',
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
    expiresAt: new Date(session.expiresAt).toISOString(),
    lastPollAt: session.lastPollAt,
    tanks,
    lockedCount,
    totalTanks: tanks.length,
    consecutiveErrors: session.consecutiveErrors,
  };
}

/**
 * @param {{ operationId: number, portId: number, tankIds: number[], siMetric?: string, userId?: number|null }} input
 */
export async function createSoundingSession(input) {
  startCleanupTimer();
  const operationId = Number(input.operationId);
  const portId = Number(input.portId);
  const tankIds = [...new Set((input.tankIds || []).map(Number).filter((n) => n > 0))];
  if (!operationId || !portId || !tankIds.length) {
    throw Object.assign(new Error('operationId, portId, and tankIds are required'), { statusCode: 400 });
  }

  const existingId = sessionIdByOperation.get(operationId);
  if (existingId) destroySession(existingId, 'replaced');

  const rows = await loadTankMappings(pool, tankIds, portId);
  if (!rows.length) {
    throw Object.assign(new Error('No ATG-mapped tanks found for selection'), { statusCode: 400 });
  }

  const foundIds = new Set(rows.map((r) => Number(r.tank_id)));
  const missing = tankIds.filter((id) => !foundIds.has(id));
  if (missing.length) {
    throw Object.assign(
      new Error(`Tanks not ATG-mapped or not found: ${missing.join(', ')}`),
      { statusCode: 400 }
    );
  }

  const siMetric = String(input.siMetric || 'MT').trim().toUpperCase() || 'MT';
  const measurementBasis = resolveAtgMeasurementBasis(siMetric);
  const sessionId = crypto.randomUUID();
  const now = Date.now();

  /** @type {Map<number, object>} */
  const tanks = new Map();
  for (const row of rows) {
    tanks.set(Number(row.tank_id), {
      tankId: Number(row.tank_id),
      code: row.code,
      name: row.name,
      externalTankId: Number(row.external_tank_id),
      sourceBaseUrl: row.source_base_url,
      sourceUnitName: row.source_unit_name,
      manualMode: false,
      atgCaptured: null,
      manualCaptured: null,
      lastReading: null,
      tracker: new TankStabilizationTracker({
        windowSec: config.windowSec,
        stableThresholdPct: config.stableThresholdPct,
        stableHoldSec: config.stableHoldSec,
        minSamples: config.minSamples,
      }),
    });
  }

  const session = {
    sessionId,
    operationId,
    portId,
    siMetric,
    measurementBasis,
    userId: input.userId ?? null,
    tanks,
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
  startPollLoop(session);

  return sessionToDto(session);
}

export function getSoundingSession(sessionId) {
  const session = sessions.get(String(sessionId));
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    destroySession(sessionId, 'expired');
    return null;
  }
  session.updatedAt = Date.now();
  return sessionToDto(session);
}

export function cancelSoundingSession(sessionId) {
  return destroySession(String(sessionId), 'cancelled');
}

export function lockSoundingTank(sessionId, tankId) {
  const session = sessions.get(String(sessionId));
  if (!session) {
    throw Object.assign(new Error('Sounding session not found'), { statusCode: 404 });
  }
  const tank = session.tanks.get(Number(tankId));
  if (!tank) {
    throw Object.assign(new Error('Tank not in session'), { statusCode: 404 });
  }
  const snapshot = tank.tracker.buildStableSnapshot({ captureMode: 'auto' });
  tank.atgCaptured = buildAtgCaptured(session, tank, snapshot);
  session.updatedAt = Date.now();
  return tankToDto(session, tank);
}

export function unlockSoundingTank(sessionId, tankId) {
  const session = sessions.get(String(sessionId));
  if (!session) {
    throw Object.assign(new Error('Sounding session not found'), { statusCode: 404 });
  }
  const tank = session.tanks.get(Number(tankId));
  if (!tank) {
    throw Object.assign(new Error('Tank not in session'), { statusCode: 404 });
  }
  tank.manualMode = false;
  tank.atgCaptured = null;
  tank.manualCaptured = null;
  tank.tracker.unlock();
  session.updatedAt = Date.now();
  return tankToDto(session, tank);
}

export function setSoundingTankManualMode(sessionId, tankId, enabled) {
  const session = sessions.get(String(sessionId));
  if (!session) {
    throw Object.assign(new Error('Sounding session not found'), { statusCode: 404 });
  }
  const tank = session.tanks.get(Number(tankId));
  if (!tank) {
    throw Object.assign(new Error('Tank not in session'), { statusCode: 404 });
  }
  tank.manualMode = Boolean(enabled);
  if (tank.manualMode) {
    tank.tracker.unlock();
  }
  session.updatedAt = Date.now();
  return tankToDto(session, tank);
}

/**
 * @param {number} tankId
 * @param {{ massMt?: number, volumeKl?: number, temperatureC: number }} body
 */
export function confirmManualSoundingReading(sessionId, tankId, body) {
  const session = sessions.get(String(sessionId));
  if (!session) {
    throw Object.assign(new Error('Sounding session not found'), { statusCode: 404 });
  }
  const tank = session.tanks.get(Number(tankId));
  if (!tank) {
    throw Object.assign(new Error('Tank not in session'), { statusCode: 404 });
  }
  tank.manualCaptured = buildManualCaptured(session, body);
  tank.manualMode = false;
  session.updatedAt = Date.now();
  return tankToDto(session, tank);
}

/** Build persisted tankReadings array from session locked tanks. */
export function buildTankReadingsFromSession(sessionId) {
  const session = sessions.get(String(sessionId));
  if (!session) return [];
  const out = [];
  for (const tank of session.tanks.values()) {
    if (!tankIsComplete(tank)) continue;
    const atg = tank.atgCaptured;
    const manual = tank.manualCaptured;
    const lockedAt =
      atg?.lockedAt && manual?.capturedAt
        ? new Date(
            Math.max(new Date(atg.lockedAt).getTime(), new Date(manual.capturedAt).getTime())
          ).toISOString()
        : atg?.lockedAt ?? manual?.capturedAt ?? null;
    out.push({
      tankId: tank.tankId,
      tankCode: tank.code,
      captureMode: 'dual',
      measurementBasis: session.measurementBasis,
      atg: {
        massMt: atg.massMt,
        volumeKl: atg.volumeKl,
        temperatureC: atg.temperatureC,
        levelMm: atg.levelMm ?? null,
        observedDensityKgM3: atg.observedDensityKgM3 ?? null,
        lockedAt: atg.lockedAt,
        stabilization: atg.stabilization,
        variancePct: atg.variancePct ?? null,
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
    });
  }
  return out;
}

/** Test hook — clear all sessions. */
export function _resetSoundingSessionsForTests() {
  for (const id of [...sessions.keys()]) {
    destroySession(id, 'test_reset');
  }
}
