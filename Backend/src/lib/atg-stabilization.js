/**
 * Bathroom-scale stabilization for ATG sounding sessions.
 * Rolling window variance on primary metric (mass MT or volume KL).
 */

export const STABILIZATION_STATES = new Set([
  'calibrating',
  'fluctuating',
  'stable',
  'locked',
  'manual',
  'error',
]);

/**
 * @returns {{
 *   pollIntervalMs: number,
 *   windowSec: number,
 *   stableThresholdPct: number,
 *   stableHoldSec: number,
 *   minSamples: number,
 *   sessionTtlMs: number,
 *   maxConsecutiveErrors: number,
 * }}
 */
export function resolveSoundingStabilizationConfig() {
  return {
    pollIntervalMs: Math.max(500, Number(process.env.SOUNDING_POLL_INTERVAL_MS ?? 2000) || 2000),
    windowSec: Math.max(1, Number(process.env.SOUNDING_WINDOW_SEC ?? 10) || 10),
    stableThresholdPct: Math.max(0, Number(process.env.SOUNDING_STABLE_THRESHOLD_PCT ?? 0.5) || 0.5),
    stableHoldSec: Math.max(1, Number(process.env.SOUNDING_STABLE_HOLD_SEC ?? 5) || 5),
    minSamples: Math.max(2, Number(process.env.SOUNDING_MIN_SAMPLES ?? 5) || 5),
    sessionTtlMs: Math.max(60_000, Number(process.env.SOUNDING_SESSION_TTL_MS ?? 30 * 60 * 1000) || 30 * 60 * 1000),
    maxConsecutiveErrors: Math.max(1, Number(process.env.SOUNDING_MAX_ATG_ERRORS ?? 3) || 3),
    liveWindowMs: Math.max(60_000, Number(process.env.SOUNDING_LIVE_WINDOW_MS ?? 5 * 60 * 1000) || 5 * 60 * 1000),
  };
}

/**
 * @param {Array<{ value: number|null, sampledAt: string|number|Date }>} samples
 * @param {number} windowSec
 * @param {string|number|Date} now
 */
