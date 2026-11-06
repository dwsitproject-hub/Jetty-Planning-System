/**
 * ATG cargo gap recovery: Tankvision archive import + progress re-aggregation.
 */
import { buildAuthHeaders, trimBaseUrl } from './tankvision-client.js';
import { resolveEnabledSources } from './tank-gauging-source-config.js';
import { scanOperationGapsForRecovery } from './atg-cargo-gap-scan.js';
import { aggregateAtgDailyProgressForOperation } from './operational-progress.js';
import { aggregateHourlyProgressForOperation } from './atg-hourly-progress.js';

export const ARCHIVE_PARAM_IDS = [622, 625, 628, 717, 730];
export const MAX_GAP_SPAN_MS = 7 * 24 * 60 * 60 * 1000;
export const GAP_PAD_MS = 5 * 60 * 1000;

const PARAM_COLUMNS = {
  622: 'level_mm',
  625: 'temperature_c',
  628: 'observed_density_kg_m3',
  717: 'total_observed_volume',
  730: 'total_mass',
};

const STATUS_RANK = {
  NODATA: 100,
  FAIL: 90,
  INVALIDDATA: 80,
  INIT: 70,
  MANUAL: 60,
  LASTVALIDVALUE: 50,
  OK: 10,
};

function pickWorstStatus(statuses) {
  let worst = null;
  let worstRank = -1;
  for (const raw of statuses) {
    if (!raw) continue;
    const key = String(raw).trim().toUpperCase().replace(/\s+/g, '');
    const rank = STATUS_RANK[key] ?? 40;
    if (rank > worstRank) {
      worstRank = rank;
      worst = String(raw).trim();
    }
  }
  return worst;
}

/**
 * @param {string} baseUrl
 * @param {object} auth
 * @param {number} externalTankId
 * @param {number} paramId
 * @param {number} startUnix
 * @param {number} endUnix
 */
