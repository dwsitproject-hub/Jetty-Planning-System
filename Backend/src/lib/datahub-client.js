/**
 * DataHub (DHM) vessel master client.
 *
 * Contract: Docs/Guide/DATAHUB_CLIENT_INTEGRATION.md. Reads use pattern C
 * (local replica) via GET /v1/sync/vessel; writes use pattern A
 * (POST/PUT /v1/inbound/vessel) via datahub-vessel-push.js.
 *
 * Canonical hub field names are required - DHM does not translate aliases.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
/** DHM caps /v1/sync at 500 per page. */
export const SYNC_PAGE_LIMIT = 500;
/** Safety valve so a bad cursor cannot loop forever. */
const MAX_PAGES = 100;

/**
 * Hub field name -> local master_vessels column.
 * Note `Vessel_Length_Overral`: the hub misspells it, we do not.
 */
export const HUB_FIELD_TO_COLUMN = {
  Vessel_Name: 'vessel_name',
  Vessel_IMO: 'vessel_imo',
  Vessel_MMSI: 'vessel_mmsi',
  Vessel_Code_SAP: 'vessel_code_sap',
  Vessel_Capacity_MT: 'vessel_capacity_mt',
  Vessel_Gross_Tonnage: 'vessel_gross_tonnage',
  Vessel_Draft: 'vessel_draft',
  Vessel_Length_Overral: 'vessel_length_overall',
  Vessel_Type: 'vessel_type',
  Heater: 'heater',
  Type_lambung: 'type_lambung',
  Type_Charter: 'type_charter',
};

/** Numeric per the hub contract; everything else is string or boolean. */
const NUMERIC_COLUMNS = new Set([
  'vessel_capacity_mt',
  'vessel_gross_tonnage',
  'vessel_draft',
]);

