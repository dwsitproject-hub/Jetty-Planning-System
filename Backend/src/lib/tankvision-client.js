/**
 * HTTP client for Endress+Hauser Tankvision / NXA GWTHandler.esp endpoints.
 * Undocumented reverse-engineered surface — treat as brittle.
 *
 * Observed PARAMID meanings (live NXA820, E+H OPC / REST docs + plant verify):
 *   622 Product Level (mm)
 *   624 unused / INIT on some hosts — omit from default list (can cause HTTP 204)
 *   625 Product Temperature (°C)
 *   628 Observed Density (kg/m³)
 *   717 Total Observed Volume (m³ per NXA docs; UI may display converted)
 *   724 Total Mass Flow Rate (tph / kg/min scaled as ton/hr in UI)
 *   730 Total Mass (ton)
 */

/** Default poll param set (no 624). Override via TANK_GAUGING_PARAMIDLIST. */
export const DEFAULT_TANK_PARAM_IDS = '622|625|628|717|724|730';

export function trimBaseUrl(raw) {
  return String(raw || '').replace(/\/+$/, '');
}

/**
 * Resolve configured ATG base URLs (comma-separated TANK_GAUGING_BASE_URLS,
 * else single TANK_GAUGING_BASE_URL, else default first host).
 * @returns {string[]}
 */
export function resolveTankGaugingBaseUrls() {
  const multi = String(process.env.TANK_GAUGING_BASE_URLS || '')
    .split(',')
    .map((s) => trimBaseUrl(s.trim()))
    .filter(Boolean);
  if (multi.length) return [...new Set(multi)];
  const single = trimBaseUrl(process.env.TANK_GAUGING_BASE_URL || '');
  if (single) return [single];
  return ['http://172.16.11.77'];
}

/**
 * @param {string} baseUrl
 * @param {{ type?: string, user?: string|null, secret?: string|null }} [auth]
 */
export function buildAuthHeaders(baseUrl, auth) {
  const headers = {
    Accept: '*/*',
    'User-Agent': 'JPS-TankGaugingPoller/1.0',
    Referer: `${trimBaseUrl(baseUrl)}/`,
  };

  const resolved =
    auth && auth.type && auth.type !== 'none'
      ? auth
      : readEnvAuthFallback();

  if (resolved.type === 'cookie' && resolved.secret) {
    headers.Cookie = resolved.secret;
  } else if (resolved.type === 'basic' && resolved.user) {
    const token = Buffer.from(`${resolved.user}:${resolved.secret ?? ''}`, 'utf8').toString('base64');
    headers.Authorization = `Basic ${token}`;
  }
  return headers;
}

function readEnvAuthFallback() {
  const cookie = process.env.TANK_GAUGING_COOKIE;
  if (cookie) return { type: 'cookie', user: null, secret: cookie };

  const user = process.env.TANK_GAUGING_BASIC_USER;
  if (user) {
    return {
      type: 'basic',
      user,
      secret: process.env.TANK_GAUGING_BASIC_PASS ?? '',
    };
  }
  return { type: 'none', user: null, secret: null };
}