export function pruneSamplesByWindow(samples, windowSec, now = Date.now()) {
  const cutoff = new Date(now).getTime() - windowSec * 1000;
  return samples.filter((s) => {
    const t = new Date(s.sampledAt).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
}

/**
 * @param {number[]} values
 */
export function computeWindowStats(values) {
  const nums = values.filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
  if (!nums.length) {
    return { mean: null, maxDev: null, variancePct: null };
  }
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  let maxDev = 0;
  for (const v of nums) {
    maxDev = Math.max(maxDev, Math.abs(v - mean));
  }
  const denom = Math.abs(mean);
  const variancePct = denom > 1e-9 ? (maxDev / denom) * 100 : maxDev > 0 ? 100 : 0;
  return { mean, maxDev, variancePct };
}

/**
 * @param {Array<{ value: number|null, temperatureC: number|null, sampledAt: string|number|Date }>} samples
 */
export function meanTemperature(samples) {
  const temps = samples
    .map((s) => (s.temperatureC != null ? Number(s.temperatureC) : null))
    .filter((t) => t != null && Number.isFinite(t));
  if (!temps.length) return null;
  return temps.reduce((a, b) => a + b, 0) / temps.length;
}

export class TankStabilizationTracker {
  /**
   * @param {{ windowSec?: number, stableThresholdPct?: number, stableHoldSec?: number, minSamples?: number }} [config]
   */
  constructor(config = {}) {
    const defaults = resolveSoundingStabilizationConfig();
    this.windowSec = config.windowSec ?? defaults.windowSec;
    this.stableThresholdPct = config.stableThresholdPct ?? defaults.stableThresholdPct;
    this.stableHoldSec = config.stableHoldSec ?? defaults.stableHoldSec;
    this.minSamples = config.minSamples ?? defaults.minSamples;
    /** @type {Array<{ value: number, temperatureC: number|null, sampledAt: string }>} */
    this.samples = [];
    this.stableSince = null;
    this.state = 'calibrating';
    /** @type {object|null} */
    this.lockedSnapshot = null;
    this.errorMessage = null;
    this.lastSampleAt = null;
    this.latestValue = null;
    this.latestTemperatureC = null;
  }

  /**
   * @param {{ value: number|null, temperatureC?: number|null, sampledAt?: string|Date }} sample
   */
  addSample(sample) {
    if (this.state === 'locked' || this.state === 'manual') {
      return this.getStatus();
    }
    if (this.state === 'error') {
      return this.getStatus();
    }

    const value = sample.value != null ? Number(sample.value) : null;
    if (value == null || !Number.isFinite(value)) {
      return this.getStatus();
    }

    const sampledAt =
      sample.sampledAt instanceof Date
        ? sample.sampledAt.toISOString()
        : sample.sampledAt
          ? new Date(sample.sampledAt).toISOString()
          : new Date().toISOString();

    const temperatureC =
      sample.temperatureC != null && Number.isFinite(Number(sample.temperatureC))
        ? Number(sample.temperatureC)
        : null;

    this.samples.push({ value, temperatureC, sampledAt });
    this.samples = pruneSamplesByWindow(this.samples, this.windowSec, sampledAt);
    this.lastSampleAt = sampledAt;
    this.latestValue = value;
    this.latestTemperatureC = temperatureC;

    this._evaluateState(sampledAt);
    return this.getStatus();
  }

  /**
   * @param {string} sampledAtIso
   */
  _evaluateState(sampledAtIso) {
    if (this.samples.length < this.minSamples) {
      this.state = 'calibrating';
      this.stableSince = null;
      return;
    }

    const { mean, variancePct } = computeWindowStats(this.samples.map((s) => s.value));
    if (mean == null || variancePct == null) {
      this.state = 'calibrating';
      this.stableSince = null;
      return;
    }

    if (variancePct <= this.stableThresholdPct) {
      if (!this.stableSince) {
        this.stableSince = sampledAtIso;
      }
      const holdMs =
        new Date(sampledAtIso).getTime() - new Date(this.stableSince).getTime();
      this.state = holdMs >= this.stableHoldSec * 1000 ? 'stable' : 'fluctuating';
    } else {
      this.stableSince = null;
      this.state = 'fluctuating';
    }
  }

  setError(message) {
    if (this.state === 'locked' || this.state === 'manual') return this.getStatus();
    this.state = 'error';
    this.errorMessage = message || 'ATG error';
    this.stableSince = null;
    return this.getStatus();
  }

  clearError() {
    if (this.state !== 'error') return this.getStatus();
    this.state = 'calibrating';
    this.errorMessage = null;
    this.stableSince = null;
    return this.getStatus();
  }

  /**
   * Build stable reading snapshot without locking the tracker (ATG can keep polling).
   */
  buildStableSnapshot(extras = {}) {
    if (this.state !== 'stable') {
      throw Object.assign(new Error('Reading is not stable yet'), { statusCode: 409 });
    }
    const { mean, variancePct } = computeWindowStats(this.samples.map((s) => s.value));
    const temperatureC = meanTemperature(this.samples);
    const lockedAt = new Date().toISOString();
    return {
      value: mean,
      temperatureC,
      lockedAt,
      stabilization: {
        state: 'locked',
        variancePct: variancePct != null ? Number(variancePct.toFixed(4)) : null,
        stableDurationSec: this.stableHoldSec,
        sampleCount: this.samples.length,
        thresholdPct: this.stableThresholdPct,
      },
      ...extras,
    };
  }

  /**
   * Lock stabilized auto reading.
   * @param {object} extras
   */
  lock(extras = {}) {
    this.lockedSnapshot = this.buildStableSnapshot(extras);
    this.state = 'locked';
    return this.lockedSnapshot;
  }

  /**
   * @param {{ massMt?: number|null, volumeKl?: number|null, temperatureC: number, measurementBasis: 'mass'|'volume' }} input
   */
  setManual(input) {
    const temperatureC = Number(input.temperatureC);
    if (!Number.isFinite(temperatureC)) {
      throw Object.assign(new Error('temperatureC is required for manual reading'), { statusCode: 400 });
    }
    const lockedAt = new Date().toISOString();
    let value = null;
    if (input.measurementBasis === 'volume') {
      value = input.volumeKl != null ? Number(input.volumeKl) : null;
      if (value == null || !Number.isFinite(value)) {
        throw Object.assign(new Error('volumeKl is required for manual reading'), { statusCode: 400 });
      }
    } else {
      value = input.massMt != null ? Number(input.massMt) : null;
      if (value == null || !Number.isFinite(value)) {
        throw Object.assign(new Error('massMt is required for manual reading'), { statusCode: 400 });
      }
    }
    this.lockedSnapshot = {
      value,
      massMt: input.measurementBasis === 'mass' ? value : input.massMt ?? null,
      volumeKl: input.measurementBasis === 'volume' ? value : input.volumeKl ?? null,
      temperatureC,
      lockedAt,
      captureMode: 'manual',
      stabilization: { state: 'manual' },
    };
    this.state = 'manual';
    this.samples = [];
    this.stableSince = null;
    return this.lockedSnapshot;
  }

  unlock() {
    if (this.state !== 'locked' && this.state !== 'manual') {
      return this.getStatus();
    }
    this.state = 'calibrating';
    this.lockedSnapshot = null;
    this.samples = [];
    this.stableSince = null;
    this.errorMessage = null;
    return this.getStatus();
  }

  getStatus() {
    const { mean, variancePct } = computeWindowStats(this.samples.map((s) => s.value));
    let stableDurationSec = 0;
    if (this.stableSince && this.lastSampleAt) {
      stableDurationSec = Math.max(
        0,
        (new Date(this.lastSampleAt).getTime() - new Date(this.stableSince).getTime()) / 1000
      );
    }
    return {
      state: this.state,
      latestValue: this.latestValue,
      latestTemperatureC: this.latestTemperatureC,
      windowMean: mean,
      variancePct: variancePct != null ? Number(variancePct.toFixed(4)) : null,
      stableDurationSec: Number(stableDurationSec.toFixed(1)),
      stableHoldSec: this.stableHoldSec,
      sampleCount: this.samples.length,
      minSamples: this.minSamples,
      lastSampleAt: this.lastSampleAt,
      errorMessage: this.errorMessage,
      locked: this.lockedSnapshot,
    };
  }
}