function timeoutMs() {
  const n = parseInt(process.env.DHM_TIMEOUT_MS || '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * Key-pair headers. Pure, so tests can assert them without a network call.
 * @param {{ publicKey: string|null, privateKey: string|null }} cfg
 */
export function buildAuthHeaders(cfg) {
  const publicKey = str(cfg?.publicKey);
  const privateKey = str(cfg?.privateKey);
  if (!publicKey || !privateKey) {
    throw new Error('DataHub public and private keys are required');
  }
  return {
    Accept: 'application/json',
    'X-DHM-Public-Key': publicKey,
    'X-DHM-Private-Key': privateKey,
  };
}

/** App tokens last hours, so cache per host + public key. */
const tokenCache = new Map();
const TOKEN_REFRESH_SKEW_MS = 60_000;

/** Call after credentials change so a stale token is not reused. */
export function clearDataHubTokenCache() {
  tokenCache.clear();
}

/** DHM reports expiry as a duration string such as "8h". */
export function parseExpiresInSeconds(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  const m = /^\s*(\d+(?:\.\d+)?)\s*([smhd])?\s*$/i.exec(String(raw ?? ''));
  if (!m) return 3600;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return 3600;
  const unit = (m[2] || 's').toLowerCase();
  const mult = unit === 'd' ? 86400 : unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
  return n * mult;
}

/**
 * Exchange the key pair for a short-lived app token (the `appToken` scheme).
 * @param {{ baseUrl: string, publicKey: string, privateKey: string }} cfg
 */
export async function fetchAppToken(cfg, fetchImpl = fetch) {
  const publicKey = str(cfg?.publicKey);
  const privateKey = str(cfg?.privateKey);
  if (!publicKey || !privateKey) {
    throw new Error('DataHub public and private keys are required');
  }
  const body = await fetchJson(
    `${cfg.baseUrl}/auth/token`,
    { Accept: 'application/json', 'Content-Type': 'application/json' },
    fetchImpl,
    { method: 'POST', body: JSON.stringify({ publicKey, privateKey }) }
  );
  const token = str(body?.token);
  if (!token) throw new Error('DataHub did not return an app token');
  return { token, expiresInSeconds: parseExpiresInSeconds(body?.expiresIn) };
}

async function getCachedToken(cfg, fetchImpl) {
  const cacheKey = `${cfg.baseUrl}|${str(cfg.publicKey)}`;
  const hit = tokenCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now() + TOKEN_REFRESH_SKEW_MS) return hit.token;
  const { token, expiresInSeconds } = await fetchAppToken(cfg, fetchImpl);
  tokenCache.set(cacheKey, { token, expiresAt: Date.now() + expiresInSeconds * 1000 });
  return token;
}

/**
 * Auth headers for a `/v1` call.
 *
 * Prefers the `appToken` scheme. The Bontang deployment serves the API behind
 * the portal at `/api`, and that hop drops the `X-DHM-*` headers, so the key
 * pair alone always comes back as "Application credentials required" while the
 * same keys exchange for a token fine. Authorization survives the proxy.
 * Builds with no `/auth/token` route fall back to the key-pair headers.
 */
async function resolveAuthHeaders(cfg, fetchImpl) {
  try {
    const token = await getCachedToken(cfg, fetchImpl);
    return { Accept: 'application/json', Authorization: `Bearer ${token}` };
  } catch (e) {
    if (Number(e?.status) === 404) return buildAuthHeaders(cfg);
    throw e;
  }
}

/**
 * Flatten one /v1/sync record into the local column shape.
 * Unknown hub keys are ignored rather than failing the whole sync.
 */
export function normalizeHubVessel(record) {
  const data = record?.data && typeof record.data === 'object' ? record.data : null;
  if (!data) return null;
  const name = str(data.Vessel_Name);
  if (!name) return null;

  const values = {};
  for (const [hubKey, column] of Object.entries(HUB_FIELD_TO_COLUMN)) {
    const raw = data[hubKey];
    if (column === 'heater') values[column] = raw == null ? null : Boolean(raw);
    else if (NUMERIC_COLUMNS.has(column)) values[column] = num(raw);
    else values[column] = str(raw);
  }

  return {
    hubCode: str(data.code) ?? null,
    hubRecordId: str(record.id) ?? null,
    hubVersion: Number.isFinite(Number(record.version)) ? Number(record.version) : null,
    hubUpdatedAt: record.updatedAt ?? null,
    isDeleted: record.isDeleted === true,
    values,
  };
}

/**
 * Parse one page of /v1/sync/vessel. Pure, so pagination is unit-testable.
 */
export function parseSyncPage(body) {
  const records = Array.isArray(body?.records) ? body.records : [];
  return {
    vessels: records.map(normalizeHubVessel).filter(Boolean),
    hasMore: body?.hasMore === true,
    nextCursor: body?.nextCursor ? String(body.nextCursor) : null,
  };
}

/** True when a response body is a web page rather than an API payload. */
export function looksLikeHtml(res, text) {
  const contentType = String(res?.headers?.get?.('content-type') ?? '');
  if (/text\/html/i.test(contentType)) return true;
  return /^\s*(?:<!doctype\s+html|<html[\s>])/i.test(String(text ?? ''));
}

async function fetchJson(url, headers, fetchImpl = fetch, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs());
  let res;
  try {
    res = await fetchImpl(url, { ...init, headers, signal: ctrl.signal });
  } catch (e) {
    if (e?.name === 'AbortError') {
      const err = new Error(`DataHub request timed out after ${timeoutMs()}ms`);
      err.status = 0;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(t);
  }

  const text = await res.text();

  // The portal and the /v1 API are separate services. Pointing the base URL at
  // the portal yields its HTML (a 404 page, or a login redirect), which is far
  // more useful to report as a misconfigured URL than as raw markup.
  if (looksLikeHtml(res, text)) {
    const err = new Error(
      `DataHub returned a web page (HTTP ${res.status}), not JSON. The base URL looks like the DHM portal instead of the /v1 API host.`
    );
    err.status = res.status;
    err.isHtml = true;
    throw err;
  }

  if (!res.ok) {
    let message = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text);
      message = parsed.message || parsed.error || message;
    } catch {
      /* keep the raw snippet */
    }
    const err = new Error(`DataHub HTTP ${res.status}: ${message}`);
    err.status = res.status;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('DataHub returned a non-JSON response');
  }
}

/**
 * Connection test. Also proves the key pair is allowlisted for `vessel`:
 * an unassigned entity returns 403 per the contract.
 * @param {{ baseUrl: string, publicKey: string, privateKey: string }} cfg
 */
