/**
 * Management Dashboard "Hours by rate": how a voyage's operational hours split by hourly cargo rate.
 * Operational window = first cargo start → last cargo end (same window as the Achieved rate).
 * Hours inside the window with no cargo movement count as "zero" (no flow).
 */

import {
  cargoWindowFromLines,
  loadOperationProgressContext,
} from './operational-progress.js';
import { getHourlyOperationalProgress } from './atg-hourly-progress.js';
import { contributingCargoLines } from './management-dashboard-cargo-rate.js';

const HOUR_MS = 3600000;

/** Upper bound inclusive: exactly 100 MT/h is "75_100", 100.1 is "gt100". */
export const RATE_BANDS = [
  { key: 'gt100', min: 100 },
  { key: '75_100', min: 75 },
  { key: '50_75', min: 50 },
  { key: '25_50', min: 25 },
  { key: '0_25', min: 0 },
];

export const BAND_KEYS = [...RATE_BANDS.map((b) => b.key), 'zero'];

const EXCLUDED_STATUSES = new Set(['incomplete', 'direction_mismatch']);

/** @param {number} rate MT/h */
export function bandForRate(rate) {
  if (!(rate > 0)) return 'zero';
  return RATE_BANDS.find((b) => rate > b.min)?.key ?? '0_25';
}

function emptyBands() {
  return Object.fromEntries(BAND_KEYS.map((k) => [k, 0]));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Group buckets by clock hour (lines can start mid-hour), summing moved qty.
 * @param {Array<object>} buckets merged hourly buckets from the hourly engine
 */
function groupByClockHour(buckets) {
  const byHour = new Map();
  for (const b of buckets || []) {
    const s = new Date(b.hourStart).getTime();
    const e = new Date(b.hourEnd).getTime();
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
    const key = Math.floor(s / HOUR_MS) * HOUR_MS;
    const cur = byHour.get(key) || { start: s, end: e, qty: 0, active: false, excluded: false };
    cur.start = Math.min(cur.start, s);
    cur.end = Math.max(cur.end, e);
    cur.qty += Math.abs(Number(b.displayQtyMoved ?? b.qtyMoved) || 0);
    if (b.movementStatus === 'active') cur.active = true;
    if (EXCLUDED_STATUSES.has(b.movementStatus) || b.directionMismatch) cur.excluded = true;
    byHour.set(key, cur);
  }
  return byHour;
}

/**
 * @param {Array<object>} buckets hourly buckets (hourStart, hourEnd, qtyMoved/displayQtyMoved, movementStatus)
 * @param {{ windowStartMs?: number, windowEndMs?: number }} [window] operational window
 * @returns {null | { bands: Record<string, number>, totalHours: number, excludedHours: number, series: Array<{ t: string, r: number | null }> }}
 */
export function buildHourlyRateProfile(buckets, window = {}) {
  const byHour = groupByClockHour(buckets);
  if (!byHour.size) return null;

  const bands = emptyBands();
  let excludedHours = 0;
  const rateByHour = new Map();

  for (const [key, h] of byHour) {
    const hours = (h.end - h.start) / HOUR_MS;
    if (h.excluded) {
      excludedHours += hours;
      rateByHour.set(key, null);
      continue;
    }
    const rate = h.active ? h.qty / hours : 0;
    bands[bandForRate(rate)] += hours;
    rateByHour.set(key, rate);
  }

  const keys = [...byHour.keys()].sort((a, b) => a - b);
  const lastEnd = Math.max(...[...byHour.values()].map((h) => h.end));
  const startMs = Number.isFinite(window.windowStartMs) ? Math.min(window.windowStartMs, keys[0]) : keys[0];
  const endMs = Number.isFinite(window.windowEndMs) ? Math.max(window.windowEndMs, lastEnd) : lastEnd;

  const counted = BAND_KEYS.reduce((s, k) => s + bands[k], 0) + excludedHours;
  const windowHours = (endMs - startMs) / HOUR_MS;
  if (windowHours > counted) bands.zero += windowHours - counted;

  const series = [];
  for (let t = Math.floor(startMs / HOUR_MS) * HOUR_MS; t < endMs; t += HOUR_MS) {
    const r = rateByHour.has(t) ? rateByHour.get(t) : 0;
    series.push({ t: new Date(t).toISOString(), r: r == null ? null : Math.round(r * 10) / 10 });
  }

  for (const k of BAND_KEYS) bands[k] = round2(bands[k]);
  return {
    bands,
    totalHours: round2(BAND_KEYS.reduce((s, k) => s + bands[k], 0)),
    excludedHours: round2(excludedHours),
    series,
  };
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {number} operationId
 * @param {{ nowMs?: number }} [opts]
 */
export async function computeHourlyRateProfile(db, operationId, opts = {}) {
  const ctx = await loadOperationProgressContext(db, operationId);
  if (!ctx) return null;
  const lines = contributingCargoLines(ctx.lines);
  if (!lines.length) return null;

  const hourly = await getHourlyOperationalProgress(db, ctx);
  const { firstLoggedAt, lastLoggedAt } = cargoWindowFromLines(lines);
  const live = lines.some((l) => !l.endedAt);
  const windowEndMs = live ? opts.nowMs ?? Date.now() : new Date(lastLoggedAt).getTime();
  const profile = buildHourlyRateProfile(hourly.hourlyBuckets, {
    windowStartMs: new Date(firstLoggedAt).getTime(),
    windowEndMs,
  });
  if (!profile) return null;
  const sources = new Set(hourly.hourlyBuckets.map((b) => b.source).filter(Boolean));
  return { ...profile, source: sources.size > 1 ? 'hybrid' : [...sources][0] ?? null };
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {Array<number|string>} operationIds
 * @param {{ concurrency?: number, nowMs?: number }} [opts]
 */
export async function computeHourlyRateProfilesBulk(db, operationIds, opts = {}) {
  const concurrency = opts.concurrency ?? 4;
  const ids = [...new Set((operationIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  const profiles = {};
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = ids.slice(i, i + concurrency);
    const pairs = await Promise.all(
      batch.map(async (id) => {
        try {
          return [String(id), await computeHourlyRateProfile(db, id, opts)];
        } catch (err) {
          console.error('[management-hourly-rates]', id, err?.message || err);
          return [String(id), null];
        }
      })
    );
    for (const [id, p] of pairs) profiles[id] = p;
  }
  return { profiles };
}