async function gwtGet(searchParams, opts = {}) {
  const baseUrl = trimBaseUrl(opts.baseUrl || process.env.TANK_GAUGING_BASE_URL || 'http://172.16.11.77');
  const timeoutMs = Number(opts.timeoutMs ?? process.env.TANK_GAUGING_TIMEOUT_MS ?? 15000);
  const url = new URL(`${baseUrl}/GWTHandler.esp`);
  for (const [k, v] of Object.entries(searchParams)) {
    url.searchParams.set(k, String(v));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    try {
      await fetch(`${baseUrl}/index.esp`, {
        method: 'GET',
        headers: buildAuthHeaders(baseUrl, opts.auth),
        signal: AbortSignal.timeout(Math.min(timeoutMs, 5000)),
      });
    } catch {
      /* optional session warm-up */
    }

    const res = await fetch(url, {
      method: 'GET',
      headers: buildAuthHeaders(baseUrl, opts.auth),
      signal: controller.signal,
      redirect: 'follow',
    });
    const text = await res.text();
    if (res.status === 204 || (!text && res.ok)) {
      await new Promise((r) => setTimeout(r, 400));
      const res2 = await fetch(url, {
        method: 'GET',
        headers: buildAuthHeaders(baseUrl, opts.auth),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      });
      const text2 = await res2.text();
      return { ok: res2.ok && Boolean(text2), status: res2.status, text: text2, url: url.toString() };
    }
    return { ok: res.ok, status: res.status, text, url: url.toString() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * DATATYPE=23 — unit/tank tree (names + external ids) + Products groups.
 */
export async function fetchTankMeta(opts = {}) {
  return gwtGet({ DATATYPE: '23' }, opts);
}

/**
 * DATATYPE=47 — live parameter values for tanks.
 */
export async function fetchTankParameters(opts = {}) {
  const tankList =
    opts.tankList ||
    process.env.TANK_GAUGING_TANKLIST ||
    '1|2|3|4|5|6|7|8|9|10|11|12|13|14|15';
  const paramIdList =
    opts.paramIdList ||
    process.env.TANK_GAUGING_PARAMIDLIST ||
    DEFAULT_TANK_PARAM_IDS;
  return gwtGet(
    {
      DATATYPE: '47',
      TANKLIST: tankList,
      PARAMIDLIST: paramIdList,
      TYPE: 'DATA',
    },
    opts
  );
}

/**
 * Map Tankvision display name → master_tanks.code.
 */
export function tankvisionNameToCode(name) {
  const n = String(name || '').trim();
  if (!n) return null;
  const sodium = n.match(/^TK\s+Sodium\s+(.+)$/i);
  if (sodium) return sodium[1].trim();
  const tk = n.match(/^TK\s+(.+)$/i);
  if (tk) return tk[1].trim();
  return n;
}

/**
 * Build externalTankId → product name from DATATYPE=23 Products groups.
 * @param {object} data parsed JSON
 * @returns {Map<number, string>}
 */
export function productMapFromMetaData(data) {
  const map = new Map();
  const groupTypes = data?.leftTree?.groupTypes || data?.groupTypes || [];
  for (const gt of groupTypes) {
    if (String(gt.name || '').trim().toLowerCase() !== 'products') continue;
    for (const group of gt.groups || []) {
      const productName = String(group.name || '').trim();
      if (!productName) continue;
      for (const t of group.tanks || []) {
        const externalTankId = Number.parseInt(t.id, 10);
        if (!Number.isFinite(externalTankId)) continue;
        if (!map.has(externalTankId)) map.set(externalTankId, productName);
      }
    }
  }
  return map;
}

/**
 * Parse DATATYPE=23 tank list + product assignments.
 * @param {string} text
 */
export function parseTankMetaResponse(text) {
  const raw = String(text ?? '').trim();
  if (!raw) {
    return { tanks: [], unitName: null, productByExternalId: new Map(), parseMode: 'empty' };
  }
  try {
    const data = JSON.parse(raw);
    const unitName =
      data?.leftTree?.localUnitInfo?.[0]?.unitName ||
      data?.leftTree?.units?.[0]?.name ||
      data?.units?.[0]?.name ||
      null;
    const units = data?.leftTree?.units || data?.units || [];
    const tanks = [];
    for (const unit of units) {
      for (const t of unit.tanks || []) {
        const externalTankId = Number.parseInt(t.id, 10);
        const name = String(t.name || '').trim();
        if (!Number.isFinite(externalTankId) || !name) continue;
        tanks.push({
          externalTankId,
          name,
          code: tankvisionNameToCode(name),
          status: t.status != null ? Number(t.status) : null,
        });
      }
    }
    const productByExternalId = productMapFromMetaData(data);
    return {
      tanks,
      unitName: unitName ? String(unitName) : null,
      productByExternalId,
      parseMode: 'leftTree',
    };
  } catch {
    return { tanks: [], unitName: null, productByExternalId: new Map(), parseMode: 'unrecognized' };
  }
}

/**
 * Parse a number that may use apostrophe thousands separators (UI style: 6'277).
 */
export function parseTankNumber(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim().replace(/'/g, '').replace(/,/g, '').replace(/^\+/, '');
  if (!s || s === '-' || /^n\/?a$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function paramById(parameterlist, id) {
  return (parameterlist || []).find((p) => Number(p.id) === id) || null;
}

const STATUS_RANK = {
  NODATA: 100,
  FAIL: 90,
  INVALIDDATA: 80,
  INIT: 70,
  MANUAL: 60,
  LASTVALIDVALUE: 50,
  OK: 10,
};

function normalizeStatusKey(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

/** Pick the most severe status across polled parameters. */
export function pickWorstStatusString(statusStrings) {
  let worst = null;
  let worstRank = -1;
  for (const raw of statusStrings) {
    if (!raw) continue;
    const key = normalizeStatusKey(raw);
    const rank = STATUS_RANK[key] ?? 40;
    if (rank > worstRank) {
      worstRank = rank;
      worst = String(raw).trim();
    }
  }
  return worst;
}

/**
 * @param {object} data parsed DATATYPE=47 JSON
 * @returns {Map<number, object>}
 */
export function tankInfoMapFromParameterData(data) {
  const infoList = data?.multiTankTgvData?.multiTankInfoData || [];
  const byTankId = new Map();
  for (const info of infoList) {
    const externalTankId = Number.parseInt(info.tankId, 10);
    if (!Number.isFinite(externalTankId)) continue;
    const comment = String(info.tankComment ?? '').trim();
    byTankId.set(externalTankId, {
      tankComment: comment && comment !== '-' ? comment : null,
      tankStatusCode: info.tankStatus != null ? Number(info.tankStatus) : null,
      levelMovement: info.levelMovement != null ? Number(info.levelMovement) : null,
      gaugeRefHeightMm: parseTankNumber(info.gaugeRefHeight),
      tankName: info.tankName ? String(info.tankName).trim() : null,
    });
  }
  return byTankId;
}

function readingFromBulkTank(tank, tankInfoByExternalId, productByExternalId) {
  const list = tank.parameterlist || [];
  const externalTankId = Number.parseInt(tank.tankId, 10);
  const level = paramById(list, 622);
  const temp = paramById(list, 625);
  const density = paramById(list, 628);
  const volume = paramById(list, 717);
  const flow = paramById(list, 724);
  const mass = paramById(list, 730);

  const statusText = pickWorstStatusString(
    [level, temp, density, volume, flow, mass].map((p) => p?.statusString)
  );

  const ts = Number(
    level?.timestamp || temp?.timestamp || density?.timestamp || volume?.timestamp ||
      flow?.timestamp || mass?.timestamp || 0
  );

  const info = tankInfoByExternalId?.get(externalTankId) || {};
  const productFromMeta = productByExternalId?.get(externalTankId) ?? null;

  return normalizeReading({
    externalTankId,
    productName: productFromMeta,
    tankComment: info.tankComment ?? null,
    tankStatusCode: info.tankStatusCode ?? null,
    levelMovement: info.levelMovement ?? null,
    gaugeRefHeightMm: info.gaugeRefHeightMm ?? null,
    levelMm: level?.value ?? level?.valueString,
    temperatureC: temp?.value ?? temp?.valueString,
    observedDensityKgM3: density?.value ?? density?.valueString,
    totalObservedVolume: volume?.value ?? volume?.valueString,
    flowRateTph: flow?.value ?? flow?.valueString,
    totalMass: mass?.value ?? mass?.valueString,
    statusText,
    recordedAt: ts > 0 ? new Date(ts * 1000).toISOString() : null,
    parameterlist: list,
  });
}

/**
 * Normalize fixture JSON or live GWT body into reading rows.
 * Live shape includes multiTankBulkRealTimeData + multiTankInfoData.
 *
 * @param {string} text
 * @param {Map<number, string>} [productByExternalId] from DATATYPE=23 (optional)
 */
export function parseTankParameterResponse(text, productByExternalId = new Map()) {
  const raw = String(text ?? '').trim();
  if (!raw) {
    return { readings: [], tankInfoByExternalId: new Map(), parseMode: 'empty' };
  }

  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      const data = JSON.parse(raw);
      const tankInfoByExternalId = tankInfoMapFromParameterData(data);

      const bulk = data?.multiTankTgvData?.multiTankBulkRealTimeData;
      if (Array.isArray(bulk)) {
        return {
          readings: bulk
            .map((t) => readingFromBulkTank(t, tankInfoByExternalId, productByExternalId))
            .filter((r) => r.externalTankId != null),
          tankInfoByExternalId,
          parseMode: 'multiTankBulkRealTimeData',
        };
      }

      const list = Array.isArray(data) ? data : data.readings;
      if (Array.isArray(list)) {
        return {
          readings: list.map(normalizeReading).filter((r) => r.externalTankId != null),
          tankInfoByExternalId,
          parseMode: 'json',
        };
      }
    } catch {
      /* fall through */
    }
  }

  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const readings = [];
  for (const line of lines) {
    if (/^(#|\/\/)/.test(line)) continue;
    if (/^(tank|external|id)\b/i.test(line) && /[|;,\t]/.test(line)) continue;
    const parts = line.split(/[|;,\t]/).map((p) => p.trim());
    if (parts.length < 2) continue;
    const externalTankId = Number.parseInt(parts[0], 10);
    if (!Number.isFinite(externalTankId)) continue;
    readings.push(
      normalizeReading({
        externalTankId,
        productName: parts[1] || productByExternalId.get(externalTankId) || null,
        levelMm: parts[2],
        temperatureC: parts[3],
        totalMass: parts[4],
        flowRateTph: parts[5],
        statusText: parts[6] || null,
      })
    );
  }
  if (readings.length) {
    return { readings, tankInfoByExternalId: new Map(), parseMode: 'delimited' };
  }

  return { readings: [], tankInfoByExternalId: new Map(), parseMode: 'unrecognized' };
}

function normalizeReading(row) {
  const r = row && typeof row === 'object' ? row : {};
  const externalTankId = Number.parseInt(r.externalTankId ?? r.external_tank_id ?? r.tankId ?? r.id, 10);
  const parameterlist = Array.isArray(r.parameterlist) ? r.parameterlist : null;

  return {
    externalTankId: Number.isFinite(externalTankId) ? externalTankId : null,
    productName: r.productName ?? r.product_name ?? r.product ?? null,
    tankComment: r.tankComment ?? r.tank_comment ?? null,
    tankStatusCode:
      r.tankStatusCode != null ? Number(r.tankStatusCode) :
      r.tank_status_code != null ? Number(r.tank_status_code) : null,
    levelMovement:
      r.levelMovement != null ? Number(r.levelMovement) :
      r.level_movement != null ? Number(r.level_movement) : null,
    gaugeRefHeightMm: parseTankNumber(r.gaugeRefHeightMm ?? r.gauge_ref_height_mm),
    levelMm: parseTankNumber(r.levelMm ?? r.level_mm ?? r.level),
    temperatureC: parseTankNumber(r.temperatureC ?? r.temperature_c ?? r.temp),
    observedDensityKgM3: parseTankNumber(
      r.observedDensityKgM3 ?? r.observed_density_kg_m3 ?? r.density
    ),
    totalObservedVolume: parseTankNumber(
      r.totalObservedVolume ?? r.total_observed_volume ?? r.volume
    ),
    totalMass: parseTankNumber(r.totalMass ?? r.total_mass ?? r.mass),
    flowRateTph: parseTankNumber(r.flowRateTph ?? r.flow_rate_tph ?? r.flow),
    statusText: r.statusText ?? r.status_text ?? r.status ?? null,
    recordedAt: r.recordedAt ?? r.recorded_at ?? null,
    parameterlist,
  };
}

/** JSON-safe reading for raw_payload storage. */
export function readingToRawPayload(reading) {
  return {
    externalTankId: reading.externalTankId,
    productName: reading.productName,
    tankComment: reading.tankComment,
    tankStatusCode: reading.tankStatusCode,
    levelMovement: reading.levelMovement,
    gaugeRefHeightMm: reading.gaugeRefHeightMm,
    levelMm: reading.levelMm,
    temperatureC: reading.temperatureC,
    observedDensityKgM3: reading.observedDensityKgM3,
    totalObservedVolume: reading.totalObservedVolume,
    totalMass: reading.totalMass,
    flowRateTph: reading.flowRateTph,
    statusText: reading.statusText,
    recordedAt: reading.recordedAt,
    parameterlist: reading.parameterlist ?? null,
  };
}
