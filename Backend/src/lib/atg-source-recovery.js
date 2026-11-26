/**
 * Recover ATG samples for one Tankvision source over a time range from the Tankvision archive.
 * Works per source and window, not per cargo line, so it also covers entries saved as Manual.
 * Dry run (default) only reports what the archive holds; apply inserts the missing samples.
 */
import { trimBaseUrl } from './tankvision-client.js';
import { resolveEnabledSources } from './tank-gauging-source-config.js';
import {
  ARCHIVE_PARAM_IDS,
  ARCHIVE_PREVIEW_PARAM_ID,
  archivePointsFromResponse,
  countNewArchivePoints,
  fetchArchiveTankData,
  mergeArchiveParamRows,
} from './tankvision-archive.js';
import {
  DOWNLOAD_CONCURRENCY,
  insertSampleIfMissing,
  loadStoredSampleTimes,
  mapLimit,
  padGapWindow,
} from './atg-operation-recovery.js';

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function loadSourceTankMaps(db, portId, baseUrl, tankCodes) {
  const codes = (tankCodes || []).map((c) => String(c).trim().toLowerCase()).filter(Boolean);
  const r = await db.query(
    `SELECT m.tank_id, m.external_tank_id, m.source_base_url, t.code
     FROM tank_gauging_tank_map m
     JOIN master_tanks t ON t.id = m.tank_id AND t.deleted_at IS NULL
     WHERE m.port_id = $1 AND m.source_base_url = $2
       AND ($3::text[] IS NULL OR LOWER(t.code) = ANY($3::text[]))
     ORDER BY t.code`,
    [portId, baseUrl, codes.length ? codes : null]
  );
  return r.rows;
}

/** A sample with neither mass nor volume cannot answer a cargo quantity, so it is not imported. */
function hasMeasurement(sample) {
  const v = sample.values || {};
  return v.total_mass != null || v.total_observed_volume != null;
}

async function fetchTankPoints(fetchArchive, baseUrl, auth, map, window, paramIds) {
  const rows = [];
  const errors = [];
  for (const paramId of paramIds) {
    try {
      const data = await fetchArchive(
        baseUrl,
        auth,
        Number(map.external_tank_id),
        paramId,
        window.startUnix,
        window.endUnix
      );
      for (const pt of archivePointsFromResponse(data)) {
        rows.push({ ...pt, sourceBaseUrl: baseUrl, externalTankId: Number(map.external_tank_id), paramId });
      }
    } catch (e) {
      errors.push(e?.message || String(e));
    }
  }
  return { rows, errors };
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db pass a transaction client to make apply undoable
 * @param {{
 *   portId: number,
 *   sourceBaseUrl: string,
 *   startAt: string|Date,
 *   endAt: string|Date,
 *   tankCodes?: string[]|null,
 *   dryRun?: boolean,
 *   fetchArchive?: typeof fetchArchiveTankData,
 *   onProgress?: (p: { done: number, total: number }) => void,
 * }} opts
 */
export async function recoverAtgSourceRange(db, opts) {
  const dryRun = opts.dryRun !== false;
  const fetchArchive = opts.fetchArchive ?? fetchArchiveTankData;
  const baseUrl = trimBaseUrl(opts.sourceBaseUrl);
  const window = padGapWindow(opts.startAt, opts.endAt);

  const sources = await resolveEnabledSources(db, { portId: opts.portId });
  const source = sources.find((s) => trimBaseUrl(s.baseUrl) === baseUrl);
  if (!source) throw httpError(`No enabled ATG source ${baseUrl} for port ${opts.portId}`, 404);

  const maps = await loadSourceTankMaps(db, opts.portId, baseUrl, opts.tankCodes);
  if (!maps.length) throw httpError(`No mapped tanks on ${baseUrl} for the given tank codes`, 404);

  const paramIds = dryRun ? [ARCHIVE_PREVIEW_PARAM_ID] : ARCHIVE_PARAM_IDS;
  let done = 0;
  const perTank = await mapLimit(maps, DOWNLOAD_CONCURRENCY, async (map) => {
    const { rows, errors } = await fetchTankPoints(fetchArchive, baseUrl, source.auth, map, window, paramIds);
    done += 1;
    opts.onProgress?.({ done, total: maps.length });
    return { map, rows, errors };
  });

  const tanks = [];
  for (const { map, rows, errors } of perTank) {
    const stored = await loadStoredSampleTimes(db, Number(map.tank_id), baseUrl, window.startIso, window.endIso);
    const entry = {
      tankCode: map.code,
      archivePoints: 0,
      newPoints: 0,
      inserted: 0,
      skippedEmpty: 0,
      errors,
    };
    if (dryRun) {
      const times = rows.map((r) => r.sampledAt);
      entry.archivePoints = new Set(times).size;
      entry.newPoints = countNewArchivePoints(times, stored);
    } else {
      const samples = mergeArchiveParamRows(rows);
      entry.archivePoints = samples.length;
      entry.newPoints = countNewArchivePoints(samples.map((s) => s.sampledAt), stored);
      for (const sample of samples) {
        if (!hasMeasurement(sample)) {
          entry.skippedEmpty += 1;
          continue;
        }
        entry.inserted += await insertSampleIfMissing(db, sample, Number(map.tank_id));
      }
    }
    tanks.push(entry);
  }

  const sum = (key) => tanks.reduce((n, t) => n + t[key], 0);
  return {
    dryRun,
    portId: opts.portId,
    sourceBaseUrl: baseUrl,
    sourceLabel: source.label ?? null,
    windowStart: window.startIso,
    windowEnd: window.endIso,
    tanks,
    totals: {
      tanks: tanks.length,
      archivePoints: sum('archivePoints'),
      newPoints: sum('newPoints'),
      inserted: sum('inserted'),
      skippedEmpty: sum('skippedEmpty'),
      tanksWithErrors: tanks.filter((t) => t.errors.length).length,
    },
  };
}
