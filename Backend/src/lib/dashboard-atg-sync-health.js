/**
 * Dashboard V2 — ATG / Tankvision sync health for Live Ops.
 */
import { resolveTankGaugingBaseUrls } from './tankvision-client.js';

export const DEFAULT_ATG_STALE_MS = 60 * 60 * 1000;

function toIso(value) {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Pure classification for one enabled source row (testable without DB).
 * @param {object} row
 * @param {{ now?: number, staleThresholdMs?: number }} [opts]
 */
export function classifySourceSyncHealth(row, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const staleThresholdMs =
    Number.isFinite(opts.staleThresholdMs) && opts.staleThresholdMs > 0
      ? opts.staleThresholdMs
      : DEFAULT_ATG_STALE_MS;

  const lastFetchedIso = toIso(row.lastFetchedAt ?? row.last_fetched_at ?? null);
  const lastPollIso = toIso(row.lastPollAt ?? row.last_poll_at ?? null);
  const lastSyncedAt = lastFetchedIso ?? lastPollIso ?? null;

  let stale = true;
  let staleMinutes = null;
  if (lastSyncedAt) {
    const ageMs = now - new Date(lastSyncedAt).getTime();
    stale = ageMs > staleThresholdMs;
    staleMinutes = Math.max(0, Math.floor(ageMs / 60000));
  }

  return {
    id: row.id != null ? String(row.id) : null,
    label: row.label ?? null,
    baseUrl: row.baseUrl ?? row.base_url ?? null,
    lastFetchedAt: lastFetchedIso,
    lastPollAt: lastPollIso,
    lastPollOk: row.lastPollOk ?? row.last_poll_ok ?? null,
    lastError: row.lastError ?? row.last_error ?? null,
    mappedTankCount: Number(row.mappedTankCount ?? row.mapped_tank_count) || 0,
    lastSyncedAt,
    stale,
    staleMinutes,
  };
}

async function tableHasRows(db) {
  const r = await db.query(`SELECT EXISTS (SELECT 1 FROM tank_gauging_sources LIMIT 1) AS ok`);
  return Boolean(r.rows[0]?.ok);
}

const SOURCES_SQL = `
  SELECT s.id, s.base_url, s.label, s.last_poll_at, s.last_poll_ok, s.last_error,
         agg.last_fetched_at, agg.mapped_tank_count
  FROM tank_gauging_sources s
  LEFT JOIN (
    SELECT m.source_base_url,
           MAX(l.fetched_at) AS last_fetched_at,
           COUNT(*)::int AS mapped_tank_count
    FROM tank_gauging_tank_map m
    LEFT JOIN tank_gauging_latest l
      ON l.tank_id = m.tank_id AND l.source_base_url = m.source_base_url
    WHERE m.port_id = $1
    GROUP BY m.source_base_url
  ) agg ON agg.source_base_url = s.base_url
  WHERE s.port_id = $1 AND s.enabled = TRUE
  ORDER BY LOWER(COALESCE(s.label, s.base_url)), s.base_url`;

const ENV_FETCH_AGG_SQL = `
  SELECT m.source_base_url AS base_url,
         MAX(l.fetched_at) AS last_fetched_at,
         COUNT(*)::int AS mapped_tank_count
  FROM tank_gauging_tank_map m
  LEFT JOIN tank_gauging_latest l
    ON l.tank_id = m.tank_id AND l.source_base_url = m.source_base_url
  WHERE m.port_id = $1
  GROUP BY m.source_base_url`;

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {number} portId
 * @param {{ now?: number, staleThresholdMs?: number }} [opts]
 */
export async function computeAtgSyncHealth(db, portId, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const staleThresholdMs =
    Number.isFinite(opts.staleThresholdMs) && opts.staleThresholdMs > 0
      ? opts.staleThresholdMs
      : DEFAULT_ATG_STALE_MS;
  const checkedAt = new Date(now).toISOString();

  let rawRows = [];
  if (await tableHasRows(db)) {
    const r = await db.query(SOURCES_SQL, [portId]);
    rawRows = r.rows;
  } else {
    const envPortId = Number(process.env.TANK_GAUGING_PORT_ID);
    if (!Number.isFinite(envPortId) || envPortId !== Number(portId)) {
      return {
        staleThresholdMs,
        checkedAt,
        totalEnabled: 0,
        staleCount: 0,
        allHealthy: true,
        sources: [],
        staleSources: [],
      };
    }

    const aggR = await db.query(ENV_FETCH_AGG_SQL, [portId]);
    const aggByUrl = new Map(
      aggR.rows.map((row) => [row.base_url, row])
    );
    rawRows = resolveTankGaugingBaseUrls().map((baseUrl) => {
      const agg = aggByUrl.get(baseUrl);
      return {
        id: null,
        base_url: baseUrl,
        label: null,
        last_poll_at: null,
        last_poll_ok: null,
        last_error: null,
        last_fetched_at: agg?.last_fetched_at ?? null,
        mapped_tank_count: agg?.mapped_tank_count ?? 0,
      };
    });
  }

  const sources = rawRows.map((row) =>
    classifySourceSyncHealth(row, { now, staleThresholdMs })
  );
  const staleSources = sources.filter((s) => s.stale);

  return {
    staleThresholdMs,
    checkedAt,
    totalEnabled: sources.length,
    staleCount: staleSources.length,
    allHealthy: staleSources.length === 0,
    sources,
    staleSources,
  };
}
