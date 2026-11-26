/**
 * ATG source reading coverage: which 30-minute blocks of the last 24 h have stored samples,
 * which gaps remain, and which stretches were filled in from the Tankvision archive.
 */
import { gapsFromSampleTimeline } from './atg-cargo-gap-detect.js';
import { trimBaseUrl } from './tankvision-client.js';

export const COVERAGE_HOURS = 24;
export const COVERAGE_BLOCK_MS = 30 * 60 * 1000;
/** Polls run every 15 min, so 45 min means three missed polls (one slow poll is not a gap). */
export const DEFAULT_SOURCE_SILENT_MS = 45 * 60 * 1000;

export const BLOCK_LIVE = 'l';
export const BLOCK_RECOVERED = 'r';
export const BLOCK_MISSING = 'm';

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
export function resolveSourceSilentMs(env = process.env) {
  const minutes = Number(env.ATG_SOURCE_SILENT_MINUTES);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60000 : DEFAULT_SOURCE_SILENT_MS;
}

/**
 * One char per block, oldest first: l = live sample, r = only archive-recovered samples, m = none.
 * @param {Array<{ sampledAt: string|Date, origin?: string }>} samples
 * @param {number} nowMs
 * @param {{ hours?: number, blockMs?: number }} [opts]
 * @returns {string}
 */
export function buildCoverageBlocks(samples, nowMs, opts = {}) {
  const blockMs = opts.blockMs ?? COVERAGE_BLOCK_MS;
  const count = Math.round(((opts.hours ?? COVERAGE_HOURS) * 3600000) / blockMs);
  const startMs = nowMs - count * blockMs;
  const live = new Array(count).fill(false);
  const recovered = new Array(count).fill(false);

  for (const s of samples || []) {
    const t = new Date(s.sampledAt).getTime();
    if (!Number.isFinite(t) || t < startMs || t > nowMs) continue;
    const idx = Math.min(count - 1, Math.floor((t - startMs) / blockMs));
    if (s.origin && s.origin !== 'live') recovered[idx] = true;
    else live[idx] = true;
  }

  return live
    .map((isLive, i) => (isLive ? BLOCK_LIVE : recovered[i] ? BLOCK_RECOVERED : BLOCK_MISSING))
    .join('');
}

/**
 * Contiguous recovered blocks as time ranges.
 * @param {string} blocks
 * @param {number} nowMs
 * @param {number} [blockMs]
 * @returns {Array<{ startAt: string, endAt: string, blocks: number }>}
 */
export function recoveredRangesFromBlocks(blocks, nowMs, blockMs = COVERAGE_BLOCK_MS) {
  const startMs = nowMs - blocks.length * blockMs;
  const ranges = [];
  let runStart = -1;
  for (let i = 0; i <= blocks.length; i++) {
    const isRecovered = i < blocks.length && blocks[i] === BLOCK_RECOVERED;
    if (isRecovered && runStart < 0) runStart = i;
    if (!isRecovered && runStart >= 0) {
      ranges.push({
        startAt: new Date(startMs + runStart * blockMs).toISOString(),
        endAt: new Date(startMs + i * blockMs).toISOString(),
        blocks: i - runStart,
      });
      runStart = -1;
    }
  }
  return ranges;
}

/**
 * @param {Array<{ sampledAt: string|Date, origin?: string }>} samples
 * @param {{ nowMs?: number, hours?: number, blockMs?: number, silentMs?: number }} [opts]
 */
export function summarizeSourceCoverage(samples, opts = {}) {
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const hours = opts.hours ?? COVERAGE_HOURS;
  const blockMs = opts.blockMs ?? COVERAGE_BLOCK_MS;
  const silentMs = opts.silentMs ?? DEFAULT_SOURCE_SILENT_MS;
  const windowStartMs = nowMs - hours * 3600000;

  const times = (samples || [])
    .map((s) => new Date(s.sampledAt).getTime())
    .filter((t) => Number.isFinite(t) && t >= windowStartMs && t <= nowMs)
    .sort((a, b) => a - b);
  const lastMs = times.length ? times[times.length - 1] : null;
  // Recovered samples fill gaps but must not hide a poller that has stopped.
  const liveTimes = (samples || [])
    .filter((s) => !s.origin || s.origin === 'live')
    .map((s) => new Date(s.sampledAt).getTime())
    .filter((t) => Number.isFinite(t) && t >= windowStartMs && t <= nowMs);
  const lastLiveMs = liveTimes.length ? Math.max(...liveTimes) : null;
  const silentNow = lastLiveMs == null || nowMs - lastLiveMs > silentMs;

  const nowIso = new Date(nowMs).toISOString();
  const gaps = gapsFromSampleTimeline(
    times.map((t) => new Date(t).toISOString()),
    windowStartMs,
    nowMs,
    silentMs
  ).map((g) => ({ ...g, ongoing: g.endAt === nowIso }));

  const blocks = buildCoverageBlocks(samples, nowMs, { hours, blockMs });
  const recoveredRanges = recoveredRangesFromBlocks(blocks, nowMs, blockMs);

  let status = 'live';
  if (silentNow) status = 'silent';
  else if (gaps.length) status = 'gap';
  else if (recoveredRanges.length) status = 'recovered';

  return {
    status,
    blocks,
    lastSampleAt: lastMs == null ? null : new Date(lastMs).toISOString(),
    silentMinutes: lastLiveMs == null ? null : Math.max(0, Math.floor((nowMs - lastLiveMs) / 60000)),
    silentNow,
    gaps,
    recoveredRanges,
  };
}

/**
 * Distinct sample times per source (one per poll) since `sinceMs`.
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string[]} baseUrls
 * @param {number} sinceMs
 * @returns {Promise<Map<string, Array<{ sampledAt: Date, origin: string }>>>}
 */
export async function loadSourceSampleTimes(db, baseUrls, sinceMs) {
  const urls = [...new Set((baseUrls || []).filter(Boolean).map(trimBaseUrl))];
  const bySource = new Map(urls.map((u) => [u, []]));
  if (!urls.length) return bySource;

  const r = await db.query(
    `SELECT source_base_url, sampled_at,
            CASE WHEN bool_or(origin = 'live') THEN 'live' ELSE 'archive-backfill' END AS origin
     FROM tank_gauging_samples
     WHERE source_base_url = ANY($1::text[]) AND sampled_at >= $2::timestamptz
     GROUP BY source_base_url, sampled_at
     ORDER BY sampled_at`,
    [urls, new Date(sinceMs).toISOString()]
  );
  for (const row of r.rows) {
    const list = bySource.get(trimBaseUrl(row.source_base_url));
    if (list) list.push({ sampledAt: row.sampled_at, origin: row.origin });
  }
  return bySource;
}
