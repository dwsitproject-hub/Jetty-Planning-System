/**
 * HTTP client for JPS API (Slice 0).
 * Set VITE_API_BASE_URL in project root .env:
 * - Local dev: http://localhost:3000/api/v1 (Vite → API on another port)
 * - Production (nginx proxies /api/): /api/v1 — same host whatever users type (private IP or public EIP)
 * Sessions: HttpOnly cookie (H-1); XSRF double-submit header on mutating requests.
 */
const BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1').replace(
  /\/$/,
  ''
)

function isRelativeApiBase() {
  return typeof BASE === 'string' && BASE.startsWith('/')
}
const SELECTED_PORT_SESSION_KEY = 'jps_selected_port_id'
const XSRF_COOKIE = 'jps_xsrf'

/** Browser fetch can hang indefinitely if the API host is down; cap wait time. */
const DEFAULT_TIMEOUT_MS = 18000

function readXsrfCookie() {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${XSRF_COOKIE}=([^;]*)`))
  return m ? decodeURIComponent(m[1]) : null
}

async function fetchWithTimeout(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...init,
      credentials: 'include',
      signal: controller.signal,
    })
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new ApiError(
        0,
        `Request timed out after ${Math.round(timeoutMs / 1000)}s. Is the API running? Expected base URL: ${BASE}`,
        null
      )
    }
    throw e
  } finally {
    clearTimeout(id)
  }
}

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message || `Request failed (${status})`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

function authHeaders(extra = {}) {
  const headers = { Accept: 'application/json', ...extra }
  const xsrf = readXsrfCookie()
  if (xsrf) headers['X-XSRF-TOKEN'] = xsrf
  const selectedPortId =
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(SELECTED_PORT_SESSION_KEY) : null
  if (selectedPortId) headers['X-Selected-Port-Id'] = selectedPortId
  return headers
}

export function getSelectedPortId() {
  if (typeof sessionStorage === 'undefined') return null
  const v = sessionStorage.getItem(SELECTED_PORT_SESSION_KEY)
  const n = parseInt(String(v ?? '').trim(), 10)
  return Number.isFinite(n) ? n : null
}

export function setSelectedPortId(portId) {
  if (typeof sessionStorage === 'undefined') return
  if (portId == null || portId === '') {
    sessionStorage.removeItem(SELECTED_PORT_SESSION_KEY)
    return
  }
  sessionStorage.setItem(SELECTED_PORT_SESSION_KEY, String(portId))
}

async function parseResponse(res) {
  const text = await res.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }
  }
  if (!res.ok) {
    const msg =
      (data && typeof data === 'object' && (data.error || data.message)) || res.statusText
    throw new ApiError(res.status, msg, data)
  }
  return data
}

/**
 * Origin only (for GET /health outside /api/v1).
 */
export function getApiOrigin() {
  if (isRelativeApiBase()) {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin
    }
    return 'http://localhost:3000'
  }
  try {
    return new URL(BASE).origin
  } catch {
    return 'http://localhost:3000'
  }
}

/**
 * Build an absolute URL for stored files. Legacy `/uploads/...` paths are rewritten to
 * authenticated `/api/v1/stored-files/view` (C-01).
 */
export function resolveUploadUrl(urlOrPath) {
  if (urlOrPath == null || urlOrPath === '') return '#'
  const u = String(urlOrPath).trim()
  if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('blob:')) return u
  if (u.startsWith('/uploads/') || u.startsWith('uploads/')) {
    const rel = u.replace(/^\/?uploads\//, '')
    const storedPath = `${BASE}/stored-files/view?path=${encodeURIComponent(rel)}`
    if (isRelativeApiBase()) {
      const origin =
        typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : 'http://localhost:3000'
      return `${origin}${storedPath}`
    }
    return storedPath
  }
  if (u.startsWith('/api/v1/')) {
    const origin = getApiOrigin()
    return `${origin}${u}`
  }
  const origin = getApiOrigin()
  const path = u.startsWith('/') ? u : `/${u}`
  return `${origin}${path}`
}

export async function getHealth() {
  const res = await fetch(`${getApiOrigin()}/health`, {
    headers: { Accept: 'application/json' },
    credentials: 'include',
  })
  return parseResponse(res)
}

/** GET /api/v1/ping — verifies API prefix + CORS from the SPA */
export async function ping() {
  return apiGet('/ping')
}

export async function apiGet(path) {
  const url = `${BASE}${path.startsWith('/') ? path : `/${path}`}`
  const res = await fetchWithTimeout(url, { headers: authHeaders() })
  return parseResponse(res)
}

export async function apiPost(path, body) {
  const url = `${BASE}${path.startsWith('/') ? path : `/${path}`}`
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return parseResponse(res)
}

export async function apiPostForm(path, formData, timeoutMs = 45000) {
  const url = `${BASE}${path.startsWith('/') ? path : `/${path}`}`
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    },
    timeoutMs
  )
  return parseResponse(res)
}

export async function apiPut(path, body) {
  const url = `${BASE}${path.startsWith('/') ? path : `/${path}`}`
  const res = await fetchWithTimeout(url, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return parseResponse(res)
}

export async function apiPatch(path, body) {
  const url = `${BASE}${path.startsWith('/') ? path : `/${path}`}`
  const res = await fetchWithTimeout(url, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return parseResponse(res)
}

export async function apiDelete(path) {
  const url = `${BASE}${path.startsWith('/') ? path : `/${path}`}`
  const res = await fetchWithTimeout(url, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (res.status === 204) return null
  return parseResponse(res)
}

/**
 * Fetch a binary file with session cookie + port scope headers (for img/iframe preview).
 * Returns a blob: URL the caller must revoke when done.
 */
export async function fetchAuthenticatedBlobUrl(absoluteUrl, timeoutMs = 60000) {
  if (!absoluteUrl || absoluteUrl.startsWith('blob:')) return absoluteUrl
  const res = await fetchWithTimeout(
    absoluteUrl,
    { headers: authHeaders({ Accept: '*/*' }) },
    timeoutMs
  )
  if (!res.ok) {
    let msg = res.statusText
    try {
      const data = await res.json()
      msg = data?.error || data?.message || msg
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg, null)
  }
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}
