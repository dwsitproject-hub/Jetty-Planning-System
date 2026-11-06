/**
 * ATG cargo gap recovery: Tankvision archive import + progress re-aggregation.
 */
import { trimBaseUrl } from './tankvision-client.js';
import {
  ARCHIVE_PARAM_IDS,
  ARCHIVE_PREVIEW_PARAM_ID,
  archivePointsFromResponse,
  countNewArchivePoints,
  fetchArchiveTankData,
  mergeArchiveParamRows,
} from './tankvision-archive.js';
import { resolveEnabledSources } from './tank-gauging-source-config.js';
import { scanOperationGapsForRecovery } from './atg-cargo-gap-scan.js';
import { aggregateAtgDailyProgressForOperation } from './operational-progress.js';
import { aggregateHourlyProgressForOperation } from './atg-hourly-progress.js';

export const MAX_GAP_SPAN_MS = 7 * 24 * 60 * 60 * 1000;
export const GAP_PAD_MS = 5 * 60 * 1000;

async function loadTankMaps(db, portId, tankIds) {
  if (!tankIds.length) return [];
  const r = await db.query(
    `SELECT m.tank_id, m.external_tank_id, m.source_base_url, t.code
     FROM tank_gauging_tank_map m
     JOIN master_tanks t ON t.id = m.tank_id AND t.deleted_at IS NULL
     WHERE m.port_id = $1 AND m.tank_id = ANY($2::bigint[])`,
    [portId, tankIds]
  );
  return r.rows;
}

async function loadStoredSampleTimes(db, tankId, sourceBaseUrl, startIso, endIso) {
  const r = await db.query(
    `SELECT sampled_at FROM tank_gauging_samples
     WHERE tank_id = $1 AND source_base_url = $2
       AND sampled_at >= $3::timestamptz AND sampled_at <= $4::timestamptz`,
    [tankId, sourceBaseUrl, startIso, endIso]
  );
  return r.rows.map((row) => new Date(row.sampled_at).toISOString());
}

async function insertSampleIfMissing(db, sample, tankId) {
  const v = sample.values || {};
  const rawPayload = JSON.stringify({
    source: 'tankvision-archive-import',
    externalTankId: sample.externalTankId,
  });
  const r = await db.query(
    `INSERT INTO tank_gauging_samples (
       tank_id, source_base_url, product_name, tank_comment, total_mass,
       flow_rate_tph, level_mm, temperature_c, observed_density_kg_m3,
       total_observed_volume, status_text, sampled_at, raw_payload
     )
     SELECT $1, $2, NULL, NULL, $3::numeric, NULL, $4::numeric, $5::numeric,
            $6::numeric, $7::numeric, $8, $9::timestamptz, $10::jsonb
     WHERE NOT EXISTS (
       SELECT 1 FROM tank_gauging_samples s
       WHERE s.tank_id = $1
         AND s.source_base_url = $2
         AND s.sampled_at = $9::timestamptz
     )
     RETURNING id`,
    [
      tankId,
      sample.sourceBaseUrl,
      v.total_mass ?? null,
      v.level_mm ?? null,
      v.temperature_c ?? null,
      v.observed_density_kg_m3 ?? null,
      v.total_observed_volume ?? null,
      sample.statusText ?? null,
      sample.sampledAt,
      rawPayload,
    ]
  );
  return r.rowCount > 0 ? 1 : 0;
}

function filterGapsByKeys(gaps, gapKeys) {
  if (!gapKeys?.length) return gaps;
  const set = new Set(gapKeys.map(String));
  return (gaps || []).filter((g) => set.has(String(g.gapKey)));
}

