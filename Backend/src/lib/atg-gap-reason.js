/**
 * Why an ATG window is incomplete: which source and time ranges have no stored samples,
 * and what the start/end readings alone would give (so the form can explain and suggest).
 */
import {
  DEFAULT_MIN_GAP_MS,
  gapsFromSampleTimeline,
  mergeAdjacentIntervals,
  gapDurationMinutes,
} from './atg-cargo-gap-detect.js';
import { computeDirectionalDeltaForWindow } from './atg-hourly-progress.js';

/**
 * Group per-tank gaps by ATG source; ranges from tanks on the same source are merged.
 * @param {{
 *   tanks: Array<{ tankId: number, code: string|null, sourceBaseUrl: string|null, sourceLabel: string|null }>,
 *   samplesByTank: Map<number, Array<string|Date>>,
 *   startAt: string|Date,
 *   endAt: string|Date,
 *   minGapMs?: number,
 * }} input
 * @returns {Array<{ label: string|null, baseUrl: string|null, tankCodes: string[], gaps: Array<{ startAt: string, endAt: string, durationMinutes: number }> }>}
 */
export function assembleGapSources({ tanks, samplesByTank, startAt, endAt, minGapMs = DEFAULT_MIN_GAP_MS }) {
  const bySource = new Map();
  for (const tank of tanks) {
    const times = (samplesByTank.get(tank.tankId) || []).map((t) => new Date(t).toISOString());
    const gaps = gapsFromSampleTimeline(times, startAt, endAt, minGapMs);
    if (!gaps.length) continue;
    const key = tank.sourceBaseUrl || `tank:${tank.tankId}`;
    const entry = bySource.get(key) || {
      label: tank.sourceLabel || tank.sourceBaseUrl || null,
      baseUrl: tank.sourceBaseUrl || null,
      tankCodes: [],
      ranges: [],
    };
    entry.tankCodes.push(tank.code || String(tank.tankId));
    entry.ranges.push(...gaps);
    bySource.set(key, entry);
  }

  return [...bySource.values()].map(({ ranges, ...rest }) => ({
    ...rest,
    gaps: mergeAdjacentIntervals(ranges).map((g) => ({
      ...g,
      durationMinutes: gapDurationMinutes(new Date(g.startAt).getTime(), new Date(g.endAt).getTime()),
    })),
  }));
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {{
 *   portId: number,
 *   tankIds: number[],
 *   startAt: string|Date,
 *   endAt: string|Date,
 *   purpose?: 'Loading'|'Unloading'|null,
 *   measurementBasis?: 'mass'|'volume',
 * }} opts
 * @returns {Promise<{ gapSources: ReturnType<typeof assembleGapSources>, endpointQty: number|null }>}
 */
export async function describeAtgWindowGaps(db, opts) {
  const tankMeta = await db.query(
    `SELECT t.id, t.code, m.source_base_url, s.label
     FROM master_tanks t
     LEFT JOIN tank_gauging_tank_map m ON m.tank_id = t.id AND m.port_id = $2
     LEFT JOIN tank_gauging_sources s ON s.port_id = m.port_id AND s.base_url = m.source_base_url
     WHERE t.id = ANY($1::bigint[])`,
    [opts.tankIds, opts.portId]
  );
  const tanks = tankMeta.rows.map((r) => ({
    tankId: Number(r.id),
    code: r.code,
    sourceBaseUrl: r.source_base_url,
    sourceLabel: r.label,
  }));

  const samples = await db.query(
    `SELECT tank_id, sampled_at FROM tank_gauging_samples
     WHERE tank_id = ANY($1::bigint[])
       AND sampled_at BETWEEN $2::timestamptz AND $3::timestamptz
     ORDER BY sampled_at`,
    [opts.tankIds, new Date(opts.startAt).toISOString(), new Date(opts.endAt).toISOString()]
  );
  const samplesByTank = new Map();
  for (const row of samples.rows) {
    const id = Number(row.tank_id);
    if (!samplesByTank.has(id)) samplesByTank.set(id, []);
    samplesByTank.get(id).push(row.sampled_at);
  }

  const gapSources = assembleGapSources({
    tanks,
    samplesByTank,
    startAt: opts.startAt,
    endAt: opts.endAt,
  });

  let endpointQty = null;
  if (opts.purpose) {
    const endpoint = await computeDirectionalDeltaForWindow(db, {
      tankIds: opts.tankIds,
      purpose: opts.purpose,
      startAt: opts.startAt,
      endAt: opts.endAt,
      measurementBasis: opts.measurementBasis,
    });
    if (endpoint.ok && !endpoint.incomplete && !endpoint.directionMismatch && endpoint.sumQtyMoved > 0) {
      endpointQty = endpoint.sumQtyMoved;
    }
  }

  return { gapSources, endpointQty };
}