export async function fetchArchiveTankData(baseUrl, auth, externalTankId, paramId, startUnix, endUnix) {
  const base = trimBaseUrl(baseUrl);
  const url = new URL(`${base}/GWTHandler.esp`);
  url.searchParams.set('DATATYPE', '18');
  url.searchParams.set('ID', String(externalTankId));
  url.searchParams.set('STARTTIME', String(startUnix));
  url.searchParams.set('ENDTIME', String(endUnix));
  url.searchParams.set('PARAMID', String(paramId));

  await fetch(`${base}/index.esp`, {
    headers: buildAuthHeaders(base, auth),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});

  const res = await fetch(url, {
    headers: buildAuthHeaders(base, auth),
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  if (!res.ok || !text.trim()) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(text);
}

/**
 * @param {Array<{ sourceBaseUrl: string, externalTankId: number, paramId: number, sampledAt: string, value: unknown, status: string }>} rows
 */
export function mergeArchiveParamRows(rows) {
  const byKey = new Map();
  for (const row of rows || []) {
    if (!row.sampledAt) continue;
    const key = `${row.sourceBaseUrl}|${row.externalTankId}|${row.sampledAt}`;
    let s = byKey.get(key);
    if (!s) {
      s = {
        sourceBaseUrl: row.sourceBaseUrl,
        externalTankId: row.externalTankId,
        sampledAt: row.sampledAt,
        statuses: [],
        values: {},
      };
      byKey.set(key, s);
    }
    if (row.status) s.statuses.push(row.status);
    const col = PARAM_COLUMNS[row.paramId];
    if (col) s.values[col] = row.value;
  }
  return [...byKey.values()].map((s) => ({
    ...s,
    statusText: pickWorstStatus(s.statuses),
  }));
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {number} portId
 * @param {Array<number>} tankIds
 */
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

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {object} sample merged sample row with values
 * @param {number} tankId
 */
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
  if (after === 0 && before > 0) return 'success';
  if (after === 0 && before === 0) return 'success';
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

/**
 * @param {import('pg').Pool} db
 * @param {number} operationId
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun]
 * @param {string[]} [opts.gapKeys]
 */
export async function runAtgOperationRecovery(db, operationId, opts = {}) {
  const started = Date.now();
  const dryRun = Boolean(opts.dryRun);

  const scanBefore = await scanOperationGapsForRecovery(db, operationId, opts.scanOpts || {});
  const op = scanBefore.operations[0];
  if (!op) {
    return {
      ok: true,
      operationId,
      operationLabel: null,
      dryRun,
      gapsBefore: [],
      gapsAfter: [],
      samplesInserted: 0,
      hourlyUpserted: 0,
      dailyUpserted: 0,
      archiveErrors: [],
      durationMs: Date.now() - started,
      outcome: dryRun ? 'dry_run' : 'success',
      preview: [],
    };
  }

  const gapsBefore = [...(op.gaps || [])];
  let targetGaps = filterGapsByKeys(gapsBefore, opts.gapKeys);
  if (!targetGaps.length && gapsBefore.length) targetGaps = gapsBefore;

  const uniqueTankIds = collectTankIdsForGaps(op, targetGaps);
  const tankMaps = await loadTankMaps(db, op.portId, uniqueTankIds);
  const sources = await resolveEnabledSources(db, { portId: op.portId });
  const authByUrl = new Map(sources.map((s) => [trimBaseUrl(s.baseUrl), s.auth]));

  const preview = [];
  const archiveErrors = [];
  const paramRows = [];

  for (const gap of targetGaps) {
    const { startUnix, endUnix, startIso, endIso } = padGapWindow(gap.startAt, gap.endAt);
    for (const map of tankMaps) {
      preview.push({
        gapKey: gap.gapKey,
        tankCode: map.code,
        sourceBaseUrl: map.source_base_url,
        windowStart: startIso,
        windowEnd: endIso,
      });
      if (dryRun) continue;

      const baseUrl = trimBaseUrl(map.source_base_url);
      const auth = authByUrl.get(baseUrl) || { type: 'none' };
      for (const paramId of ARCHIVE_PARAM_IDS) {
        try {
          const data = await fetchArchiveTankData(
            baseUrl,
            auth,
            Number(map.external_tank_id),
            paramId,
            startUnix,
            endUnix
          );
          const list = data?.parameterlist || [];
          for (const pt of list) {
            const ts = Number(pt.timestamp || pt.localtimestamp || 0);
            if (ts <= 0) continue;
            paramRows.push({
              sourceBaseUrl: baseUrl,
              externalTankId: Number(map.external_tank_id),
              paramId,
              sampledAt: new Date(ts * 1000).toISOString(),
              value: pt.value ?? pt.valueString ?? null,
              status: pt.statusString ?? '',
            });
          }
        } catch (e) {
          archiveErrors.push({
            sourceBaseUrl: baseUrl,
            tankCode: map.code,
            message: e?.message || String(e),
          });
        }
      }
    }
  }

  if (dryRun) {
    return {
      ok: true,
      operationId,
      operationLabel: op.operationLabel,
      portId: op.portId,
      dryRun: true,
      gapsBefore,
      gapsAfter: gapsBefore,
      samplesInserted: 0,
      hourlyUpserted: 0,
      dailyUpserted: 0,
      archiveErrors: [],
      preview,
      durationMs: Date.now() - started,
      outcome: 'dry_run',
    };
  }

  const merged = mergeArchiveParamRows(paramRows);
  const tankIdByExternal = new Map(
    tankMaps.map((m) => [`${trimBaseUrl(m.source_base_url)}|${m.external_tank_id}`, Number(m.tank_id)])
  );

  let samplesInserted = 0;
  for (const sample of merged) {
    const tankId = tankIdByExternal.get(`${trimBaseUrl(sample.sourceBaseUrl)}|${sample.externalTankId}`);
    if (!tankId) continue;
    samplesInserted += await insertSampleIfMissing(db, sample, tankId);
  }

  let dailyUpserted = 0;
  let hourlyUpserted = 0;
  try {
    const daily = await aggregateAtgDailyProgressForOperation(db, operationId, { includeToday: true });
    dailyUpserted = daily.upserted || 0;
  } catch {
    /* non-fatal */
  }
  try {
    const hourly = await aggregateHourlyProgressForOperation(db, operationId, { onlyClosedHours: false });
    hourlyUpserted = hourly.upserted || 0;
  } catch {
    /* non-fatal */
  }

  const scanAfter = await scanOperationGapsForRecovery(db, operationId, opts.scanOpts || {});
  const opAfter = scanAfter.operations[0];
  const gapsAfter = opAfter ? [...(opAfter.gaps || [])] : [];

  const result = {
    ok: archiveErrors.length === 0 || samplesInserted > 0,
    operationId,
    operationLabel: op.operationLabel,
    portId: op.portId,
    dryRun: false,
    gapsBefore,
    gapsAfter,
    samplesInserted,
    hourlyUpserted,
    dailyUpserted,
    archiveErrors,
    preview,
    durationMs: Date.now() - started,
  };
  result.outcome = deriveResyncOutcome(result);
  return result;
}