function padGapWindow(startAt, endAt) {
  const startMs = new Date(startAt).getTime() - GAP_PAD_MS;
  const endMs = new Date(endAt).getTime() + GAP_PAD_MS;
  if (endMs - startMs > MAX_GAP_SPAN_MS) {
    const err = new Error('Gap window exceeds maximum span (7 days). Use CLI for large backfills.');
    err.statusCode = 422;
    throw err;
  }
  return {
    startUnix: Math.floor(startMs / 1000),
    endUnix: Math.floor(endMs / 1000),
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}

/**
 * @param {object} result
 */
export function buildResyncAuditSummary(result) {
  const label = result.operationLabel || `Operation #${result.operationId}`;
  const before = (result.gapsBefore || []).length;
  const after = (result.gapsAfter || []).length;
  return `ATG cargo resync: ${label}: ${result.samplesInserted ?? 0} samples imported, ${result.hourlyUpserted ?? 0} hourly rows updated; gaps ${before} → ${after}.`;
}

/**
 * @param {object} result
 */
export function deriveResyncOutcome(result) {
  if (result.dryRun) return 'dry_run';
  if (result.failed) return 'failed';
  const inserted = Number(result.samplesInserted) || 0;
  const errors = (result.archiveErrors || []).length;
  const after = (result.gapsAfter || []).length;
  const before = (result.gapsBefore || []).length;
  if (inserted === 0 && before > 0 && errors === 0) return 'no_samples';
  if (errors > 0 || (after > 0 && before > after)) return 'partial';
  if (after === 0) return 'success';
  return inserted > 0 ? 'partial' : 'no_samples';
}

function collectTankIdsForGaps(op, targetGaps) {
  const lineIds = new Set(targetGaps.map((g) => Number(g.loadLineId)).filter((n) => n > 0));
  const tankIds = new Set();
  for (const line of op.lines || []) {
    if (lineIds.size && !lineIds.has(Number(line.loadLineId))) continue;
    for (const tid of line.atgTankIds || []) tankIds.add(Number(tid));
  }
  return [...tankIds].filter((n) => n > 0);
}

function tankMapsForGap(op, gap, tankMaps) {
  const line = (op.lines || []).find((l) => Number(l.loadLineId) === Number(gap.loadLineId));
  if (!line) return tankMaps;
  const ids = new Set((line.atgTankIds || []).map(Number));
  return tankMaps.filter((m) => ids.has(Number(m.tank_id)));
}

async function previewGapTank(db, gap, map, auth, window) {
  const baseUrl = trimBaseUrl(map.source_base_url);
  const entry = {
    gapKey: gap.gapKey,
    tankCode: map.code,
    windowStart: window.startIso,
    windowEnd: window.endIso,
    archivePoints: 0,
    newPoints: 0,
    error: null,
  };
  try {
    const data = await fetchArchiveTankData(
      baseUrl,
      auth,
      Number(map.external_tank_id),
      ARCHIVE_PREVIEW_PARAM_ID,
      window.startUnix,
      window.endUnix
    );
    const archiveTimes = archivePointsFromResponse(data).map((p) => p.sampledAt);
    const stored = await loadStoredSampleTimes(db, Number(map.tank_id), baseUrl, window.startIso, window.endIso);
    entry.archivePoints = archiveTimes.length;
    entry.newPoints = countNewArchivePoints(archiveTimes, stored);
  } catch (e) {
    entry.error = e?.message || String(e);
  }
  return entry;
}

async function fetchGapTankRows(gap, map, auth, window, archiveErrors) {
  const baseUrl = trimBaseUrl(map.source_base_url);
  const rows = [];
  for (const paramId of ARCHIVE_PARAM_IDS) {
    try {
      const data = await fetchArchiveTankData(
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
      archiveErrors.push({ gapKey: gap.gapKey, tankCode: map.code, message: e?.message || String(e) });
    }
  }
  return rows;
}

async function reaggregate(db, operationId) {
  let dailyUpserted = 0;
  let hourlyUpserted = 0;
  try {
    const daily = await aggregateAtgDailyProgressForOperation(db, operationId, { includeToday: true });
    dailyUpserted = daily.upserted || 0;
  } catch (e) {
    console.error('ATG resync daily aggregation failed:', e?.message || e);
  }
  try {
    const hourly = await aggregateHourlyProgressForOperation(db, operationId, { onlyClosedHours: false });
    hourlyUpserted = hourly.upserted || 0;
  } catch (e) {
    console.error('ATG resync hourly aggregation failed:', e?.message || e);
  }
  return { dailyUpserted, hourlyUpserted };
}

/**
 * Dry run queries the archive (one parameter) to report how many new points each gap would get.
 * @param {import('pg').Pool} db
 * @param {number} operationId
 * @param {{ dryRun?: boolean, gapKeys?: string[], scanOpts?: object }} [opts]
 */
export async function runAtgOperationRecovery(db, operationId, opts = {}) {
  const started = Date.now();
  const dryRun = Boolean(opts.dryRun);

  const scanBefore = await scanOperationGapsForRecovery(db, operationId, opts.scanOpts || {});
  const op = scanBefore.operations[0];
  const base = {
    ok: true,
    operationId,
    operationLabel: op?.operationLabel ?? null,
    portId: op?.portId ?? null,
    dryRun,
    samplesInserted: 0,
    hourlyUpserted: 0,
    dailyUpserted: 0,
    archiveErrors: [],
    preview: [],
  };
  if (!op) {
    return { ...base, gapsBefore: [], gapsAfter: [], targetGapKeys: [], durationMs: Date.now() - started, outcome: dryRun ? 'dry_run' : 'success' };
  }

  const gapsBefore = [...(op.gaps || [])];
  let targetGaps = filterGapsByKeys(gapsBefore, opts.gapKeys);
  if (!targetGaps.length) targetGaps = gapsBefore;
  const targetGapKeys = targetGaps.map((g) => g.gapKey);

  const tankMaps = await loadTankMaps(db, op.portId, collectTankIdsForGaps(op, targetGaps));
  const sources = await resolveEnabledSources(db, { portId: op.portId });
  const authByUrl = new Map(sources.map((s) => [trimBaseUrl(s.baseUrl), s.auth]));
  const authFor = (map) => authByUrl.get(trimBaseUrl(map.source_base_url)) || { type: 'none' };

  if (dryRun) {
    const preview = [];
    for (const gap of targetGaps) {
      const window = padGapWindow(gap.startAt, gap.endAt);
      for (const map of tankMapsForGap(op, gap, tankMaps)) {
        preview.push(await previewGapTank(db, gap, map, authFor(map), window));
      }
    }
    return {
      ...base,
      gapsBefore,
      gapsAfter: gapsBefore,
      targetGapKeys,
      preview,
      durationMs: Date.now() - started,
      outcome: 'dry_run',
    };
  }

  const archiveErrors = [];
  const paramRows = [];
  for (const gap of targetGaps) {
    const window = padGapWindow(gap.startAt, gap.endAt);
    for (const map of tankMapsForGap(op, gap, tankMaps)) {
      paramRows.push(...(await fetchGapTankRows(gap, map, authFor(map), window, archiveErrors)));
    }
  }

  const tankIdByExternal = new Map(
    tankMaps.map((m) => [`${trimBaseUrl(m.source_base_url)}|${m.external_tank_id}`, Number(m.tank_id)])
  );
  let samplesInserted = 0;
  for (const sample of mergeArchiveParamRows(paramRows)) {
    const tankId = tankIdByExternal.get(`${trimBaseUrl(sample.sourceBaseUrl)}|${sample.externalTankId}`);
    if (tankId) samplesInserted += await insertSampleIfMissing(db, sample, tankId);
  }

  const { dailyUpserted, hourlyUpserted } = await reaggregate(db, operationId);
  const scanAfter = await scanOperationGapsForRecovery(db, operationId, opts.scanOpts || {});
  const gapsAfter = [...(scanAfter.operations[0]?.gaps || [])];

  const result = {
    ...base,
    ok: archiveErrors.length === 0 || samplesInserted > 0,
    gapsBefore,
    gapsAfter,
    targetGapKeys,
    samplesInserted,
    hourlyUpserted,
    dailyUpserted,
    archiveErrors,
    durationMs: Date.now() - started,
  };
  result.outcome = deriveResyncOutcome(result);
  return result;
}
