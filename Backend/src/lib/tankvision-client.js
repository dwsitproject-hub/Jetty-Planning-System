/**
 * HTTP client for Endress+Hauser Tankvision / NXA GWTHandler.esp endpoints.
 * Undocumented reverse-engineered surface — treat as brittle.
 *
 * Observed PARAMID meanings (live NXA820, 2026-07):
 *   622 Product Level (mm)
 *   624 unused / INIT in current plant feed
 *   625 Product Temperature (°C)
 *   724 Total Mass Flow Rate (tph)
 *   730 Total Mass
 */

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

function buildAuthHeaders(baseUrl) {
  const headers = {
    Accept: '*/*',
    'User-Agent': 'JPS-TankGaugingPoller/1.0',
    Referer: `${trimBaseUrl(baseUrl)}/`,
  };
  const cookie = process.env.TANK_GAUGING_COOKIE;
  if (cookie) headers.Cookie = cookie;

  const user = process.env.TANK_GAUGING_BASIC_USER;
  const pass = process.env.TANK_GAUGING_BASIC_PASS;
  if (user) {
    const token = Buffer.from(`${user}:${pass ?? ''}`, 'utf8').toString('base64');
    headers.Authorization = `Basic ${token}`;
  }
  return headers;
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
    // Warm session cookie on hosts that return 204 without a prior page hit.
    try {
      await fetch(`${baseUrl}/index.esp`, {
        method: 'GET',
        headers: buildAuthHeaders(baseUrl),
        signal: AbortSignal.timeout(Math.min(timeoutMs, 5000)),
      });
    } catch {
      /* optional */
    }

    const res = await fetch(url, {
      method: 'GET',
      headers: buildAuthHeaders(baseUrl),
      signal: controller.signal,
      redirect: 'follow',
    });
    const text = await res.text();
    // Some NXA hosts briefly return 204; one retry after a short pause helps.
    if (res.status === 204 || (!text && res.ok)) {
      await new Promise((r) => setTimeout(r, 400));
      const res2 = await fetch(url, {
        method: 'GET',
        headers: buildAuthHeaders(baseUrl),
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
 * DATATYPE=23 — unit/tank tree (names + external ids).
 * @returns {Promise<{ ok: boolean, status: number, text: string, url: string }>}
 */
export async function fetchTankMeta(opts = {}) {
  return gwtGet({ DATATYPE: '23' }, opts);
}

/**
 * DATATYPE=47 — live parameter values for tanks.
 * @param {object} opts
 * @param {string} [opts.baseUrl]
 * @param {string} [opts.tankList]
 * @param {string} [opts.paramIdList]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{ ok: boolean, status: number, text: string, url: string }>}
 */
export async function fetchTankParameters(opts = {}) {
  const tankList =
    opts.tankList ||
    process.env.TANK_GAUGING_TANKLIST ||
    '1|2|3|4|5|6|7|8|9|10|11|12|13|14|15';
  const paramIdList =
    opts.paramIdList ||
    process.env.TANK_GAUGING_PARAMIDLIST ||
    // 624 is unused/INIT on observed hosts and can make some NXA units return HTTP 204.
    '622|625|724|730';
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
 * "TK 1501" → "1501", "TK Sodium 1001" → "1001", "Daily Ca" → "Daily Ca"
 * @param {string} name
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
 * Parse DATATYPE=23 tank list from unit tree.
 * @param {string} text
 * @returns {{ tanks: Array<{ externalTankId: number, name: string, code: string, status: number|null }>, unitName: string|null, parseMode: string }}
 */
export function parseTankMetaResponse(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { tanks: [], unitName: null, parseMode: 'empty' };
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
    return { tanks, unitName: unitName ? String(unitName) : null, parseMode: 'leftTree' };
  } catch {
    return { tanks: [], unitName: null, parseMode: 'unrecognized' };
  }
}

/**
 * Parse a number that may use apostrophe thousands separators (UI style: 6'277).
 * @param {unknown} raw
 * @returns {number|null}
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

function readingFromBulkTank(tank) {
  const list = tank.parameterlist || [];
  const level = paramById(list, 622);
  const temp = paramById(list, 625);
  const flow = paramById(list, 724);
  const mass = paramById(list, 730);
  const statusBits = [level, temp, flow, mass]
    .map((p) => p?.statusString)
    .filter(Boolean);
  const statusText = statusBits[0] || null;
  const ts = Number(level?.timestamp || temp?.timestamp || flow?.timestamp || mass?.timestamp || 0);
  return normalizeReading({
    externalTankId: tank.tankId,
    levelMm: level?.value ?? level?.valueString,
    temperatureC: temp?.value ?? temp?.valueString,
    flowRateTph: flow?.value ?? flow?.valueString,
    totalMass: mass?.value ?? mass?.valueString,
    statusText,
    recordedAt: ts > 0 ? new Date(ts * 1000).toISOString() : null,
  });
}

/**
 * Normalize fixture JSON or live GWT body into reading rows.
 * Live shape: { multiTankTgvData: { multiTankBulkRealTimeData: [{ tankId, parameterlist }] } }
 *
 * @param {string} text
 * @returns {{ readings: Array<object>, parseMode: string }}
 */
export function parseTankParameterResponse(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { readings: [], parseMode: 'empty' };

  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      const data = JSON.parse(raw);

      const bulk = data?.multiTankTgvData?.multiTankBulkRealTimeData;
      if (Array.isArray(bulk)) {
        return {
          readings: bulk.map(readingFromBulkTank).filter((r) => r.externalTankId != null),
          parseMode: 'multiTankBulkRealTimeData',
        };
      }

      const list = Array.isArray(data) ? data : data.readings;
      if (Array.isArray(list)) {
        return {
          readings: list.map(normalizeReading).filter((r) => r.externalTankId != null),
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
        productName: parts[1] || null,
        levelMm: parts[2],
        temperatureC: parts[3],
        totalMass: parts[4],
        flowRateTph: parts[5],
        statusText: parts[6] || null,
      })
    );
  }
  if (readings.length) return { readings, parseMode: 'delimited' };

  return { readings: [], parseMode: 'unrecognized' };
}

function normalizeReading(row) {
  const r = row && typeof row === 'object' ? row : {};
  const externalTankId = Number.parseInt(r.externalTankId ?? r.external_tank_id ?? r.tankId ?? r.id, 10);
  return {
    externalTankId: Number.isFinite(externalTankId) ? externalTankId : null,
    productName: r.productName ?? r.product_name ?? r.product ?? null,
    levelMm: parseTankNumber(r.levelMm ?? r.level_mm ?? r.level),
    temperatureC: parseTankNumber(r.temperatureC ?? r.temperature_c ?? r.temp),
    totalMass: parseTankNumber(r.totalMass ?? r.total_mass ?? r.mass),
    flowRateTph: parseTankNumber(r.flowRateTph ?? r.flow_rate_tph ?? r.flow),
    statusText: r.statusText ?? r.status_text ?? r.status ?? null,
    recordedAt: r.recordedAt ?? r.recorded_at ?? null,
  };
}
