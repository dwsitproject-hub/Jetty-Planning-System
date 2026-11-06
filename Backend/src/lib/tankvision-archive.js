/**
 * Tankvision archive (DATATYPE 18) client and per-timestamp merge of parameter rows.
 */
import { buildAuthHeaders, trimBaseUrl } from './tankvision-client.js';

export const ARCHIVE_PARAM_IDS = [622, 625, 628, 717, 730];
export const ARCHIVE_PREVIEW_PARAM_ID = 730;

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
 * Archive points for one tank/param as { sampledAt, value, status } rows.
 * @param {object} data parsed archive response
 */
export function archivePointsFromResponse(data) {
  const out = [];
  for (const pt of data?.parameterlist || []) {
    const ts = Number(pt.timestamp || pt.localtimestamp || 0);
    if (ts <= 0) continue;
    out.push({
      sampledAt: new Date(ts * 1000).toISOString(),
      value: pt.value ?? pt.valueString ?? null,
      status: pt.statusString ?? '',
    });
  }
  return out;
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
 * Archive timestamps not already present in stored samples.
 * @param {string[]} archiveIsoList
 * @param {string[]} storedIsoList
 */
export function countNewArchivePoints(archiveIsoList, storedIsoList) {
  const stored = new Set((storedIsoList || []).map((s) => new Date(s).toISOString()));
  const unique = new Set((archiveIsoList || []).map((s) => new Date(s).toISOString()));
  let n = 0;
  for (const iso of unique) if (!stored.has(iso)) n += 1;
  return n;
}