export async function fetchVesselCatalog(cfg, fetchImpl = fetch) {
  const body = await fetchJson(
    `${cfg.baseUrl}/v1/catalog/vessel`,
    await resolveAuthHeaders(cfg, fetchImpl),
    fetchImpl
  );
  const fields = Array.isArray(body?.fields) ? body.fields : [];
  return {
    slug: body?.slug ?? 'vessel',
    name: body?.name ?? null,
    fieldCount: fields.length,
    fieldKeys: fields.map((f) => f?.key).filter(Boolean),
  };
}

/**
 * Full snapshot of the hub vessel master, following nextCursor to the end.
 * @param {{ baseUrl: string, publicKey: string, privateKey: string }} cfg
 */
export async function fetchAllVessels(cfg, fetchImpl = fetch) {
  const headers = await resolveAuthHeaders(cfg, fetchImpl);
  const out = [];
  let url = `${cfg.baseUrl}/v1/sync/vessel?limit=${SYNC_PAGE_LIMIT}`;
  let pages = 0;

  while (url && pages < MAX_PAGES) {
    const page = parseSyncPage(await fetchJson(url, headers, fetchImpl));
    out.push(...page.vessels);
    pages += 1;
    url =
      page.hasMore && page.nextCursor
        ? `${cfg.baseUrl}/v1/sync/vessel?cursor=${encodeURIComponent(page.nextCursor)}`
        : null;
  }

  return out;
}

/**
 * Inbound POST/PUT: return structured results for 201/200/409 instead of throwing.
 * Network errors, HTML misconfig, and unexpected statuses still throw.
 */
async function fetchInboundJson(url, headers, fetchImpl = fetch, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs());
  let res;
  try {
    res = await fetchImpl(url, { ...init, headers, signal: ctrl.signal });
  } catch (e) {
    if (e?.name === 'AbortError') {
      const err = new Error(`DataHub request timed out after ${timeoutMs()}ms`);
      err.status = 0;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(t);
  }

  const text = await res.text();
  if (looksLikeHtml(res, text)) {
    const err = new Error(
      `DataHub returned a web page (HTTP ${res.status}), not JSON. The base URL looks like the DHM portal instead of the /v1 API host.`
    );
    err.status = res.status;
    err.isHtml = true;
    throw err;
  }

  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      if (res.ok || res.status === 409) {
        throw new Error('DataHub returned a non-JSON response');
      }
      const err = new Error(`DataHub HTTP ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
  }

  if (res.status === 201 || res.status === 200 || res.status === 409) {
    return { httpStatus: res.status, body };
  }

  const message =
    body?.message || body?.error || text.slice(0, 300) || `HTTP ${res.status}`;
  const err = new Error(`DataHub HTTP ${res.status}: ${message}`);
  err.status = res.status;
  err.body = body;
  throw err;
}

/**
 * POST /v1/inbound/vessel — create (omit client-invented code).
 * @returns {{ httpStatus: number, body: object|null }}
 */
export async function postInboundVessel(cfg, payload, fetchImpl = fetch) {
  const headers = {
    ...(await resolveAuthHeaders(cfg, fetchImpl)),
    'Content-Type': 'application/json',
  };
  return fetchInboundJson(
    `${cfg.baseUrl}/v1/inbound/vessel`,
    headers,
    fetchImpl,
    { method: 'POST', body: JSON.stringify(payload) }
  );
}

/**
 * PUT /v1/inbound/vessel/{code} — update when DHM is outdated.
 * @returns {{ httpStatus: number, body: object|null }}
 */
export async function putInboundVessel(cfg, hubCode, payload, fetchImpl = fetch) {
  const code = str(hubCode);
  if (!code) throw new Error('hub code is required for inbound PUT');
  const headers = {
    ...(await resolveAuthHeaders(cfg, fetchImpl)),
    'Content-Type': 'application/json',
  };
  return fetchInboundJson(
    `${cfg.baseUrl}/v1/inbound/vessel/${encodeURIComponent(code)}`,
    headers,
    fetchImpl,
    { method: 'PUT', body: JSON.stringify({ ...payload, code }) }
  );
}
